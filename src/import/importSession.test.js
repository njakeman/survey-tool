import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from '../storage/db.js';
import { createCaptureService } from '../app/captureService.js';
import { buildSessionExport } from '../export/buildSessionExport.js';
import { listSessions } from '../storage/sessionStore.js';
import { listObservationsForSession } from '../storage/observationStore.js';
import { getPhoto } from '../storage/photoStore.js';
import { getAudio } from '../storage/audioStore.js';
import { parseSessionExport } from './parseSessionExport.js';
import { writeImportedSession, importSessionExport } from './importSession.js';

// The decisive test for the whole feature: a session exported by the app's
// own export pipeline, fed back through parse + import, lands as the same
// records — same observations field for field — under freshly minted ids.

const encoder = new TextEncoder();
const FIXED_NOW = '2026-08-06T10:00:00.000Z';

function fakeIdGenerator(prefix) {
  let counter = 0;
  return () => `${prefix}-${counter++}`;
}

// buildSessionExport emits client-zip entry shapes ({ name, input:
// string|Blob }); the reader side works in { name, data: Uint8Array }. This
// is the translation zipping+unzipping would perform, minus the bytes the
// browser tier already proves round-trip exactly.
async function toReaderEntries(entries) {
  return Promise.all(
    entries.map(async ({ name, input }) => ({
      name,
      data:
        typeof input === 'string'
          ? encoder.encode(input)
          : new Uint8Array(await input.arrayBuffer()),
    })),
  );
}

async function seedSession(dbName, { withPhoto = true, endSession = true } = {}) {
  const db = await openDatabase(dbName);
  const service = createCaptureService({
    db,
    newId: fakeIdGenerator('orig'),
    nowIso: () => FIXED_NOW,
  });
  await service.startSession('Hedgerow survey');
  await service.saveObservation({
    reading: { lat: 51.5, lon: -0.14, accuracyM: 8.2, fixAt: '2026-08-06T09:59:20.000Z' },
    heading: { headingDeg: 271.5, headingAccuracyDeg: 15 },
    note: 'gate post',
    photo: withPhoto
      ? { blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }) }
      : null,
  });
  await service.saveObservation({
    reading: { lat: 51.6, lon: -0.15, accuracyM: 4.1, fixAt: '2026-08-06T10:10:00.000Z' },
    heading: null,
    note: 'stile',
    photo: null,
    audio: { blob: new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/webm;codecs=opus' }) },
    pickedPoint: { lat: 51.61, lon: -0.16, accuracyM: 12 },
  });
  if (endSession) await service.endSession();
  return db;
}

describe('export → import round trip', () => {
  test('reimports the same observations, field for field, under fresh ids', async () => {
    const sourceDb = await seedSession('roundtrip-source');
    const [sourceSession] = await listSessions(sourceDb);
    const sourceObs = await listObservationsForSession(sourceDb, sourceSession.id);

    const { entries } = await buildSessionExport(sourceDb, {
      sessionId: sourceSession.id,
      appVersion: '0.9.0',
    });
    const parsed = parseSessionExport(await toReaderEntries(entries));

    const targetDb = await openDatabase('roundtrip-target');
    const summary = await writeImportedSession(targetDb, parsed, {
      newId: fakeIdGenerator('copy'),
    });

    expect(summary).toMatchObject({
      name: 'Hedgerow survey',
      observationCount: 2,
      photoCount: 1,
      audioCount: 1,
    });

    const [imported] = await listSessions(targetDb);
    expect(imported.name).toBe('Hedgerow survey');
    expect(imported.startedAt).toBe(sourceSession.startedAt);
    expect(imported.endedAt).toBe(sourceSession.endedAt);
    expect(imported.status).toBe('closed');
    expect(imported.id).not.toBe(sourceSession.id); // a copy, never the same record

    const importedObs = await listObservationsForSession(targetDb, imported.id);
    expect(importedObs).toHaveLength(2);
    const strip = (obs) => {
      const fields = { ...obs, hasPhoto: Boolean(obs.photoId), hasAudio: Boolean(obs.audioId) };
      delete fields.id;
      delete fields.sessionId;
      delete fields.photoId;
      delete fields.audioId;
      return fields;
    };
    // geojson.js sorts by recordedAt then id; both were saved at FIXED_NOW,
    // so compare as sets of field-values rather than by order.
    const sourceStripped = sourceObs.map(strip);
    for (const obs of importedObs.map(strip)) {
      expect(sourceStripped).toContainEqual(obs);
    }

    // The photo bytes travelled, stored under the new observation's id.
    const withPhoto = importedObs.find((obs) => obs.photoId);
    expect(withPhoto.photoId).toBe(withPhoto.id);
    const photo = await getPhoto(targetDb, withPhoto.photoId);
    expect([...new Uint8Array(await photo.blob.arrayBuffer())]).toEqual([1, 2, 3, 4]);

    // The voice note travelled too — bytes and contentType, under the new
    // observation's id, its zip filename extension derived from the type.
    const withAudio = importedObs.find((obs) => obs.audioId);
    expect(withAudio.audioId).toBe(withAudio.id);
    const audio = await getAudio(targetDb, withAudio.audioId);
    expect(audio.contentType).toBe('audio/webm');
    expect([...new Uint8Array(await audio.blob.arrayBuffer())]).toEqual([9, 8, 7]);

    // The picked point survived as a picked point.
    const picked = importedObs.find((obs) => obs.positionSource === 'map');
    expect(picked.lat).toBe(51.61);
    expect(picked.gpsAccuracyM).toBe(12);
    expect(picked.altitudeM).toBe(null);
  });

  test('a session exported mid-session arrives closed — a copy, not a continuation', async () => {
    const sourceDb = await seedSession('roundtrip-open', { endSession: false });
    const [sourceSession] = await listSessions(sourceDb);
    const { entries } = await buildSessionExport(sourceDb, {
      sessionId: sourceSession.id,
      appVersion: '0.9.0',
    });

    const parsed = parseSessionExport(await toReaderEntries(entries));
    const targetDb = await openDatabase('roundtrip-open-target');
    const { sessionId } = await writeImportedSession(targetDb, parsed, {
      newId: fakeIdGenerator('copy'),
    });

    const [imported] = await listSessions(targetDb);
    expect(imported.id).toBe(sessionId);
    expect(imported.status).toBe('closed');
    expect(imported.endedAt).toBe(FIXED_NOW); // the latest recordedAt
    expect(imported.lastExportedAt).toBe(null); // this device never exported it
  });

  test('importing the same zip twice yields two independent copies', async () => {
    const sourceDb = await seedSession('roundtrip-twice');
    const [sourceSession] = await listSessions(sourceDb);
    const { entries } = await buildSessionExport(sourceDb, {
      sessionId: sourceSession.id,
      appVersion: '0.9.0',
    });
    const readerEntries = await toReaderEntries(entries);

    const targetDb = await openDatabase('roundtrip-twice-target');
    await writeImportedSession(targetDb, parseSessionExport(readerEntries), {
      newId: fakeIdGenerator('first'),
    });
    await writeImportedSession(targetDb, parseSessionExport(readerEntries), {
      newId: fakeIdGenerator('second'),
    });

    const sessions = await listSessions(targetDb);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).not.toBe(sessions[1].id);
  });
});

