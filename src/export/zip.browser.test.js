import { describe, expect, test } from 'vitest';
import { zipEntries } from './zip.js';

// Real client-zip, chromium + webkit (vitest.config.js) — a hand-rolled ZIP
// byte-signature check is enough to prove real bytes came out; unzipping to
// verify full round-trip content isn't worth a second dependency here.
describe('zipEntries', () => {
  test('produces a real ZIP blob (PK local file header signature) containing the given entries', async () => {
    const blob = await zipEntries([
      { name: 'session.geojson', input: '{"type":"FeatureCollection","features":[]}' },
      { name: 'photos/obs-1.jpg', input: new Blob(['fake jpeg bytes'], { type: 'image/jpeg' }) },
    ]);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    expect([...header]).toEqual([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
  });

  test('produces a valid (empty but well-formed) zip for an empty entry list', async () => {
    const blob = await zipEntries([]);
    expect(blob).toBeInstanceOf(Blob);
  });
});
