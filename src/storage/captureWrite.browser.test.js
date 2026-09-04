import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import { saveObservationWithPhoto } from './captureWrite.js';
import { getObservation } from './observationStore.js';
import { getPhoto } from './photoStore.js';
import { createObservation } from '../domain/observation.js';

// Real IndexedDB in chromium + webkit (vitest.config.js), following the
// pattern in storage.browser.test.js — the multi-store transaction and the
// ArrayBuffer-not-Blob storage shape both need proving against real engines.
describe('saveObservationWithPhoto against real IndexedDB', () => {
  test('writes observation and a real photo Blob together in one transaction, round-tripping intact', async () => {
    const db = await openDatabase(`browser-capture-write-${Math.random()}`);
    const observation = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T10:00:00.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8,
      photos: [{ id: 'obs-1' }],
    });
    const blob = new Blob(['real browser blob bytes'], { type: 'image/jpeg' });

    await saveObservationWithPhoto(db, {
      observation,
      photos: [{ id: 'obs-1', blob, contentType: 'image/jpeg' }],
    });

    expect(await getObservation(db, 'obs-1')).toEqual(observation);
    const photo = await getPhoto(db, 'obs-1');
    expect(photo.contentType).toBe('image/jpeg');
    expect(await photo.blob.text()).toBe('real browser blob bytes');

    db.close();
  });

  test('writes every photo of a multi-photo observation in the one transaction', async () => {
    // Two photos, both records and both slots, against a real engine: the
    // node tier proves the loop, this proves the multi-put transaction and
    // that capture order survives a real round trip.
    const db = await openDatabase(`browser-capture-write-multi-${Math.random()}`);
    const observation = createObservation({
      id: 'obs-2',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T10:00:00.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8,
      referenceObservationId: 'ref-1',
      photos: [
        {
          id: 'p1',
          referencePhoto: 'ref-1.jpg',
          focalLength35mm: null,
          focalLengthMm: null,
          lensModel: null,
        },
        {
          id: 'p2',
          referencePhoto: null,
          focalLength35mm: null,
          focalLengthMm: null,
          lensModel: null,
        },
      ],
    });

    await saveObservationWithPhoto(db, {
      observation,
      photos: [
        {
          id: 'p1',
          blob: new Blob(['first browser bytes'], { type: 'image/jpeg' }),
          contentType: 'image/jpeg',
        },
        {
          id: 'p2',
          blob: new Blob(['second browser bytes'], { type: 'image/jpeg' }),
          contentType: 'image/jpeg',
        },
      ],
    });

    const stored = await getObservation(db, 'obs-2');
    expect(stored.photos).toEqual([
      {
        id: 'p1',
        referencePhoto: 'ref-1.jpg',
        focalLength35mm: null,
        focalLengthMm: null,
        lensModel: null,
      },
      {
        id: 'p2',
        referencePhoto: null,
        focalLength35mm: null,
        focalLengthMm: null,
        lensModel: null,
      },
    ]);
    expect(await (await getPhoto(db, 'p1')).blob.text()).toBe('first browser bytes');
    expect(await (await getPhoto(db, 'p2')).blob.text()).toBe('second browser bytes');

    db.close();
  });
});
