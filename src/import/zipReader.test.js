import { describe, expect, test } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readZip } from './zipReader.js';

// A minimal zip *writer*, existing only to feed the reader known structures —
// including the shape that matters most: client-zip's streaming output, whose
// local headers carry zero sizes (flag bit 3, data descriptor) and only the
// central directory tells the truth. The browser tier round-trips real
// client-zip bytes; these fixtures let the node tier cover the format corners
// deterministically.

const encoder = new TextEncoder();

function bytesOf(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16(value) {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

function u32(value) {
  return new Uint8Array([
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ]);
}

function buildZip(files, { method = 'store', dataDescriptor = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = encoder.encode(name);
    const raw = typeof data === 'string' ? encoder.encode(data) : data;
    const stored = method === 'deflate' ? new Uint8Array(deflateRawSync(raw)) : raw;
    const methodCode = method === 'deflate' ? 8 : 0;
    const flags = dataDescriptor ? 0x0008 : 0;
    // A streaming writer does not know the sizes when it emits the local
    // header, so it writes zeros and appends a data descriptor after the
    // data. The reader must never trust these fields.
    const localSizes = dataDescriptor
      ? { csize: 0, usize: 0 }
      : { csize: stored.length, usize: raw.length };

    const local = bytesOf([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(methodCode),
      u16(0),
      u16(0),
      u32(0),
      u32(localSizes.csize),
      u32(localSizes.usize),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      stored,
      ...(dataDescriptor ? [u32(0x08074b50), u32(0), u32(stored.length), u32(raw.length)] : []),
    ]);
    const central = bytesOf([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(flags),
      u16(methodCode),
      u16(0),
      u16(0),
      u32(0),
      u32(stored.length),
      u32(raw.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralBytes = bytesOf(centrals);
  const eocd = bytesOf([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);
  return bytesOf([...locals, centralBytes, eocd]).buffer;
}

const text = (entry) => new TextDecoder().decode(entry.data);

describe('readZip', () => {
  test('reads STORE entries back byte for byte', async () => {
    const zip = buildZip([
      { name: 'session.geojson', data: '{"type":"FeatureCollection"}' },
      { name: 'photos/obs-1.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) },
    ]);

    const entries = await readZip(zip);

    expect(entries.map((entry) => entry.name)).toEqual(['session.geojson', 'photos/obs-1.jpg']);
    expect(text(entries[0])).toBe('{"type":"FeatureCollection"}');
    expect([...entries[1].data]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  test('inflates DEFLATE entries', async () => {
    const zip = buildZip([{ name: 'a.txt', data: 'squash me '.repeat(50) }], {
      method: 'deflate',
    });

    const [entry] = await readZip(zip);

    expect(text(entry)).toBe('squash me '.repeat(50));
  });

  test('trusts the central directory over zeroed streaming local headers', async () => {
    // client-zip's actual output shape: local sizes are 0 with a data
    // descriptor after the data. Reading sizes from the local header returns
    // every entry empty.
    const zip = buildZip([{ name: 'session.geojson', data: '{"features":[]}' }], {
      dataDescriptor: true,
    });

    const [entry] = await readZip(zip);

    expect(text(entry)).toBe('{"features":[]}');
  });

  test('skips directory entries', async () => {
    const zip = buildZip([
      { name: 'photos/', data: new Uint8Array(0) },
      { name: 'photos/obs-1.jpg', data: new Uint8Array([1, 2, 3]) },
    ]);

    const entries = await readZip(zip);

    expect(entries.map((entry) => entry.name)).toEqual(['photos/obs-1.jpg']);
  });

  test('rejects a file that is not a zip, by name', async () => {
    const notZip = encoder.encode('{"type":"FeatureCollection","features":[]}').buffer;

    await expect(readZip(notZip)).rejects.toThrow(/not a zip file/);
  });

  test('rejects a truncated archive rather than returning short data', async () => {
    const whole = buildZip([{ name: 'a.txt', data: 'some content that will be cut off' }]);
    // Cut inside the entry data but keep the tail so the central directory
    // (at the end) still parses — the entry then points past the truncation.
    const bytes = new Uint8Array(whole);
    const truncated = bytesOf([bytes.subarray(0, 20), bytes.subarray(50)]).buffer;

    await expect(readZip(truncated)).rejects.toThrow(/corrupt|runs past|not a zip/);
  });
});