describe('parseSessionExport rejections and tolerance', () => {
  const entry = (name, text) => ({ name, data: encoder.encode(text) });

  test('names the missing session.geojson', () => {
    expect(() => parseSessionExport([entry('readme.txt', 'hi')])).toThrow(/no session\.geojson/);
  });

  test('names invalid JSON and non-FeatureCollections', () => {
    expect(() => parseSessionExport([entry('session.geojson', '{oops')])).toThrow(/not valid JSON/);
    expect(() => parseSessionExport([entry('session.geojson', '{"type":"Feature"}')])).toThrow(
      /not a GeoJSON FeatureCollection/,
    );
  });

  test('names the feature that fails validation', () => {
    const bad = JSON.stringify({
      type: 'FeatureCollection',
      survey_session: { id: 's', name: 'S', started_at: FIXED_NOW, ended_at: null },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {
            obs_id: 'o1',
            recorded_at: FIXED_NOW,
            fix_at: FIXED_NOW,
            lat: 512,
            lon: 0,
            gps_accuracy_m: 5,
          },
        },
      ],
    });

    expect(() => parseSessionExport([entry('session.geojson', bad)])).toThrow(
      /feature 1: .*lat 512/,
    );
  });

  test('nulls a photo claim the zip cannot back with bytes', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      survey_session: { id: 's', name: 'S', started_at: FIXED_NOW, ended_at: FIXED_NOW },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.14, 51.5] },
          properties: {
            obs_id: 'o1',
            recorded_at: FIXED_NOW,
            fix_at: FIXED_NOW,
            lat: 51.5,
            lon: -0.14,
            gps_accuracy_m: 5,
            photo: 'o1.jpg',
          },
        },
      ],
    });

    const parsed = parseSessionExport([entry('session.geojson', text)]);

    expect(parsed.observations[0].photoId).toBe(null);
    expect(parsed.photos).toHaveLength(0);
  });

  test('reconstructs the session from features when survey_session is absent (older zips)', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.14, 51.5] },
          properties: {
            obs_id: 'o1',
            recorded_at: '2026-08-06T10:00:00.000Z',
            fix_at: '2026-08-06T09:59:00.000Z',
            lat: 51.5,
            lon: -0.14,
            gps_accuracy_m: 5,
            session_name: 'Old export',
          },
        },
      ],
    });

    const parsed = parseSessionExport([entry('session.geojson', text)]);

    expect(parsed.session).toEqual({
      name: 'Old export',
      startedAt: '2026-08-06T09:59:00.000Z',
      endedAt: '2026-08-06T10:00:00.000Z',
    });
  });
});

