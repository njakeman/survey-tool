import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import { putSession, getSession, listSessions } from './sessionStore.js';
import { createSession, closeSession } from '../domain/session.js';

async function freshDb(name) {
  return openDatabase(name);
}

describe('putSession / getSession', () => {
  test('stores a session and reads it back unchanged', async () => {
    const db = await freshDb('session-store-roundtrip');
    const session = createSession({
      id: 'sess-1',
      name: 'Ashton Keynes',
      startedAt: '2026-08-06T09:00:00.000Z',
    });

    await putSession(db, session);

    expect(await getSession(db, 'sess-1')).toEqual(session);
    db.close();
  });

  test('returns undefined for a session that does not exist', async () => {
    const db = await freshDb('session-store-missing');
    expect(await getSession(db, 'nope')).toBeUndefined();
    db.close();
  });

  test('overwrites an existing session with the same id (used to persist closeSession)', async () => {
    const db = await freshDb('session-store-overwrite');
    const open = createSession({
      id: 'sess-1',
      name: 'Ashton Keynes',
      startedAt: '2026-08-06T09:00:00.000Z',
    });
    await putSession(db, open);

    const closed = closeSession(open, '2026-08-06T12:00:00.000Z');
    await putSession(db, closed);

    expect(await getSession(db, 'sess-1')).toEqual(closed);
    db.close();
  });
});

describe('listSessions', () => {
  test('returns an empty array when no sessions exist', async () => {
    const db = await freshDb('session-store-list-empty');
    expect(await listSessions(db)).toEqual([]);
    db.close();
  });

  test('returns every stored session', async () => {
    const db = await freshDb('session-store-list-all');
    const a = createSession({
      id: 'sess-a',
      name: 'Site A',
      startedAt: '2026-08-06T09:00:00.000Z',
    });
    const b = createSession({
      id: 'sess-b',
      name: 'Site B',
      startedAt: '2026-08-06T10:00:00.000Z',
    });
    await putSession(db, a);
    await putSession(db, b);

    const sessions = await listSessions(db);

    expect(sessions.map((s) => s.id).sort()).toEqual(['sess-a', 'sess-b']);
    db.close();
  });
});
