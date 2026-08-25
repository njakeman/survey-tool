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
import { putReference, putStationState } from '../storage/revisitStore.js';
import { buildZip } from '../import/fixtures/buildZip.js';

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
    await putObservation(db, makeObservation());

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

  test('refuses a session with no observations — a metadata-only zip is nothing to share', async () => {
    // The stamp such an export would earn (lastExportCount: 0) also made the
    // badge arithmetic read the session as fully Exported, purge included.
    // Import stays permissive: pre-fix zero-feature files must still load.
    const db = await openDatabase('export-empty-session');
    await putSession(db, makeSession());

    await expect(
      buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' }),
    ).rejects.toThrow(/nothing to export/i);
  });

  test('includes a photos/<id>.jpg entry with the real Blob for observations with a photo', async () => {
    const db = await openDatabase('export-with-photo');
    await putSession(db, makeSession());
    await putObservation(db, makeObservation({ photos: [{ id: 'obs-1' }] }));
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
    await putObservation(db, makeObservation({ photos: [] }));

    const { entries } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    expect(entries.filter((e) => e.name.startsWith('photos/'))).toEqual([]);
  });

  test('skips an observation whose referenced photo record is missing, rather than failing the export', async () => {
    const db = await openDatabase('export-orphan-photo-ref');
    await putSession(db, makeSession());
    await putObservation(db, makeObservation({ photos: [{ id: 'obs-1' }] })); // no matching putPhoto call

    const { entries } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    expect(entries.filter((e) => e.name.startsWith('photos/'))).toEqual([]);
    // The GeoJSON must not claim a photo the zip doesn't contain — a dangling
    // photos/obs-1.jpg reference reads as a broken link in QGIS/downstream.
    const geojson = JSON.parse(entries.find((e) => e.name === 'session.geojson').input);
    expect(geojson.features[0].properties.photo).toBeNull();
    expect(geojson.features[0].properties.photos).toEqual([]);
  });

  test('keeps the geojson photo reference when the photo record is present', async () => {
    const db = await openDatabase('export-photo-ref-present');
    await putSession(db, makeSession());
    await putObservation(db, makeObservation({ photos: [{ id: 'obs-1' }] }));
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });
    await putPhoto(db, { id: 'obs-1', blob, contentType: 'image/jpeg' });

    const { entries } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    const geojson = JSON.parse(entries.find((e) => e.name === 'session.geojson').input);
    expect(geojson.features[0].properties.photo).toBe('obs-1.jpg');
  });

  test('zips every photo an observation holds and drops only the unbacked entries', async () => {
    const db = await openDatabase('export-multi-photo');
    await putSession(db, makeSession());
    await putObservation(
      db,
      makeObservation({ photos: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] }),
    ); // p2 has no matching putPhoto call — an orphan record
    const blob1 = new Blob(['bytes p1'], { type: 'image/jpeg' });
    const blob3 = new Blob(['bytes p3'], { type: 'image/jpeg' });
    await putPhoto(db, { id: 'p1', blob: blob1, contentType: 'image/jpeg' });
    await putPhoto(db, { id: 'p3', blob: blob3, contentType: 'image/jpeg' });

    const { entries } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    const names = entries.map((e) => e.name);
    expect(names).toContain('photos/p1.jpg');
    expect(names).toContain('photos/p3.jpg');
    expect(names).not.toContain('photos/p2.jpg');

    const geojson = JSON.parse(entries.find((e) => e.name === 'session.geojson').input);
    expect(geojson.features[0].properties.photos.map((p) => p.photo)).toEqual([
      'p1.jpg',
      'p3.jpg',
    ]);
    expect(geojson.features[0].properties.photo).toBe('p1.jpg');
  });
});

