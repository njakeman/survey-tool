import { describe, expect, test } from 'vitest';
import { zipEntries } from '../export/zip.js';
import { readZip } from './zipReader.js';

// The contract that matters: bytes produced by the app's own export
// (client-zip, streaming, data descriptors) read back through the app's own
// reader, in a real browser. The node tier covers the format corners with
// crafted fixtures; this proves the two libraries actually agree.

describe('readZip against real client-zip output', () => {
  test('round-trips an export-shaped archive byte for byte', async () => {
    const geojson = '{\n  "type": "FeatureCollection",\n  "features": []\n}\n';
    const photoBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const blob = await zipEntries([
      { name: 'session.geojson', input: geojson },
      { name: 'photos/01J5.jpg', input: new Blob([photoBytes], { type: 'image/jpeg' }) },
    ]);

    const entries = await readZip(await blob.arrayBuffer());

    expect(entries.map((entry) => entry.name)).toEqual(['session.geojson', 'photos/01J5.jpg']);
    expect(new TextDecoder().decode(entries[0].data)).toBe(geojson);
    expect([...entries[1].data]).toEqual([...photoBytes]);
  });
});
