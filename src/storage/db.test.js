import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDB } from 'idb';
import { openDatabase, DB_VERSION } from './db.js';

describe('openDatabase', () => {
  test('creates the sessions, observations, photos and basemap object stores', async () => {
    const db = await openDatabase('db-test-stores');
    expect([...db.objectStoreNames].sort()).toEqual([
      'basemap',
      'observations',
      'photos',
      'sessions',
    ]);
    db.close();
  });

  test("indexes observations by sessionId, for listing a session's observations", async () => {
    const db = await openDatabase('db-test-index');
    const tx = db.transaction('observations', 'readonly');
    expect([...tx.store.indexNames]).toEqual(['by-session']);
    db.close();
  });

  test('upgrades a v1 database in place, preserving its data', async () => {
    // Real devices have v1 databases with survey data in them — the upgrade
    // path must add the new store without touching existing records.
    const v1 = await openDB('db-test-upgrade', 1, {
      upgrade(db) {
        db.createObjectStore('sessions', { keyPath: 'id' });
        const observations = db.createObjectStore('observations', { keyPath: 'id' });
        observations.createIndex('by-session', 'sessionId');
        db.createObjectStore('photos', { keyPath: 'id' });
      },
    });
    await v1.put('sessions', { id: 'sess-1', name: 'Ashton Keynes' });
    v1.close();

    const db = await openDatabase('db-test-upgrade');

    expect(db.version).toBe(DB_VERSION);
    expect(db.version).toBeGreaterThanOrEqual(2);
    expect([...db.objectStoreNames]).toContain('basemap');
    expect(await db.get('sessions', 'sess-1')).toEqual({ id: 'sess-1', name: 'Ashton Keynes' });
    db.close();
  });
});
