import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from '../storage/db.js';
import { putSession } from '../storage/sessionStore.js';
import { putObservation } from '../storage/observationStore.js';
import { putPhoto } from '../storage/photoStore.js';
import { createSession } from '../domain/session.js';
import { createObservation } from '../domain/observation.js';
import { sessionToFeatureCollection } from '../domain/geojson.js';
import { canonicalStringify } from '../domain/canonical-json.js';
import { buildSessionExport } from './buildSessionExport.js';

function makeSession(overrides = {}) {
  return createSession({
    id: 'sess-1',
    name: 'Ashton Keynes',
    startedAt: '2026-08-06T09:00:00.000Z',
    ...overrides,
  });
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

describe('buildSessionExport', () => {
  test('throws when the session does not exist', async () => {
    const db = await openDatabase('export-no-session');
    await expect(
      buildSessionExport(db, { sessionId: 'nope', appVersion: '0.1.0' }),
    ).rejects.toThrow(/no session/i);
  });

  test('derives the filename from the slugified session name and its start date', async () => {
    const db = await openDatabase('export-filename');
    await putSession(db, makeSession({ name: 'Ashton Keynes: North Field!' }));

    const { filename } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    expect(filename).toBe('ashton-keynes-north-field-2026-08-06.zip');
  });

  test('produces a session.geojson entry matching the canonical GeoJSON output', async () => {
    const db = await openDatabase('export-geojson-content');
    const session = makeSession();
    await putSession(db, session);
    const obs = makeObservation();
    await putObservation(db, obs);

    const { entries } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    const geojsonEntry = entries.find((e) => e.name === 'session.geojson');
    const expected = canonicalStringify(
      sessionToFeatureCollection(session, [obs], { appVersion: '0.1.0' }),
    );
    expect(geojsonEntry.input).toBe(expected);
  });

  test('a session with no observations still produces a valid empty-features geojson entry', async () => {
    const db = await openDatabase('export-empty-session');
    await putSession(db, makeSession());

    const { entries } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('session.geojson');
    expect(JSON.parse(entries[0].input).features).toEqual([]);
  });

  test('includes a photos/<id>.jpg entry with the real Blob for observations with a photo', async () => {
    const db = await openDatabase('export-with-photo');
    await putSession(db, makeSession());
    await putObservation(db, makeObservation({ photoId: 'obs-1' }));
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });
    await putPhoto(db, { id: 'obs-1', blob, contentType: 'image/jpeg' });

    const { entries } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    const photoEntry = entries.find((e) => e.name === 'photos/obs-1.jpg');
    expect(photoEntry).toBeDefined();
    expect(await photoEntry.input.text()).toBe('fake jpeg bytes');
  });

  test('omits a photo entry for observations with no photo', async () => {
    const db = await openDatabase('export-no-photo');
    await putSession(db, makeSession());
    await putObservation(db, makeObservation({ photoId: null }));

    const { entries } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    expect(entries.filter((e) => e.name.startsWith('photos/'))).toEqual([]);
  });

  test('skips an observation whose referenced photo record is missing, rather than failing the export', async () => {
    const db = await openDatabase('export-orphan-photo-ref');
    await putSession(db, makeSession());
    await putObservation(db, makeObservation({ photoId: 'obs-1' })); // no matching putPhoto call

    const { entries } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    expect(entries.filter((e) => e.name.startsWith('photos/'))).toEqual([]);
  });
});
