import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';

describe('openDatabase', () => {
  test('creates the sessions, observations and photos object stores', async () => {
    const db = await openDatabase('db-test-stores');
    expect([...db.objectStoreNames].sort()).toEqual(['observations', 'photos', 'sessions']);
    db.close();
  });

  test("indexes observations by sessionId, for listing a session's observations", async () => {
    const db = await openDatabase('db-test-index');
    const tx = db.transaction('observations', 'readonly');
    expect([...tx.store.indexNames]).toEqual(['by-session']);
    db.close();
  });
});
