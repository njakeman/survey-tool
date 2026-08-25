import 'fake-indexeddb/auto';
import { describe, expect, test, vi } from 'vitest';
import { openDB } from 'idb';
import { openDatabase, DB_VERSION } from './db.js';

describe('openDatabase', () => {
  test('creates the sessions, observations, photos, basemap, settings, featureLayers, audio, trace and revisit stores', async () => {
    const db = await openDatabase('db-test-stores');
    expect([...db.objectStoreNames].sort()).toEqual([
      'audio',
      'basemap',
      'featureLayers',
      'observations',
      'photos',
      'revisitReferences',
      'revisitStations',
      'sessions',
      'settings',
      'traceDrafts',
      'traceVertices',
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
    // openDatabase() upgrades all the way to DB_VERSION, so the v8 branch
    // folds this photoId-less observation's (absent) photo into photos: [].
    expect(await db.get('observations', 'obs-1')).toEqual({
      id: 'obs-1',
      sessionId: 'sess-1',
      note: 'gate post',
      photos: [],
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

  test('upgrades a v5 database to v6, adding the trace stores without disturbing a voice note', async () => {
    // v5 is what shipped with voice notes; real devices hold recordings.
    const v5 = await openDB('db-test-upgrade-v6', 5, {
      upgrade(db) {
        db.createObjectStore('sessions', { keyPath: 'id' });
        const observations = db.createObjectStore('observations', { keyPath: 'id' });
        observations.createIndex('by-session', 'sessionId');
        db.createObjectStore('photos', { keyPath: 'id' });
        db.createObjectStore('basemap', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('featureLayers', { keyPath: 'id' });
        db.createObjectStore('audio', { keyPath: 'id' });
      },
    });
    await v5.put('audio', {
      id: 'obs-1',
      arrayBuffer: new ArrayBuffer(6),
      contentType: 'audio/webm',
    });
    v5.close();

    const db = await openDatabase('db-test-upgrade-v6');

    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames]).toContain('traceDrafts');
    expect([...db.objectStoreNames]).toContain('traceVertices');
    expect((await db.get('audio', 'obs-1')).arrayBuffer.byteLength).toBe(6);
    db.close();
  });

  test('upgrades a v6 database to v7, adding the revisit stores without disturbing a trace draft', async () => {
    // v6 is what shipped with trace modes; a force-quit can leave a draft
    // mid-walk, and the upgrade must not cost the surveyor that recovery.
    const v6 = await openDB('db-test-upgrade-v7', 6, {
      upgrade(db) {
        db.createObjectStore('sessions', { keyPath: 'id' });
        const observations = db.createObjectStore('observations', { keyPath: 'id' });
        observations.createIndex('by-session', 'sessionId');
        db.createObjectStore('photos', { keyPath: 'id' });
        db.createObjectStore('basemap', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('featureLayers', { keyPath: 'id' });
        db.createObjectStore('audio', { keyPath: 'id' });
        db.createObjectStore('traceDrafts', { keyPath: 'id' });
        db.createObjectStore('traceVertices', { keyPath: ['draftId', 'seq'] });
      },
    });
    await v6.put('traceDrafts', { id: 'draft-1', sessionId: 'sess-1', mode: 'path' });
    await v6.put('traceVertices', { draftId: 'draft-1', seq: 0, lat: 51.5, lon: -0.14 });
    v6.close();

    const db = await openDatabase('db-test-upgrade-v7');

    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames]).toContain('revisitReferences');
    expect([...db.objectStoreNames]).toContain('revisitStations');
    expect(await db.get('traceDrafts', 'draft-1')).toEqual({
      id: 'draft-1',
      sessionId: 'sess-1',
      mode: 'path',
    });
    db.close();
  });

  test('upgrades a v7 database to v8, folding photoId/referencePhoto into photos[]', async () => {
    const v7 = await openDB('db-test-upgrade-v8', 7, {
      upgrade(db) {
        db.createObjectStore('sessions', { keyPath: 'id' });
        const observations = db.createObjectStore('observations', { keyPath: 'id' });
        observations.createIndex('by-session', 'sessionId');
        db.createObjectStore('photos', { keyPath: 'id' });
        db.createObjectStore('basemap', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('featureLayers', { keyPath: 'id' });
        db.createObjectStore('audio', { keyPath: 'id' });
        db.createObjectStore('traceDrafts', { keyPath: 'id' });
        db.createObjectStore('traceVertices', { keyPath: ['draftId', 'seq'] });
        db.createObjectStore('revisitReferences', { keyPath: 'sessionId' });
        db.createObjectStore('revisitStations', { keyPath: ['sessionId', 'refObsId'] });
      },
    });
    await v7.put('observations', {
      id: 'obs-1',
      sessionId: 's',
      photoId: 'obs-1',
      referencePhoto: null,
      note: 'a',
    });
    await v7.put('observations', {
      id: 'obs-2',
      sessionId: 's',
      photoId: 'p9',
      referencePhoto: 'ref.jpg',
      referenceObservationId: 'r1',
    });
    await v7.put('observations', {
      id: 'obs-3',
      sessionId: 's',
      photoId: null,
      referencePhoto: null,
    });
    await v7.put('photos', {
      id: 'obs-1',
      arrayBuffer: new ArrayBuffer(4),
      contentType: 'image/jpeg',
    });
    v7.close();

    const db = await openDatabase('db-test-upgrade-v8');

    expect(db.version).toBe(DB_VERSION);
    expect(await db.get('observations', 'obs-1')).toEqual({
      id: 'obs-1',
      sessionId: 's',
      note: 'a',
      photos: [{ id: 'obs-1', referencePhoto: null }],
    });
    expect((await db.get('observations', 'obs-2')).photos).toEqual([
      { id: 'p9', referencePhoto: 'ref.jpg' },
    ]);
    expect((await db.get('observations', 'obs-2')).referenceObservationId).toBe('r1');
    expect((await db.get('observations', 'obs-3')).photos).toEqual([]);
    expect(await db.get('observations', 'obs-3')).not.toHaveProperty('photoId');
    expect((await db.get('photos', 'obs-1')).arrayBuffer.byteLength).toBe(4);
    db.close();
  });

  test('aborts the v8 upgrade and rejects if a cursor rewrite throws, leaving v7 data intact', async () => {
    const v7 = await openDB('db-test-upgrade-v8-abort', 7, {
      upgrade(db) {
        db.createObjectStore('sessions', { keyPath: 'id' });
        const observations = db.createObjectStore('observations', { keyPath: 'id' });
        observations.createIndex('by-session', 'sessionId');
        db.createObjectStore('photos', { keyPath: 'id' });
        db.createObjectStore('basemap', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('featureLayers', { keyPath: 'id' });
        db.createObjectStore('audio', { keyPath: 'id' });
        db.createObjectStore('traceDrafts', { keyPath: 'id' });
        db.createObjectStore('traceVertices', { keyPath: ['draftId', 'seq'] });
        db.createObjectStore('revisitReferences', { keyPath: 'sessionId' });
        db.createObjectStore('revisitStations', { keyPath: ['sessionId', 'refObsId'] });
      },
    });
    await v7.put('observations', { id: 'obs-1', sessionId: 's', photoId: 'obs-1', note: 'a' });
    v7.close();

    // cursor.value is structured-cloned by real/fake IndexedDB, so stored
    // data can't carry a throwing getter — force the failure the same way a
    // real DataError/InvalidStateError would arrive, by making the native
    // cursor.update() throw.
    const updateSpy = vi.spyOn(globalThis.IDBCursor.prototype, 'update').mockImplementation(() => {
      throw new DOMException('forced failure', 'DataError');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(openDatabase('db-test-upgrade-v8-abort')).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalledWith('DB v8 upgrade failed — rolling back', expect.any(Error));

    updateSpy.mockRestore();
    errorSpy.mockRestore();

    // The aborted upgrade must not have bumped the on-disk version or kept
    // any partial rewrite — reopening at v7 (no upgrade needed) proves the
    // database is still v7 with obs-1 in its original, unmigrated shape.
    const stillV7 = await openDB('db-test-upgrade-v8-abort', 7);
    expect(stillV7.version).toBe(7);
    expect(await stillV7.get('observations', 'obs-1')).toEqual({
      id: 'obs-1',
      sessionId: 's',
      photoId: 'obs-1',
      note: 'a',
    });
    stillV7.close();
  });
});
