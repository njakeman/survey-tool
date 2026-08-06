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
      photoId: 'obs-1',
    });
    const blob = new Blob(['real browser blob bytes'], { type: 'image/jpeg' });

    await saveObservationWithPhoto(db, {
      observation,
      photo: { id: 'obs-1', blob, contentType: 'image/jpeg' },
    });

    expect(await getObservation(db, 'obs-1')).toEqual(observation);
    const photo = await getPhoto(db, 'obs-1');
    expect(photo.contentType).toBe('image/jpeg');
    expect(await photo.blob.text()).toBe('real browser blob bytes');

    db.close();
  });
});
