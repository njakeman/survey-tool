import { describe, expect, test } from 'vitest';
import { openDB } from 'idb';
import { openDatabase, DB_VERSION } from './db.js';
import { putSession, getSession } from './sessionStore.js';
import { putObservation, listObservationsForSession } from './observationStore.js';
import { putPhoto, getPhoto } from './photoStore.js';
import { createSession } from '../domain/session.js';
import { createObservation } from '../domain/observation.js';

// Runs against real IndexedDB in chromium + webkit (vitest.config.js) rather
// than fake-indexeddb — WebKit is what iOS actually ships, and Blob storage
// in particular has a history of browser-specific quirks that an in-memory
// fake can't surface.
describe('storage layer against real IndexedDB', () => {
  test('sessions and observations round-trip, including the by-session index', async () => {
    const db = await openDatabase(`browser-contract-${Math.random()}`);

    const session = createSession({
      id: 'sess-1',
      name: 'Ashton Keynes',
      startedAt: '2026-08-06T09:00:00.000Z',
    });
    await putSession(db, session);
    expect(await getSession(db, 'sess-1')).toEqual(session);

    const obs = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T10:00:00.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8,
    });
    await putObservation(db, obs);

    const results = await listObservationsForSession(db, 'sess-1');
    expect(results).toEqual([obs]);

    db.close();
  });

  test('a real photo Blob survives an IndexedDB round-trip with its content and type intact', async () => {
    const db = await openDatabase(`browser-contract-photo-${Math.random()}`);
    const blob = new Blob(['real browser blob bytes'], { type: 'image/jpeg' });

    await putPhoto(db, { id: 'obs-1', blob, contentType: 'image/jpeg' });
    const stored = await getPhoto(db, 'obs-1');

    expect(stored.contentType).toBe('image/jpeg');
    expect(stored.blob.type).toBe('image/jpeg');
    expect(await stored.blob.text()).toBe('real browser blob bytes');

    db.close();
  });

  test('upgrades a v7 database to v8, folding photoId/referencePhoto into photos[] on real IndexedDB', async () => {
    const name = `browser-contract-upgrade-v8-${Math.random()}`;
    const v7 = await openDB(name, 7, {
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

    const db = await openDatabase(name);

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
});
