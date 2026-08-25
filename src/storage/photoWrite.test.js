import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import {
  addObservationPhoto,
  replaceObservationPhoto,
  deleteObservationPhoto,
} from './photoWrite.js';
import { getObservation, putObservation } from './observationStore.js';
import { getPhoto, putPhoto } from './photoStore.js';
import { putSession, getSession } from './sessionStore.js';
import { createObservation } from '../domain/observation.js';

const CHANGED_AT = '2026-08-14T10:00:00.000Z';

async function seed(db, { photos = [] } = {}) {
  await putSession(db, {
    id: 'sess-1',
    name: 'Site A',
    startedAt: '2026-08-06T09:00:00.000Z',
    endedAt: null,
    status: 'open',
  });
  const observation = createObservation({
    id: 'obs-1',
    sessionId: 'sess-1',
    recordedAt: '2026-08-06T10:00:00.000Z',
    fixAt: '2026-08-06T10:00:00.000Z',
    lat: 51.5,
    lon: -0.14,
    gpsAccuracyM: 8,
    photos: photos.map((id) => ({ id, referencePhoto: null })),
  });
  await putObservation(db, observation);
  for (const id of photos) {
    await putPhoto(db, {
      id,
      blob: new Blob([`old ${id}`], { type: 'image/jpeg' }),
      contentType: 'image/jpeg',
    });
  }
  return observation;
}

describe('addObservationPhoto', () => {
  test('appends after existing photos and stamps both change marks', async () => {
    const db = await openDatabase('photo-write-append');
    await seed(db, { photos: ['a'] });

    await addObservationPhoto(db, {
      observationId: 'obs-1',
      photo: { id: 'p2', blob: new Blob(['new jpeg'], { type: 'image/jpeg' }) },
      changedAt: CHANGED_AT,
    });

    const obs = await getObservation(db, 'obs-1');
    expect(obs.photos).toEqual([
      { id: 'a', referencePhoto: null },
      { id: 'p2', referencePhoto: null },
    ]);
    expect(obs.changedAt).toBe(CHANGED_AT);
    expect((await getSession(db, 'sess-1')).changedSinceExportAt).toBe(CHANGED_AT);
    db.close();
  });

  test('stores the ArrayBuffer, never the Blob', async () => {
    const db = await openDatabase('photo-write-arraybuffer');
    await seed(db);

    await addObservationPhoto(db, {
      observationId: 'obs-1',
      photo: { id: 'p2', blob: new Blob(['bytes'], { type: 'image/jpeg' }) },
      changedAt: CHANGED_AT,
    });

    const raw = await db.get('photos', 'p2');
    expect(raw.arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(raw).not.toHaveProperty('blob');
    db.close();
  });

  test('writes nothing when the blob fails to read', async () => {
    const db = await openDatabase('photo-write-failed-blob');
    await seed(db, { photos: ['a'] });
    const failingBlob = {
      type: 'image/jpeg',
      arrayBuffer: () => Promise.reject(new Error('read failed')),
    };

    await expect(
      addObservationPhoto(db, {
        observationId: 'obs-1',
        photo: { id: 'p2', blob: failingBlob },
        changedAt: CHANGED_AT,
      }),
    ).rejects.toThrow('read failed');

    expect((await getObservation(db, 'obs-1')).photos).toEqual([{ id: 'a', referencePhoto: null }]);
    expect((await getSession(db, 'sess-1')).changedSinceExportAt).toBeUndefined();
    db.close();
  });

  test('throws on an unknown observation', async () => {
    const db = await openDatabase('photo-write-unknown');
    await seed(db);

    await expect(
      addObservationPhoto(db, {
        observationId: 'nope',
        photo: { id: 'p2', blob: new Blob(['bytes'], { type: 'image/jpeg' }) },
        changedAt: CHANGED_AT,
      }),
    ).rejects.toThrow(/no observation/);
    db.close();
  });
});

describe('replaceObservationPhoto', () => {
  test('swaps the slot for a fresh id in place, keeping order and referencePhoto, deleting the old record', async () => {
    const db = await openDatabase('photo-replace');
    await putSession(db, {
      id: 'sess-1',
      name: 'Site A',
      startedAt: '2026-08-06T09:00:00.000Z',
      endedAt: null,
      status: 'open',
    });
    const observation = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T10:00:00.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8,
      photos: [
        { id: 'a', referencePhoto: 'r.jpg' },
        { id: 'b', referencePhoto: null },
      ],
      referenceObservationId: 'ref-1',
    });
    await putObservation(db, observation);
    await putPhoto(db, {
      id: 'a',
      blob: new Blob(['old a'], { type: 'image/jpeg' }),
      contentType: 'image/jpeg',
    });
    await putPhoto(db, {
      id: 'b',
      blob: new Blob(['old b'], { type: 'image/jpeg' }),
      contentType: 'image/jpeg',
    });

    await replaceObservationPhoto(db, {
      observationId: 'obs-1',
      photoId: 'a',
      photo: { id: 'p2', blob: new Blob(['second attempt'], { type: 'image/jpeg' }) },
      changedAt: CHANGED_AT,
    });

    const obs = await getObservation(db, 'obs-1');
    expect(obs.photos).toEqual([
      { id: 'p2', referencePhoto: 'r.jpg' },
      { id: 'b', referencePhoto: null },
    ]);
    expect(obs.changedAt).toBe(CHANGED_AT);
    expect((await getSession(db, 'sess-1')).changedSinceExportAt).toBe(CHANGED_AT);
    expect(await getPhoto(db, 'a')).toBeUndefined();
    expect(await (await getPhoto(db, 'p2')).blob.text()).toBe('second attempt');
    db.close();
  });

  test('throws when photoId is not on the observation', async () => {
    const db = await openDatabase('photo-replace-unknown-slot');
    await seed(db, { photos: ['a'] });

    await expect(
      replaceObservationPhoto(db, {
        observationId: 'obs-1',
        photoId: 'nope',
        photo: { id: 'p2', blob: new Blob(['bytes'], { type: 'image/jpeg' }) },
        changedAt: CHANGED_AT,
      }),
    ).rejects.toThrow(/not attached/);
    db.close();
  });
});

