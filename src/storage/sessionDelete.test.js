import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import { saveObservationWithPhoto } from './captureWrite.js';
import { deleteSessionWithData } from './sessionDelete.js';
import { getObservation, listObservationsForSession } from './observationStore.js';
import { getPhoto } from './photoStore.js';
import { getAudio } from './audioStore.js';
import { getSession, putSession } from './sessionStore.js';
import {
  appendTraceVertex,
  listTraceDrafts,
  listTraceVertices,
  putTraceDraft,
} from './traceDraftStore.js';
import { getReference, listStationStates, putReference, putStationState } from './revisitStore.js';
import { createSession, closeSession } from '../domain/session.js';
import { createObservation } from '../domain/observation.js';

function makeSession(id = 'sess-1') {
  return closeSession(
    createSession({ id, name: 'Ashton Keynes', startedAt: '2026-08-06T10:00:00.000Z' }),
    '2026-08-06T12:00:00.000Z',
  );
}

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

describe('deleteSessionWithData', () => {
  test('deletes the session, its observations, and their photos and voice notes', async () => {
    const db = await openDatabase('session-delete-cascade');
    await putSession(db, makeSession());
    const blob = new Blob(['bytes'], { type: 'image/jpeg' });
    await saveObservationWithPhoto(db, {
      observation: makeObservation({
        id: 'obs-1',
        photos: [{ id: 'obs-1', referencePhoto: null }],
        audioId: 'obs-1',
      }),
      photos: [{ id: 'obs-1', blob, contentType: 'image/jpeg' }],
      audio: { id: 'obs-1', blob, contentType: 'audio/mp4' },
    });
    await saveObservationWithPhoto(db, { observation: makeObservation({ id: 'obs-2' }) });

    await deleteSessionWithData(db, 'sess-1');

    expect(await getSession(db, 'sess-1')).toBeUndefined();
    expect(await listObservationsForSession(db, 'sess-1')).toEqual([]);
    expect(await getPhoto(db, 'obs-1')).toBeUndefined();
    expect(await getAudio(db, 'obs-1')).toBeUndefined();
    db.close();
  });

  test('deletes every photo an observation holds', async () => {
    const db = await openDatabase('session-delete-two-photos');
    await putSession(db, makeSession());
    const blob = new Blob(['bytes'], { type: 'image/jpeg' });
    await saveObservationWithPhoto(db, {
      observation: makeObservation({
        id: 'obs-1',
        photos: [
          { id: 'p1', referencePhoto: null },
          { id: 'p2', referencePhoto: null },
        ],
      }),
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

    await deleteSessionWithData(db, 'sess-1');

    expect(await getPhoto(db, 'p1')).toBeUndefined();
    expect(await getPhoto(db, 'p2')).toBeUndefined();
    db.close();
  });

  test('leaves other sessions and their data standing', async () => {
    const db = await openDatabase('session-delete-scoped');
    await putSession(db, makeSession('sess-1'));
    await putSession(db, makeSession('sess-2'));
    await saveObservationWithPhoto(db, { observation: makeObservation({ id: 'obs-1' }) });
    await saveObservationWithPhoto(db, {
      observation: makeObservation({ id: 'obs-2', sessionId: 'sess-2' }),
    });

    await deleteSessionWithData(db, 'sess-1');

    expect(await getSession(db, 'sess-2')).toBeDefined();
    expect(await getObservation(db, 'obs-2')).toBeDefined();
    db.close();
  });

  test('deletes a stale trace draft and its vertices along with the session', async () => {
    // A force-quit mid-walk can leave a draft behind; a deleted session must
    // not leave one pointing at nothing, or relaunch recovery would offer to
    // resume a walk into a session that no longer exists.
    const db = await openDatabase('session-delete-draft');
    await putSession(db, makeSession('sess-1'));
    await putSession(db, makeSession('sess-2'));
    await putTraceDraft(db, {
      id: 'draft-1',
      sessionId: 'sess-1',
      mode: 'path',
      startedAt: '2026-08-06T10:30:00.000Z',
    });
    await appendTraceVertex(db, 'draft-1', { seq: 0, lat: 51.5, lon: -0.14 });
    await putTraceDraft(db, {
      id: 'draft-2',
      sessionId: 'sess-2',
      mode: 'path',
      startedAt: '2026-08-06T10:30:00.000Z',
    });

    await deleteSessionWithData(db, 'sess-1');

    expect((await listTraceDrafts(db)).map((d) => d.id)).toEqual(['draft-2']);
    expect(await listTraceVertices(db, 'draft-1')).toEqual([]);
    db.close();
  });

  test('is idempotent — deleting a session that does not exist resolves without error', async () => {
    const db = await openDatabase('session-delete-missing');
    await expect(deleteSessionWithData(db, 'nope')).resolves.toBeUndefined();
    db.close();
  });

  test('deletes a revisit session’s reference bytes and station claims along with it', async () => {
    // The reference is keyed to the session and invisible everywhere else —
    // leaving it behind would be multi-megabyte storage nothing collects.
    const db = await openDatabase('session-delete-revisit');
    await putSession(db, makeSession('sess-1'));
    await putSession(db, makeSession('sess-2'));
    await putReference(db, {
      sessionId: 'sess-1',
      arrayBuffer: new ArrayBuffer(8),
      filename: 'ref.zip',
      hash: 'a'.repeat(64),
    });
    await putReference(db, {
      sessionId: 'sess-2',
      arrayBuffer: new ArrayBuffer(8),
      filename: 'other.zip',
      hash: 'b'.repeat(64),
    });
    await putStationState(db, {
      sessionId: 'sess-1',
      refObsId: 'ref-2',
      state: 'skipped',
      reason: null,
      updatedAt: '2026-08-21T10:00:00.000Z',
    });
    await putStationState(db, {
      sessionId: 'sess-2',
      refObsId: 'ref-1',
      state: 'noAccess',
      reason: null,
      updatedAt: '2026-08-21T10:00:00.000Z',
    });

    await deleteSessionWithData(db, 'sess-1');

    expect(await getReference(db, 'sess-1')).toBeUndefined();
    expect(await listStationStates(db, 'sess-1')).toEqual([]);
    expect(await getReference(db, 'sess-2')).toBeDefined();
    expect(await listStationStates(db, 'sess-2')).toHaveLength(1);
    db.close();
  });

  test('opens exactly one transaction, spanning every store a session can reach', async () => {
    // A kill between separate deletes would orphan media or vertices that
    // nothing would ever collect — same rule as captureDelete.js.
    const db = await openDatabase('session-delete-single-tx');
    await putSession(db, makeSession());
    await saveObservationWithPhoto(db, { observation: makeObservation() });
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

    await deleteSessionWithData(trackingDb, 'sess-1');

    expect(opened).toEqual([
      [
        'audio',
        'observations',
        'photos',
        'revisitReferences',
        'revisitStations',
        'sessions',
        'traceDrafts',
        'traceVertices',
      ],
    ]);
    db.close();
  });
});
