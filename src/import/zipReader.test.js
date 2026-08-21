import { describe, expect, test } from 'vitest';
import { listZipEntries, readZip, readZipEntry } from './zipReader.js';
import { buildZip, bytesOf } from './fixtures/buildZip.js';

// The zip fixtures live in ./fixtures/buildZip.js (shared with the
// reference-zip tests): a minimal writer producing the structures that
// matter, including client-zip's zero-size streaming local headers.

const encoder = new TextEncoder();

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

describe('listZipEntries / readZipEntry', () => {
  // The lazy pair behind reference zips: list once, decode one entry at a
  // time — a 41-photo reference must never be inflated wholesale.

  test('lists every entry without decoding any data', () => {
    const zip = buildZip([
      { name: 'session.geojson', data: '{"type":"FeatureCollection"}' },
      { name: 'photos/obs-1.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) },
    ]);

    const entries = listZipEntries(zip);

    expect(entries.map((entry) => entry.name)).toEqual(['session.geojson', 'photos/obs-1.jpg']);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty('data');
    }
  });

  test('reads exactly one entry back byte for byte', async () => {
    const zip = buildZip([
      { name: 'session.geojson', data: '{"type":"FeatureCollection"}' },
      { name: 'photos/obs-1.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) },
    ]);

    const entries = listZipEntries(zip);
    const photo = await readZipEntry(zip, entries[1]);

    expect([...photo]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  test('inflates a DEFLATE entry on its own', async () => {
    const zip = buildZip([{ name: 'a.txt', data: 'squash me '.repeat(50) }], {
      method: 'deflate',
    });

    const [entry] = listZipEntries(zip);

    expect(new TextDecoder().decode(await readZipEntry(zip, entry))).toBe('squash me '.repeat(50));
  });

  test('a STORE read is a copy, not a view pinning the whole archive', async () => {
    const zip = buildZip([{ name: 'a.txt', data: 'small entry' }]);

    const [entry] = listZipEntries(zip);
    const data = await readZipEntry(zip, entry);

    expect(data.buffer).not.toBe(zip);
  });

  test('listing skips directory entries and trusts streaming central sizes, like readZip', () => {
    const zip = buildZip(
      [
        { name: 'photos/', data: new Uint8Array(0) },
        { name: 'photos/obs-1.jpg', data: new Uint8Array([1, 2, 3]) },
      ],
      { dataDescriptor: true },
    );

    const entries = listZipEntries(zip);

    expect(entries.map((entry) => entry.name)).toEqual(['photos/obs-1.jpg']);
    expect(entries[0].compressedSize).toBe(3);
  });

  test('rejects a non-zip on listing, by name', () => {
    const notZip = encoder.encode('{"type":"FeatureCollection"}').buffer;

    expect(() => listZipEntries(notZip)).toThrow(/not a zip file/);
  });

  test('readZip still returns every entry, now as a thin loop over the pair', async () => {
    // The split must not change readZip's behaviour — the existing tests
    // above prove that; this one pins the equivalence directly.
    const zip = buildZip([
      { name: 'a.txt', data: 'one' },
      { name: 'b.txt', data: 'two' },
    ]);

    const viaReadZip = await readZip(zip);
    const viaPair = await Promise.all(
      listZipEntries(zip).map(async (entry) => ({
        name: entry.name,
        data: await readZipEntry(zip, entry),
      })),
    );

    expect(viaPair).toEqual(viaReadZip);
  });
});
