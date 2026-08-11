// Generates e2e/fixtures/test-basemap.pmtiles: a minimal, valid PMTiles v3
// archive — one uncompressed MVT tile (a single 'earth' polygon) at z0 —
// hand-encoded so regenerating it needs only Node, never the Go pmtiles CLI
// or a real planet extract. Run: node scripts/make-fixture-pmtiles.mjs
//
// Format reference: PMTiles v3 spec (127-byte header, varint-serialised
// root directory) and the Mapbox Vector Tile 2.1 protobuf schema.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// PMTiles tile types (spec §3): 1 = MVT, 2 = PNG.
const TILE_TYPE_MVT = 1;
const TILE_TYPE_PNG = 2;

// Two vector fixtures with non-overlapping bounds, so tests can prove that two
// archives coexist without colliding and that region selection picks the one
// covering a given position — plus a raster one, because real archives are not
// all vector and the app has to render both.
const FIXTURES = [
  {
    file: 'test-basemap.pmtiles',
    name: 'test-basemap fixture (south)',
    // Around London — contains the position the e2e fakes.
    bounds: { minLon: -1.0, minLat: 51.0, maxLon: 0.5, maxLat: 52.0 },
    center: { lon: -0.14, lat: 51.5 },
    tileType: TILE_TYPE_MVT,
  },
  {
    file: 'test-basemap-north.pmtiles',
    name: 'test-basemap fixture (north)',
    // Around Leeds — deliberately nowhere near the southern fixture.
    bounds: { minLon: -2.5, minLat: 53.0, maxLon: -1.0, maxLat: 54.0 },
    center: { lon: -1.55, lat: 53.8 },
    tileType: TILE_TYPE_MVT,
  },
  {
    file: 'test-basemap-raster.pmtiles',
    name: 'test-basemap fixture (raster)',
    // Same coverage as the southern vector fixture, so a test can swap one
    // for the other and change nothing but the tile type.
    bounds: { minLon: -1.0, minLat: 51.0, maxLon: 0.5, maxLat: 52.0 },
    center: { lon: -0.14, lat: 51.5 },
    tileType: TILE_TYPE_PNG,
    // 256 is the near-universal raster tile size, and the value the app has
    // to detect from the bytes rather than assume.
    tileSize: 256,
  },
];

// --- protobuf/varint helpers -------------------------------------------------

function varint(value) {
  const bytes = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return bytes;
}

const zigzag = (v) => (v << 1) ^ (v >> 31);

function lengthDelimited(fieldNumber, bytes) {
  return [...varint((fieldNumber << 3) | 2), ...varint(bytes.length), ...bytes];
}

function varintField(fieldNumber, value) {
  return [...varint(fieldNumber << 3), ...varint(value)];
}

// --- one MVT tile: layer 'earth', one square polygon -------------------------

function buildTile() {
  // MoveTo(0,0); LineTo(+100,0),(0,+100),(-100,0); ClosePath — a filled
  // square, enough for a renderer to paint something.
  const geometry = [
    ...varint(9),
    ...varint(zigzag(0)),
    ...varint(zigzag(0)),
    ...varint(26),
    ...varint(zigzag(100)),
    ...varint(zigzag(0)),
    ...varint(zigzag(0)),
    ...varint(zigzag(100)),
    ...varint(zigzag(-100)),
    ...varint(zigzag(0)),
    ...varint(15),
  ];
  const feature = [
    ...varintField(3, 3), // type = POLYGON
    ...lengthDelimited(4, geometry),
  ];
  const layer = [
    ...lengthDelimited(1, [...new TextEncoder().encode('earth')]), // name
    ...lengthDelimited(2, feature),
    ...varintField(5, 4096), // extent
    ...varintField(15, 2), // version
  ];
  return Uint8Array.from(lengthDelimited(3, layer));
}

// --- one PNG tile ------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = [...new TextEncoder().encode(type)];
  const body = [...typeBytes, ...data];
  const length = data.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...body,
    ...(() => {
      const crc = crc32(body);
      return [(crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff];
    })(),
  ];
}

