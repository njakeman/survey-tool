import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDB } from 'idb';
import { openDatabase, DB_VERSION } from './db.js';

describe('openDatabase', () => {
  test('creates the sessions, observations, photos, basemap, settings, featureLayers and audio stores', async () => {
    const db = await openDatabase('db-test-stores');
    expect([...db.objectStoreNames].sort()).toEqual([
      'audio',
      'basemap',
      'featureLayers',
      'observations',
      'photos',
      'sessions',
      'settings',
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

  test('upgrades a v2 database to v3, adding settings without disturbing a stored archive', async () => {
    // v2 is what Phase 4 shipped, so real devices may already hold a
    // multi-megabyte archive here — the upgrade must not touch it.
    const v2 = await openDB('db-test-upgrade-v3', 2, {
      upgrade(db) {
        db.createObjectStore('sessions', { keyPath: 'id' });
        const observations = db.createObjectStore('observations', { keyPath: 'id' });
        observations.createIndex('by-session', 'sessionId');
        db.createObjectStore('photos', { keyPath: 'id' });
        db.createObjectStore('basemap', { keyPath: 'id' });
      },
    });
    await v2.put('basemap', { id: 'north-wiltshire', arrayBuffer: new ArrayBuffer(8) });
    v2.close();

    const db = await openDatabase('db-test-upgrade-v3');

    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames]).toContain('settings');
    expect((await db.get('basemap', 'north-wiltshire')).arrayBuffer.byteLength).toBe(8);
    db.close();
  });

  test('upgrades a v3 database to v4, adding featureLayers without disturbing survey data', async () => {
    // v3 is what is on real devices today, carrying observations, photos and
    // downloaded archives. Gaining a store must cost none of them.
    const v3 = await openDB('db-test-upgrade-v4', 3, {
      upgrade(db) {
        db.createObjectStore('sessions', { keyPath: 'id' });
        const observations = db.createObjectStore('observations', { keyPath: 'id' });
        observations.createIndex('by-session', 'sessionId');
        db.createObjectStore('photos', { keyPath: 'id' });
        db.createObjectStore('basemap', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
      },
    });
    await v3.put('sessions', { id: 'sess-1', name: 'Ashton Keynes' });
    await v3.put('observations', { id: 'obs-1', sessionId: 'sess-1', note: 'gate post' });
    await v3.put('photos', { id: 'obs-1', arrayBuffer: new ArrayBuffer(4) });
    await v3.put('basemap', { id: 'north-wiltshire', arrayBuffer: new ArrayBuffer(8) });
    await v3.put('settings', { key: 'selectedBasemapId', value: 'north-wiltshire' });
    v3.close();

    const db = await openDatabase('db-test-upgrade-v4');

    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames]).toContain('featureLayers');
    expect(await db.get('observations', 'obs-1')).toEqual({
      id: 'obs-1',
      sessionId: 'sess-1',
      note: 'gate post',
    });
    expect((await db.get('photos', 'obs-1')).arrayBuffer.byteLength).toBe(4);
    expect((await db.get('basemap', 'north-wiltshire')).arrayBuffer.byteLength).toBe(8);
    expect((await db.get('settings', 'selectedBasemapId')).value).toBe('north-wiltshire');
    // The index survives a version bump only if it is left alone — recreating
    // it in the v4 branch would throw on an existing store.
    const tx = db.transaction('observations', 'readonly');
    expect([...tx.store.indexNames]).toEqual(['by-session']);
    db.close();
  });
});
