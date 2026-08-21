import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import {
  putSessionWithReference,
  getReference,
  putStationState,
  deleteStationState,
  listStationStates,
} from './revisitStore.js';
import { createSession } from '../domain/session.js';

// Real IndexedDB in chromium + webkit. The revisit stores lean on the same
// two engine behaviours the trace stores do — composite-key ordering and
// the empty-array range sentinel — plus the one that motivated the
// ArrayBuffer rule in the first place: a multi-byte buffer keyed to a
// session must round-trip byte for byte in real engines (WebKit rejects
// Blobs here in ephemeral sessions; ArrayBuffers work everywhere).
describe('revisitStore against real IndexedDB', () => {
  test('the reference buffer rides the session write and reads back byte for byte', async () => {
    const db = await openDatabase(`browser-revisit-${Math.random()}`);
    const session = createSession({
      id: 'sess-1',
      name: '2026-08-21',
      startedAt: '2026-08-21T09:00:00.000Z',
      sessionType: 'revisit',
      reference: {
        filename: 'ref.zip',
        hash: 'a'.repeat(64),
        sessionId: 'ref-sess-1',
        sessionName: 'Long Barrow south',
        startedAt: '2025-04-12T09:00:00.000Z',
        stationCount: 1,
        photoCount: 1,
      },
    });
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 251, 7]);

    await putSessionWithReference(db, {
      session,
      referenceRecord: {
        sessionId: 'sess-1',
        arrayBuffer: bytes.buffer,
        filename: 'ref.zip',
        hash: 'a'.repeat(64),
      },
    });

    const stored = await getReference(db, 'sess-1');
    expect([...new Uint8Array(stored.arrayBuffer)]).toEqual([...bytes]);
    db.close();
  });

  test('station claims list per session and delete singly under the composite key', async () => {
    const db = await openDatabase(`browser-revisit-states-${Math.random()}`);
    const claim = (sessionId, refObsId, state) => ({
      sessionId,
      refObsId,
      state,
      reason: null,
      updatedAt: '2026-08-21T10:00:00.000Z',
    });

    await putStationState(db, claim('sess-1', 'ref-2', 'skipped'));
    await putStationState(db, claim('sess-1', 'ref-1', 'noAccess'));
    await putStationState(db, claim('sess-2', 'ref-1', 'skipped'));

    expect((await listStationStates(db, 'sess-1')).map((r) => r.refObsId)).toEqual([
      'ref-1',
      'ref-2',
    ]);

    await deleteStationState(db, 'sess-1', 'ref-1');

    expect((await listStationStates(db, 'sess-1')).map((r) => r.refObsId)).toEqual(['ref-2']);
    expect(await listStationStates(db, 'sess-2')).toHaveLength(1);
    db.close();
  });
});
