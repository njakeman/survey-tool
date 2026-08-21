import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import { getSession } from './sessionStore.js';
import {
  putSessionWithReference,
  getReference,
  putStationState,
  deleteStationState,
  listStationStates,
} from './revisitStore.js';
import { createSession } from '../domain/session.js';

const reference = {
  filename: 'long-barrow-2025-04-12.zip',
  hash: 'a'.repeat(64),
  sessionId: 'ref-sess-1',
  sessionName: 'Long Barrow south',
  startedAt: '2025-04-12T09:00:00.000Z',
  stationCount: 2,
  photoCount: 1,
};

function revisitSession(id = 'sess-1') {
  return createSession({
    id,
    name: '2026-08-21',
    startedAt: '2026-08-21T09:00:00.000Z',
    sessionType: 'revisit',
    reference,
  });
}

describe('putSessionWithReference', () => {
  test('writes the session and the reference bytes together', async () => {
    const db = await openDatabase('revisit-store-put');
    const session = revisitSession();

    await putSessionWithReference(db, {
      session,
      referenceRecord: {
        sessionId: session.id,
        arrayBuffer: new Uint8Array([1, 2, 3]).buffer,
        filename: reference.filename,
        hash: reference.hash,
      },
    });

    expect(await getSession(db, 'sess-1')).toEqual(session);
    const stored = await getReference(db, 'sess-1');
    expect(stored.filename).toBe('long-barrow-2025-04-12.zip');
    expect(stored.arrayBuffer.byteLength).toBe(3);
    db.close();
  });

  test('opens exactly one transaction — the session must never exist without its reference', async () => {
    const db = await openDatabase('revisit-store-single-tx');
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

    await putSessionWithReference(trackingDb, {
      session: revisitSession(),
      referenceRecord: {
        sessionId: 'sess-1',
        arrayBuffer: new ArrayBuffer(4),
        filename: reference.filename,
        hash: reference.hash,
      },
    });

    expect(opened).toEqual([['revisitReferences', 'sessions']]);
    db.close();
  });

  test('rejects a Blob at the door — the app-wide ArrayBuffer rule', async () => {
    // WebKit rejects Blob-in-IndexedDB in ephemeral sessions (see
    // photoStore.js); the runtime guard is the enforcement.
    const db = await openDatabase('revisit-store-blob');

    await expect(
      putSessionWithReference(db, {
        session: revisitSession(),
        referenceRecord: {
          sessionId: 'sess-1',
          arrayBuffer: new Blob(['zip bytes']),
          filename: reference.filename,
          hash: reference.hash,
        },
      }),
    ).rejects.toThrow(/ArrayBuffer, never a Blob/);
    db.close();
  });
});

describe('station states', () => {
  test('a claim is written per station and listed per session', async () => {
    const db = await openDatabase('revisit-store-states');

    await putStationState(db, {
      sessionId: 'sess-1',
      refObsId: 'ref-2',
      state: 'skipped',
      reason: null,
      updatedAt: '2026-08-21T10:00:00.000Z',
    });
    await putStationState(db, {
      sessionId: 'sess-1',
      refObsId: 'ref-3',
      state: 'noAccess',
      reason: 'field flooded',
      updatedAt: '2026-08-21T10:05:00.000Z',
    });
    await putStationState(db, {
      sessionId: 'sess-9',
      refObsId: 'ref-1',
      state: 'skipped',
      reason: null,
      updatedAt: '2026-08-21T10:06:00.000Z',
    });

    const states = await listStationStates(db, 'sess-1');

    expect(states.map((record) => record.refObsId)).toEqual(['ref-2', 'ref-3']);
    expect(states[1].reason).toBe('field flooded');
    db.close();
  });

  test('re-claiming a station overwrites — one claim per station, never a pile', async () => {
    const db = await openDatabase('revisit-store-overwrite');

    await putStationState(db, {
      sessionId: 'sess-1',
      refObsId: 'ref-2',
      state: 'skipped',
      reason: null,
      updatedAt: '2026-08-21T10:00:00.000Z',
    });
    await putStationState(db, {
      sessionId: 'sess-1',
      refObsId: 'ref-2',
      state: 'noAccess',
      reason: 'bull in field',
      updatedAt: '2026-08-21T10:10:00.000Z',
    });

    const states = await listStationStates(db, 'sess-1');

    expect(states).toHaveLength(1);
    expect(states[0].state).toBe('noAccess');
    db.close();
  });

  test('deleting a claim is the Undo — the station honestly reverts to to-do', async () => {
    const db = await openDatabase('revisit-store-undo');

    await putStationState(db, {
      sessionId: 'sess-1',
      refObsId: 'ref-2',
      state: 'skipped',
      reason: null,
      updatedAt: '2026-08-21T10:00:00.000Z',
    });
    await deleteStationState(db, 'sess-1', 'ref-2');

    expect(await listStationStates(db, 'sess-1')).toEqual([]);
    db.close();
  });
});
