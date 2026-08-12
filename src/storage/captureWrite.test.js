import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import { saveObservationWithPhoto } from './captureWrite.js';
import { getObservation } from './observationStore.js';
import { getPhoto } from './photoStore.js';
import {
  appendTraceVertex,
  listTraceDrafts,
  listTraceVertices,
  putTraceDraft,
} from './traceDraftStore.js';
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

describe('saveObservationWithPhoto', () => {
  test('writes the observation alone when there is no photo', async () => {
    const db = await openDatabase('capture-write-no-photo');
    const observation = makeObservation();

    await saveObservationWithPhoto(db, { observation, photo: null });

    expect(await getObservation(db, 'obs-1')).toEqual(observation);
    expect(await getPhoto(db, 'obs-1')).toBeUndefined();
    db.close();
  });

  test('writes the observation and photo together, photo stored as arrayBuffer not blob', async () => {
    const db = await openDatabase('capture-write-with-photo');
    const observation = makeObservation({ photoId: 'obs-1' });
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });

    await saveObservationWithPhoto(db, {
      observation,
      photo: { id: 'obs-1', blob, contentType: 'image/jpeg' },
    });

    expect(await getObservation(db, 'obs-1')).toEqual(observation);
    const photo = await getPhoto(db, 'obs-1');
    expect(photo.contentType).toBe('image/jpeg');
    expect(await photo.blob.text()).toBe('fake jpeg bytes');
    db.close();
  });

  test('reads the photo blob into an ArrayBuffer before opening the transaction, never storing a Blob', async () => {
    const db = await openDatabase('capture-write-arraybuffer-shape');
    const observation = makeObservation({ photoId: 'obs-1' });
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });

    await saveObservationWithPhoto(db, {
      observation,
      photo: { id: 'obs-1', blob, contentType: 'image/jpeg' },
    });

    const tx = db.transaction('photos', 'readonly');
    const raw = await tx.store.get('obs-1');
    expect(raw.arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(raw).not.toHaveProperty('blob');
    db.close();
  });

  test('clears the trace draft and its vertices in the same transaction as the save', async () => {
    // A kill mid-save must leave either the draft (recoverable) or the
    // observation — never both, never neither.
    const db = await openDatabase('capture-write-trace-draft');
    await putTraceDraft(db, { id: 'draft-1', sessionId: 'sess-1', mode: 'path', startedAt: 't' });
    await appendTraceVertex(db, 'draft-1', {
      seq: 0,
      lat: 51.5,
      lon: -0.14,
      accuracyM: 5,
      fixAt: 't',
    });
    const observation = makeObservation({
      positionSource: 'trace',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-0.14, 51.5],
          [-0.141, 51.501],
        ],
      },
    });

    await saveObservationWithPhoto(db, { observation, traceDraftId: 'draft-1' });

    expect(await getObservation(db, 'obs-1')).toEqual(observation);
    expect(await listTraceDrafts(db)).toEqual([]);
    expect(await listTraceVertices(db, 'draft-1')).toEqual([]);
    db.close();
  });

  test('an ordinary save leaves a running trace draft alone', async () => {
    // Point observations are captured mid-trace; their save must not touch
    // the draft stores at all.
    const db = await openDatabase('capture-write-draft-untouched');
    await putTraceDraft(db, { id: 'draft-1', sessionId: 'sess-1', mode: 'path', startedAt: 't' });

    await saveObservationWithPhoto(db, { observation: makeObservation() });

    expect(await listTraceDrafts(db)).toHaveLength(1);
    db.close();
  });

  test('writes nothing when the photo blob fails to read, proving the buffer is read before the transaction opens', async () => {
    const db = await openDatabase('capture-write-failed-blob');
    const observation = makeObservation({ photoId: 'obs-1' });
    const failingBlob = { arrayBuffer: () => Promise.reject(new Error('read failed')) };

    await expect(
      saveObservationWithPhoto(db, {
        observation,
        photo: { id: 'obs-1', blob: failingBlob, contentType: 'image/jpeg' },
      }),
    ).rejects.toThrow('read failed');

    expect(await getObservation(db, 'obs-1')).toBeUndefined();
    expect(await getPhoto(db, 'obs-1')).toBeUndefined();
    db.close();
  });
});