describe('importSessionExport (the whole flow, from bytes)', () => {
  test('accepts a bare .geojson file — no photos, same session', async () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      survey_session: { id: 's', name: 'Bare geojson', started_at: FIXED_NOW, ended_at: FIXED_NOW },
      features: [],
    });
    const db = await openDatabase('import-bare-geojson');

    const summary = await importSessionExport(
      db,
      { buffer: encoder.encode(text).buffer, filename: 'session.geojson' },
      { newId: fakeIdGenerator('bare') },
    );

    expect(summary).toMatchObject({ name: 'Bare geojson', observationCount: 0, photoCount: 0 });
  });

  test('carries the filename into the failure message', async () => {
    const db = await openDatabase('import-bad-file');

    await expect(
      importSessionExport(
        db,
        { buffer: encoder.encode('not json at all').buffer, filename: 'holiday-photos.zip' },
        { newId: fakeIdGenerator('bad') },
      ),
    ).rejects.toThrow(/holiday-photos\.zip/);
  });
});

describe('traced observations through the round trip', () => {
  const TRACE_GEOMETRY = {
    type: 'LineString',
    coordinates: [
      [-0.14, 51.5],
      [-0.1405, 51.5005],
      [-0.141, 51.501],
    ],
  };

  test('a traced path survives export, parse and import intact', async () => {
    const db = await openDatabase('roundtrip-trace-source');
    const service = createCaptureService({
      db,
      newId: fakeIdGenerator('orig'),
      nowIso: () => FIXED_NOW,
    });
    await service.startSession('Hedgerow survey');
    const draft = await service.startTraceDraft({ mode: 'path' });
    await service.saveObservation({
      reading: null,
      heading: null,
      note: 'north hedgerow',
      trace: {
        draftId: draft.id,
        geometry: TRACE_GEOMETRY,
        representative: { lat: 51.5005, lon: -0.1405 },
        gpsAccuracyM: 11,
        fixAt: '2026-08-06T09:40:00.000Z',
      },
    });

    const [sourceSession] = await listSessions(db);
    const { entries } = await buildSessionExport(db, {
      sessionId: sourceSession.id,
      appVersion: '0.9.0',
    });
    const parsed = parseSessionExport(await toReaderEntries(entries));

    const targetDb = await openDatabase('roundtrip-trace-target');
    await writeImportedSession(targetDb, parsed, { newId: fakeIdGenerator('copy') });
    const [imported] = await listSessions(targetDb);
    const [obs] = await listObservationsForSession(targetDb, imported.id);

    expect(obs.positionSource).toBe('trace');
    expect(obs.geometry).toEqual(TRACE_GEOMETRY);
    expect(obs.lat).toBe(51.5005);
    expect(obs.gpsAccuracyM).toBe(11);
    expect(obs.fixAt).toBe('2026-08-06T09:40:00.000Z');
    expect(obs.note).toBe('north hedgerow');
  });

  test('a foreign LineString without lat/lon properties stands at its midpoint as a trace', () => {
    const encoderEntry = (name, text) => ({ name, data: encoder.encode(text) });
    const text = JSON.stringify({
      type: 'FeatureCollection',
      survey_session: { id: 's', name: 'S', started_at: FIXED_NOW, ended_at: null },
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [0, 2],
            ],
          },
          properties: {
            obs_id: 'o1',
            recorded_at: FIXED_NOW,
            fix_at: FIXED_NOW,
            gps_accuracy_m: 5,
          },
        },
      ],
    });

    const parsed = parseSessionExport([encoderEntry('session.geojson', text)]);

    expect(parsed.observations[0].positionSource).toBe('trace');
    expect(parsed.observations[0].lat).toBeCloseTo(1, 5);
    expect(parsed.observations[0].geometry.type).toBe('LineString');
  });

  test('a foreign Polygon without lat/lon properties stands at its centroid', () => {
    const encoderEntry = (name, text) => ({ name, data: encoder.encode(text) });
    const ring = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ];
    const text = JSON.stringify({
      type: 'FeatureCollection',
      survey_session: { id: 's', name: 'S', started_at: FIXED_NOW, ended_at: null },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: {
            obs_id: 'o1',
            recorded_at: FIXED_NOW,
            fix_at: FIXED_NOW,
            gps_accuracy_m: 5,
          },
        },
      ],
    });

    const parsed = parseSessionExport([encoderEntry('session.geojson', text)]);

    expect(parsed.observations[0].positionSource).toBe('trace');
    expect(parsed.observations[0].lat).toBeCloseTo(1, 5);
    expect(parsed.observations[0].lon).toBeCloseTo(1, 5);
  });

  test('names the feature whose trace geometry fails validation', () => {
    const encoderEntry = (name, text) => ({ name, data: encoder.encode(text) });
    const text = JSON.stringify({
      type: 'FeatureCollection',
      survey_session: { id: 's', name: 'S', started_at: FIXED_NOW, ended_at: null },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[0, 0]] },
          properties: {
            obs_id: 'o1',
            recorded_at: FIXED_NOW,
            fix_at: FIXED_NOW,
            lat: 0,
            lon: 0,
            gps_accuracy_m: 5,
            position_source: 'trace',
          },
        },
      ],
    });

    expect(() => parseSessionExport([encoderEntry('session.geojson', text)])).toThrow(
      /feature 1: .*two positions/i,
    );
  });
});
