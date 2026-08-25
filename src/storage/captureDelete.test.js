import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import { saveObservationWithPhoto } from './captureWrite.js';
import { deleteObservationWithPhoto } from './captureDelete.js';
import { getObservation } from './observationStore.js';
import { getPhoto } from './photoStore.js';
import { createObservation } from '../domain/observation.js';

function makeObservation(overrides = {}) {
  return createObservation({
    id: 'obs-1',
    sessionId: 'sess-1',
    recordedAt: '2026-08-06T10:00:00.000Z',
    fixAt: '2026-08-06T10:00:00.000Z',
    lat: 51.5,
    lon: -0.14,
    gpsAccuracyM: 8,
    ...overrides,
  });
}

describe('deleteObservationWithPhoto', () => {
  test('deletes the observation and its photo', async () => {
    const db = await openDatabase('capture-delete-with-photo');
    const observation = makeObservation({ photos: [{ id: 'obs-1', referencePhoto: null }] });
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });
    await saveObservationWithPhoto(db, {
      observation,
      photos: [{ id: 'obs-1', blob, contentType: 'image/jpeg' }],
    });

    await deleteObservationWithPhoto(db, 'obs-1');

    expect(await getObservation(db, 'obs-1')).toBeUndefined();
    expect(await getPhoto(db, 'obs-1')).toBeUndefined();
    db.close();
  });

  test('deletes every photo an observation holds', async () => {
    const db = await openDatabase('capture-delete-with-two-photos');
    const observation = makeObservation({
      photos: [
        { id: 'p1', referencePhoto: null },
        { id: 'p2', referencePhoto: null },
      ],
    });
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });
    await saveObservationWithPhoto(db, {
      observation,
      photos: [
        { id: 'p1', blob, contentType: 'image/jpeg' },
        { id: 'p2', blob, contentType: 'image/jpeg' },
      ],
    });
    // Prove the fixture actually wrote both photos, so the post-delete
    // undefined checks below demonstrate the delete did the work rather
    // than the photos never having existed.
    expect(await getPhoto(db, 'p1')).toBeDefined();
    expect(await getPhoto(db, 'p2')).toBeDefined();

    await deleteObservationWithPhoto(db, 'obs-1');

    expect(await getObservation(db, 'obs-1')).toBeUndefined();
    expect(await getPhoto(db, 'p1')).toBeUndefined();
    expect(await getPhoto(db, 'p2')).toBeUndefined();
    db.close();
  });

  test('deletes an observation with no photo cleanly', async () => {
    const db = await openDatabase('capture-delete-no-photo');
    await saveObservationWithPhoto(db, { observation: makeObservation() });

    await deleteObservationWithPhoto(db, 'obs-1');

    expect(await getObservation(db, 'obs-1')).toBeUndefined();
    db.close();
  });

  test('is idempotent — deleting an id that does not exist resolves without error', async () => {
    const db = await openDatabase('capture-delete-missing');
    await expect(deleteObservationWithPhoto(db, 'nope')).resolves.toBeUndefined();
    db.close();
  });

  test('opens exactly one transaction, spanning both stores', async () => {
    const db = await openDatabase('capture-delete-single-tx');
    const observation = makeObservation({ photos: [{ id: 'obs-1', referencePhoto: null }] });
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });
    await saveObservationWithPhoto(db, {
      observation,
      photos: [{ id: 'obs-1', blob, contentType: 'image/jpeg' }],
    });
    const opened = [];
    const trackingDb = new Proxy(db, {
      get(target, prop) {
        if (prop === 'transaction') {
          return (storeNames, ...rest) => {
            opened.push([].concat(storeNames).sort());
            return target.transaction(storeNames, ...rest);
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    await deleteObservationWithPhoto(trackingDb, 'obs-1');

    expect(opened).toEqual([['audio', 'observations', 'photos']]);
    db.close();
  });
});