describe('deleteObservationPhoto', () => {
  test('removes only that slot and record, stamping both marks', async () => {
    const db = await openDatabase('photo-delete-one');
    await seed(db, { photos: ['a', 'b'] });

    await deleteObservationPhoto(db, {
      observationId: 'obs-1',
      photoId: 'a',
      changedAt: CHANGED_AT,
    });

    const obs = await getObservation(db, 'obs-1');
    expect(obs.photos).toEqual([{ id: 'b', referencePhoto: null }]);
    expect(obs.changedAt).toBe(CHANGED_AT);
    expect((await getSession(db, 'sess-1')).changedSinceExportAt).toBe(CHANGED_AT);
    expect(await getPhoto(db, 'a')).toBeUndefined();
    expect(await getPhoto(db, 'b')).toBeDefined();
    db.close();
  });

  test('leaves an empty array when the last photo goes', async () => {
    const db = await openDatabase('photo-delete-last');
    await seed(db, { photos: ['a'] });

    await deleteObservationPhoto(db, {
      observationId: 'obs-1',
      photoId: 'a',
      changedAt: CHANGED_AT,
    });

    expect((await getObservation(db, 'obs-1')).photos).toEqual([]);
    db.close();
  });

  test('throws when photoId is not on the observation', async () => {
    const db = await openDatabase('photo-delete-unknown-slot');
    await seed(db, { photos: ['a'] });

    await expect(
      deleteObservationPhoto(db, {
        observationId: 'obs-1',
        photoId: 'nope',
        changedAt: CHANGED_AT,
      }),
    ).rejects.toThrow(/not attached/);
    db.close();
  });
});
