import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
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
});
