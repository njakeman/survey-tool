// Generates e2e/fixtures/test-basemap.pmtiles: a minimal, valid PMTiles v3
// archive — one uncompressed MVT tile (a single 'earth' polygon) at z0 —
// hand-encoded so regenerating it needs only Node, never the Go pmtiles CLI
// or a real planet extract. Run: node scripts/make-fixture-pmtiles.mjs
//
// Format reference: PMTiles v3 spec (127-byte header, varint-serialised
// root directory) and the Mapbox Vector Tile 2.1 protobuf schema.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT_PATH = fileURLToPath(new URL('../e2e/fixtures/test-basemap.pmtiles', import.meta.url));

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

function buildArchive() {
  const tile = buildTile();
  const rootDir = buildRootDirectory(tile.length);
  const metadata = new TextEncoder().encode(JSON.stringify({ name: 'test-basemap fixture' }));

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
  header[99] = 1; // tile type: MVT
  header[100] = 0; // min zoom
  header[101] = 0; // max zoom
  view.setInt32(102, -180e7, true); // min lon (E7)
  view.setInt32(106, -85e7, true); // min lat
  view.setInt32(110, 180e7, true); // max lon
  view.setInt32(114, 85e7, true); // max lat
  header[118] = 0; // center zoom
  view.setInt32(119, -0.14e7, true); // center lon — the e2e's faked London fix
  view.setInt32(123, 51.5e7, true); // center lat

  const archive = new Uint8Array(tileDataOffset + tile.length);
  archive.set(header, 0);
  archive.set(rootDir, rootOffset);
  archive.set(metadata, metadataOffset);
  archive.set(tile, tileDataOffset);
  return archive;
}

const archive = buildArchive();
await mkdir(new URL('../e2e/fixtures/', import.meta.url), { recursive: true });
await writeFile(OUT_PATH, archive);
console.log(`wrote ${OUT_PATH} (${archive.length} bytes)`);
