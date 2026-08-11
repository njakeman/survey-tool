// Vendors the OSTN15 shift grid used to turn a GPS fix into an OS grid
// reference. Run by hand, result committed — same arrangement as
// scripts/fetch-glyphs.mjs and scripts/fetch-fonts.mjs:
//
//   node scripts/fetch-ostn15.mjs
//
// Downloads Ordnance Survey's OSTN15_OSGM15 **Lite** developer pack and
// reduces it to public/geodesy/ostn15-lite.json.
//
// Lite, not the full grid, on purpose. The full transformation ships as a
// 13 MB developer pack or a 28 MB NTv2 file, either of which would have to
// live in IndexedDB behind an explicit download like the basemap archives —
// a lot of machinery for a grid reference. The Lite pack is a 20 km grid in
// 70 KB, and OS put its error at 0.08 m horizontal RMS against the full
// version. Against the 5–10 m GPS accuracy this app records, that is about
// one percent of the error being transformed.
//
// The pack also carries 114 test points with expected results, which is what
// src/geo/osgb.test.js checks against. Those are committed too — a
// transformation that is subtly wrong still produces confident-looking
// output, so it is worth testing against the authority's own numbers rather
// than against my arithmetic.
//
// LICENCE: OS publish OSTN15 free of charge "as raw data for developers" and
// the whole point of the developer pack is to be implemented in software.
// What I could not find is an explicit statement about *redistributing* the
// grid inside a repository — the pack's user guide does not say, and neither
// does the resources page it comes from. Other open-source implementations
// embed it, and the attribution below is the OS OpenData form. If you would
// rather carry no doubt, gitignore public/geodesy/ and run this script as a
// setup step instead; the app degrades to no grid references rather than
// breaking. See README → Grid references.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const PACK_URL =
  'https://www.ordnancesurvey.co.uk/documents/resources/OSTN15-OSGM15-Lite-DevelopersPack.zip';
const DATA_ENTRY = 'OSTN15_OSGM15_Lite_DataFile.txt';
const TEST_INPUT = 'OSTN15_OSGM15_Lite_TestInput_ETRSplHtoOSGBENh.txt';
const TEST_RESULT = 'OSTN15_OSGM15_Lite_TestInput_ETRSplHtoOSGBENh_RESULT.txt';

const OUT_DIR = fileURLToPath(new URL('../public/geodesy/', import.meta.url));
const FIXTURE_DIR = fileURLToPath(new URL('../src/geo/fixtures/', import.meta.url));

// The Lite grid: 20 km spacing, 36 columns east by 63 rows north, records
// ordered with easting varying fastest.
const SPACING = 20000;
const EAST_COUNT = 36;
const NORTH_COUNT = 63;

// A zip reader small enough not to be worth a dependency: find the end-of-
// central-directory record, walk the entries, inflate the ones we want. The
// repo has client-zip for *writing* zips in the browser and nothing for
// reading one in Node, and pulling in a package to read three files from one
// archive once is a poor trade.
function readZip(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // The EOCD is at the end, after a comment of unknown length, so scan back
  // for its signature.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('not a zip archive: no end-of-central-directory record');

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const files = new Map();
  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`corrupt zip: bad central directory header at ${offset}`);
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = buffer.toString('utf-8', offset + 46, offset + 46 + nameLength);

    // The local header repeats the name and extra fields, and its extra
    // length can differ from the central directory's — read it, don't assume.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    files.set(name, method === 0 ? raw : inflateRawSync(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function requireEntry(files, name) {
  const entry = files.get(name);
  if (!entry) {
    throw new Error(
      `${name} is not in the pack — OS may have changed its layout. Entries: ${[...files.keys()].join(', ')}`,
    );
  }
  return entry;
}

// Records are `index,easting,northing,shiftEast,shiftNorth,shiftGeoid,flag`.
// Only the two horizontal shifts are kept: the geoid separation converts
// ellipsoidal height to height above sea level, which this app does not do —
// it records the GPS altitude as reported and says so.
function parseGrid(text) {
  const se = new Array(EAST_COUNT * NORTH_COUNT);
  const sn = new Array(EAST_COUNT * NORTH_COUNT);
  let seen = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [index, easting, northing, shiftEast, shiftNorth] = line.split(',');
    const i = Number(index) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= se.length) {
      throw new Error(`record index ${index} is outside the expected ${se.length}-record grid`);
    }
    // The record's own coordinates must agree with where its index puts it,
    // or the whole interpolation is silently offset.
    const expectedEast = (i % EAST_COUNT) * SPACING;
    const expectedNorth = Math.floor(i / EAST_COUNT) * SPACING;
    if (Number(easting) !== expectedEast || Number(northing) !== expectedNorth) {
      throw new Error(
        `record ${index} is at ${easting},${northing} but its index implies ${expectedEast},${expectedNorth}`,
      );
    }
    se[i] = Number(shiftEast);
    sn[i] = Number(shiftNorth);
    seen += 1;
  }

  if (seen !== se.length) throw new Error(`expected ${se.length} records, read ${seen}`);
  return { se, sn };
}

console.log(`fetching ${PACK_URL}`);
const response = await fetch(PACK_URL);
if (!response.ok) throw new Error(`OS returned HTTP ${response.status} for the Lite pack`);
const zip = Buffer.from(await response.arrayBuffer());
console.log(`  ${(zip.length / 1024).toFixed(0)} kB archive`);

const files = readZip(zip);
const { se, sn } = parseGrid(requireEntry(files, DATA_ENTRY).toString('utf-8'));

await mkdir(OUT_DIR, { recursive: true });
const grid = {
  _source: 'OSTN15_OSGM15 Lite Developer Pack, Ordnance Survey',
  _attribution: 'Contains OS data © Crown copyright and database right 2026',
  _generatedBy: 'scripts/fetch-ostn15.mjs',
  spacing: SPACING,
  eastCount: EAST_COUNT,
  northCount: NORTH_COUNT,
  se,
  sn,
};
const gridPath = `${OUT_DIR}ostn15-lite.json`;
await writeFile(gridPath, `${JSON.stringify(grid)}\n`);

// The authority's own test vectors, kept beside the code that must match
// them. Trimmed to what the horizontal transformation needs: the result file
// also carries every intermediate interpolation value, which is useful for
// debugging by hand and only noise in a fixture.
await mkdir(FIXTURE_DIR, { recursive: true });
const inputs = new Map(
  requireEntry(files, TEST_INPUT)
    .toString('utf-8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const [id, lat, lon] = line.split(',');
      return [id, { id, lat: Number(lat), lon: Number(lon) }];
    }),
);

const expected = requireEntry(files, TEST_RESULT)
  .toString('utf-8')
  .split(/\r?\n/)
  .slice(1) // header
  .filter((line) => line.trim())
  .map((line) => {
    const [id, east, north] = line.split(',');
    const input = inputs.get(id);
    if (!input) throw new Error(`result ${id} has no matching input point`);
    return { id, lat: input.lat, lon: input.lon, easting: Number(east), northing: Number(north) };
  });

const fixturePath = `${FIXTURE_DIR}ostn15-test-points.json`;
await writeFile(fixturePath, `${JSON.stringify(expected, null, 2)}\n`);

const gridKb = ((await import('node:fs')).statSync(gridPath).size / 1024).toFixed(0);
console.log(`wrote ${gridPath} (${gridKb} kB, ${se.length} nodes)`);
console.log(`wrote ${fixturePath} (${expected.length} OS test points)`);
console.log('\nAttribution required wherever grid references are shown:');
console.log(`  ${grid._attribution}`);