// A real, valid PNG of the given size — solid colour, so it compresses to a
// few hundred bytes. Real bytes matter: the manifest reads tile dimensions
// out of the IHDR, and a stub would not exercise that.
function buildPngTile(size) {
  const be32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const raw = new Uint8Array(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const p = rowStart + 1 + x * 3;
      raw[p] = 0x8f; // a flat olive, so a rendered tile is obviously "something"
      raw[p + 1] = 0x9a;
      raw[p + 2] = 0x6b;
    }
  }
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk('IHDR', [...be32(size), ...be32(size), 8, 2, 0, 0, 0]), // 8-bit RGB
    ...pngChunk('IDAT', [...deflateSync(raw)]),
    ...pngChunk('IEND', []),
  ]);
}

// --- PMTiles v3 container ----------------------------------------------------

function buildRootDirectory(tileLength) {
  // One entry: tileId 0, runLength 1. Offsets are +1-encoded (0 is reserved
  // for "follows previous entry").
  return Uint8Array.from([
    ...varint(1), // entry count
    ...varint(0), // tileId delta
    ...varint(1), // runLength
    ...varint(tileLength),
    ...varint(1), // offset 0, +1-encoded
  ]);
}

function buildArchive({ name, bounds, center, tileType, tileSize }) {
  const tile = tileType === TILE_TYPE_PNG ? buildPngTile(tileSize) : buildTile();
  const rootDir = buildRootDirectory(tile.length);
  const metadata = new TextEncoder().encode(JSON.stringify({ name }));

  const HEADER_LENGTH = 127;
  const rootOffset = HEADER_LENGTH;
  const metadataOffset = rootOffset + rootDir.length;
  const tileDataOffset = metadataOffset + metadata.length;

  const header = new Uint8Array(HEADER_LENGTH);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode('PMTiles'), 0);
  header[7] = 3; // spec version
  view.setBigUint64(8, BigInt(rootOffset), true);
  view.setBigUint64(16, BigInt(rootDir.length), true);
  view.setBigUint64(24, BigInt(metadataOffset), true);
  view.setBigUint64(32, BigInt(metadata.length), true);
  view.setBigUint64(40, 0n, true); // leaf directories: none
  view.setBigUint64(48, 0n, true);
  view.setBigUint64(56, BigInt(tileDataOffset), true);
  view.setBigUint64(64, BigInt(tile.length), true);
  view.setBigUint64(72, 1n, true); // addressed tiles
  view.setBigUint64(80, 1n, true); // tile entries
  view.setBigUint64(88, 1n, true); // tile contents
  header[96] = 1; // clustered
  header[97] = 1; // internal compression: none
  header[98] = 1; // tile compression: none
  header[99] = tileType;
  header[100] = 0; // min zoom
  header[101] = 0; // max zoom
  // Regional bounds, like a real `pmtiles extract`: the map clamps panning to
  // them, and a world-spanning maxBounds is a MapLibre construction crash
  // (see src/map/viewport.js).
  view.setInt32(102, bounds.minLon * 1e7, true); // min lon (E7)
  view.setInt32(106, bounds.minLat * 1e7, true); // min lat
  view.setInt32(110, bounds.maxLon * 1e7, true); // max lon
  view.setInt32(114, bounds.maxLat * 1e7, true); // max lat
  header[118] = 0; // center zoom
  view.setInt32(119, center.lon * 1e7, true); // center lon
  view.setInt32(123, center.lat * 1e7, true); // center lat

  const archive = new Uint8Array(tileDataOffset + tile.length);
  archive.set(header, 0);
  archive.set(rootDir, rootOffset);
  archive.set(metadata, metadataOffset);
  archive.set(tile, tileDataOffset);
  return archive;
}

await mkdir(new URL('../e2e/fixtures/', import.meta.url), { recursive: true });
for (const fixture of FIXTURES) {
  const archive = buildArchive(fixture);
  const path = fileURLToPath(new URL(`../e2e/fixtures/${fixture.file}`, import.meta.url));
  await writeFile(path, archive);
  console.log(`wrote ${path} (${archive.length} bytes)`);
}
