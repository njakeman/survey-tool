import { describe, expect, test } from 'vitest';
import { loadReferenceFile, openReference } from './referenceZip.js';
import { buildZip } from './fixtures/buildZip.js';

// The two ends of a reference zip's life: loadReferenceFile at pick time
// (identity + parse, ready for the session-start screen) and openReference
// on a stored buffer (stations + lazy per-photo reads for the session).

const geojson = JSON.stringify({
  type: 'FeatureCollection',
  survey_session: {
    id: 'ref-sess-1',
    name: 'Long Barrow south',
    started_at: '2025-04-12T09:00:00.000Z',
    ended_at: null,
  },
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-0.14, 51.5] },
      properties: {
        obs_id: 'ref-1',
        recorded_at: '2025-04-12T10:00:00.000Z',
        fix_at: '2025-04-12T09:59:20.000Z',
        lat: 51.5,
        lon: -0.14,
        gps_accuracy_m: 4.1,
        note: 'Stone stile, west boundary.',
        photo: 'ref-1.jpg',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-0.141, 51.501] },
      properties: {
        obs_id: 'ref-2',
        recorded_at: '2025-04-12T10:30:00.000Z',
        fix_at: '2025-04-12T10:29:40.000Z',
        lat: 51.501,
        lon: -0.141,
        gps_accuracy_m: 6.3,
        note: 'Culvert head.',
        photo: null,
      },
    },
  ],
});

const photoBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x99]);

function referenceZip() {
  return buildZip([
    { name: 'session.geojson', data: geojson },
    { name: 'photos/ref-1.jpg', data: photoBytes },
  ]);
}

function fileOf(buffer, name = 'long-barrow-2025-04-12.zip') {
  return { name, arrayBuffer: async () => buffer };
}

describe('loadReferenceFile', () => {
  test('returns the buffer, the stations and a session.reference-shaped identity', async () => {
    const loaded = await loadReferenceFile(fileOf(referenceZip()));

    expect(loaded.buffer).toBeInstanceOf(ArrayBuffer);
    expect(loaded.stations.map((s) => s.id)).toEqual(['ref-1', 'ref-2']);
    expect(loaded.reference).toEqual({
      filename: 'long-barrow-2025-04-12.zip',
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      sessionId: 'ref-sess-1',
      sessionName: 'Long Barrow south',
      startedAt: '2025-04-12T09:00:00.000Z',
      stationCount: 2,
      photoCount: 1,
    });
  });

  test('the hash identifies the exact picked file — same bytes, same hash', async () => {
    const zip = referenceZip();

    const first = await loadReferenceFile(fileOf(zip));
    const second = await loadReferenceFile(fileOf(zip, 'renamed.zip'));

    expect(second.reference.hash).toBe(first.reference.hash);
    expect(second.reference.filename).toBe('renamed.zip');
  });

  test('a file that is not a session export fails with a named reason', async () => {
    const notExport = buildZip([{ name: 'readme.txt', data: 'hello' }]);

    await expect(loadReferenceFile(fileOf(notExport))).rejects.toThrow(/session\.geojson/);
  });
});

describe('openReference', () => {
  test('reads one photo lazily, byte for byte', async () => {
    const opened = await openReference(referenceZip());

    const data = await opened.readPhoto('photos/ref-1.jpg');

    expect([...data]).toEqual([...photoBytes]);
  });

  test('stations carry the entry names readPhoto takes', async () => {
    const opened = await openReference(referenceZip());

    expect(opened.stations[0].photoEntryName).toBe('photos/ref-1.jpg');
    expect(opened.stations[1].photoEntryName).toBeNull();
  });

  test('an entry name the zip does not hold fails by name, never returns short data', async () => {
    const opened = await openReference(referenceZip());

    await expect(opened.readPhoto('photos/missing.jpg')).rejects.toThrow(/missing\.jpg/);
  });
});