describe('revisit exports', () => {
  const referenceGeojson = JSON.stringify({
    type: 'FeatureCollection',
    survey_session: {
      id: 'ref-sess-1',
      name: 'Long Barrow south',
      started_at: '2025-04-12T09:00:00.000Z',
      ended_at: null,
    },
    features: ['ref-1', 'ref-2', 'ref-3'].map((id, index) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-0.14, 51.5 + index / 1000] },
      properties: {
        obs_id: id,
        recorded_at: '2025-04-12T10:00:00.000Z',
        fix_at: '2025-04-12T10:00:00.000Z',
        lat: 51.5 + index / 1000,
        lon: -0.14,
        gps_accuracy_m: 5,
        note: `Station ${id}.`,
        photo: null,
      },
    })),
  });
  const reference = {
    filename: 'long-barrow-2025-04-12.zip',
    hash: 'a'.repeat(64),
    sessionId: 'ref-sess-1',
    sessionName: 'Long Barrow south',
    startedAt: '2025-04-12T09:00:00.000Z',
    stationCount: 3,
    photoCount: 0,
  };

  async function seedRevisit(dbName, { withReferenceBytes = true } = {}) {
    const db = await openDatabase(dbName);
    await putSession(db, makeSession({ name: '2026-08-21', sessionType: 'revisit', reference }));
    if (withReferenceBytes) {
      await putReference(db, {
        sessionId: 'sess-1',
        arrayBuffer: buildZip([{ name: 'session.geojson', data: referenceGeojson }]),
        filename: reference.filename,
        hash: reference.hash,
      });
    }
    await putObservation(db, makeObservation({ referenceObservationId: 'ref-2' }));
    await putStationState(db, {
      sessionId: 'sess-1',
      refObsId: 'ref-3',
      state: 'noAccess',
      reason: 'field flooded',
      updatedAt: '2026-08-21T10:00:00.000Z',
    });
    return db;
  }

  test('a revisit export carries survey_revisit with every station and its state', async () => {
    const db = await seedRevisit('export-revisit-full');

    const { entries } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    const geojson = JSON.parse(entries.find((e) => e.name === 'session.geojson').input);
    expect(geojson.survey_revisit).toEqual({
      reference_file: 'long-barrow-2025-04-12.zip',
      reference_hash: 'a'.repeat(64),
      reference_session_id: 'ref-sess-1',
      reference_session_name: 'Long Barrow south',
      reference_started_at: '2025-04-12T09:00:00.000Z',
      stations: [
        { ref_obs_id: 'ref-1', state: 'not_visited', reason: null },
        { ref_obs_id: 'ref-2', state: 'done', reason: null },
        { ref_obs_id: 'ref-3', state: 'no_access', reason: 'field flooded' },
      ],
    });
    expect(geojson.features[0].properties.ref_obs_id).toBe('ref-2');
  });

  test('with the reference bytes gone, the export still builds with the states it can know', async () => {
    // Eviction can take the buffer; the export must not fail over it, and
    // the stations it can no longer enumerate are honestly absent rather
    // than guessed at.
    const db = await seedRevisit('export-revisit-evicted', { withReferenceBytes: false });

    const { entries } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    const geojson = JSON.parse(entries.find((e) => e.name === 'session.geojson').input);
    expect(geojson.survey_revisit.reference_file).toBe('long-barrow-2025-04-12.zip');
    expect(geojson.survey_revisit.stations).toEqual([
      { ref_obs_id: 'ref-2', state: 'done', reason: null },
      { ref_obs_id: 'ref-3', state: 'no_access', reason: 'field flooded' },
    ]);
  });

  test('an ordinary session export has no survey_revisit member', async () => {
    const db = await openDatabase('export-revisit-none');
    await putSession(db, makeSession());
    await putObservation(db, makeObservation());

    const { entries } = await buildSessionExport(db, { sessionId: 'sess-1', appVersion: '0.1.0' });

    const geojson = JSON.parse(entries.find((e) => e.name === 'session.geojson').input);
    expect('survey_revisit' in geojson).toBe(false);
  });
});
