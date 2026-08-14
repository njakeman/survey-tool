import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import { setObservationPhoto, deleteObservationPhoto } from './photoWrite.js';
import { getObservation, putObservation } from './observationStore.js';
import { getPhoto, putPhoto } from './photoStore.js';
import { putSession, getSession } from './sessionStore.js';
import { createObservation } from '../domain/observation.js';

const CHANGED_AT = '2026-08-14T10:00:00.000Z';

async function seed(db, { photoId = null } = {}) {
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
    photoId,
  });
  await putObservation(db, observation);
  if (photoId) {
    await putPhoto(db, {
      id: photoId,
      blob: new Blob(['old jpeg bytes'], { type: 'image/jpeg' }),
      contentType: 'image/jpeg',
    });
  }
  return observation;
}

describe('setObservationPhoto', () => {
  test('attaches a photo to an observation that had none, stamping both change marks', async () => {
    const db = await openDatabase('photo-write-attach');
    await seed(db);

    await setObservationPhoto(db, {
      observationId: 'obs-1',
      photo: { id: 'photo-2', blob: new Blob(['new jpeg'], { type: 'image/jpeg' }) },
      changedAt: CHANGED_AT,
    });

    const obs = await getObservation(db, 'obs-1');
    expect(obs.photoId).toBe('photo-2');
    expect(obs.changedAt).toBe(CHANGED_AT);
    expect((await getSession(db, 'sess-1')).changedSinceExportAt).toBe(CHANGED_AT);
    const photo = await getPhoto(db, 'photo-2');
    expect(photo.contentType).toBe('image/jpeg');
    expect(await photo.blob.text()).toBe('new jpeg');
    db.close();
  });

  test('a retake repoints photoId to a fresh record and deletes the old one', async () => {
    // The fresh id is what busts a row's cached object URL — same id, same
    // stale image.
    const db = await openDatabase('photo-write-retake');
    await seed(db, { photoId: 'obs-1' });

    await setObservationPhoto(db, {
      observationId: 'obs-1',
      photo: { id: 'photo-2', blob: new Blob(['second attempt'], { type: 'image/jpeg' }) },
      changedAt: CHANGED_AT,
    });

    expect((await getObservation(db, 'obs-1')).photoId).toBe('photo-2');
    expect(await getPhoto(db, 'obs-1')).toBeUndefined();
    expect(await (await getPhoto(db, 'photo-2')).blob.text()).toBe('second attempt');
    db.close();
  });

  test('stores the ArrayBuffer, never the Blob, read before the transaction opens', async () => {
    const db = await openDatabase('photo-write-arraybuffer');
    await seed(db);

    await setObservationPhoto(db, {
      observationId: 'obs-1',
      photo: { id: 'photo-2', blob: new Blob(['bytes'], { type: 'image/jpeg' }) },
      changedAt: CHANGED_AT,
    });

    const raw = await db.get('photos', 'photo-2');
    expect(raw.arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(raw).not.toHaveProperty('blob');
    db.close();
  });

  test('writes nothing at all when the blob fails to read', async () => {
    const db = await openDatabase('photo-write-failed-blob');
    await seed(db, { photoId: 'obs-1' });
    const failingBlob = {
      type: 'image/jpeg',
      arrayBuffer: () => Promise.reject(new Error('read failed')),
    };

    await expect(
      setObservationPhoto(db, {
        observationId: 'obs-1',
        photo: { id: 'photo-2', blob: failingBlob },
        changedAt: CHANGED_AT,
      }),
    ).rejects.toThrow('read failed');

    expect((await getObservation(db, 'obs-1')).photoId).toBe('obs-1');
    expect(await getPhoto(db, 'obs-1')).toBeDefined();
    expect((await getSession(db, 'sess-1')).changedSinceExportAt).toBeUndefined();
    db.close();
  });

  test('throws on an unknown observation rather than inventing one', async () => {
    const db = await openDatabase('photo-write-unknown');
    await seed(db);

    await expect(
      setObservationPhoto(db, {
        observationId: 'nope',
        photo: { id: 'photo-2', blob: new Blob(['bytes'], { type: 'image/jpeg' }) },
        changedAt: CHANGED_AT,
      }),
    ).rejects.toThrow(/no observation/);
    db.close();
  });
});

describe('deleteObservationPhoto', () => {
  test('clears photoId, deletes the record, and stamps both change marks', async () => {
    const db = await openDatabase('photo-delete');
    await seed(db, { photoId: 'obs-1' });

    await deleteObservationPhoto(db, 'obs-1', CHANGED_AT);

    const obs = await getObservation(db, 'obs-1');
    expect(obs.photoId).toBeNull();
    expect(obs.changedAt).toBe(CHANGED_AT);
    expect(await getPhoto(db, 'obs-1')).toBeUndefined();
    expect((await getSession(db, 'sess-1')).changedSinceExportAt).toBe(CHANGED_AT);
    db.close();
  });

  test('throws on an unknown observation', async () => {
    const db = await openDatabase('photo-delete-unknown');
    await seed(db);

    await expect(deleteObservationPhoto(db, 'nope', CHANGED_AT)).rejects.toThrow(/no observation/);
    db.close();
  });
});
