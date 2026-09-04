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
    // Through the real save path, so the fixture's photos[] is the one the
    // app itself would write — ids minted per photo and all.
    photos: withPhoto
      ? [{ blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }) }]
      : [],
  });
  await service.saveObservation({
    reading: { lat: 51.6, lon: -0.15, accuracyM: 4.1, fixAt: '2026-08-06T10:10:00.000Z' },
    heading: null,
    note: 'stile',
    audio: {
      blob: new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/webm;codecs=opus' }),
      // Round-trips as audio_duration_ms, so the copy's voice chip can still
      // read 0:12 without loading the blob.
      durationMs: 12_400,
    },
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
      const fields = {
        ...obs,
        hasPhoto: obs.photos.length > 0,
        hasAudio: Boolean(obs.audioId),
      };
      delete fields.id;
      delete fields.sessionId;
      // Photo ids are freshly minted per photo on import — compared by
      // content, not by id, below.
      delete fields.photos;
      delete fields.audioId;
      return fields;
    };
    // geojson.js sorts by recordedAt then id; both were saved at FIXED_NOW,
    // so compare as sets of field-values rather than by order.
    const sourceStripped = sourceObs.map(strip);
    for (const obs of importedObs.map(strip)) {
      expect(sourceStripped).toContainEqual(obs);
    }

    // The photo bytes travelled, stored under a freshly minted photo id —
    // never the observation's own id, since one observation can hold many.
    const withPhoto = importedObs.find((obs) => obs.photos.length > 0);
    expect(withPhoto.photos).toHaveLength(1);
    expect(withPhoto.photos[0].id).not.toBe(withPhoto.id);
    expect(sourceObs.flatMap((obs) => obs.photos.map((entry) => entry.id))).not.toContain(
      withPhoto.photos[0].id,
    );
    const photo = await getPhoto(targetDb, withPhoto.photos[0].id);
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

  test('mints a fresh id per photo and keeps order and pairing', async () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      survey_session: { id: 's', name: 'Two photos', started_at: FIXED_NOW, ended_at: FIXED_NOW },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.14, 51.5] },
          properties: {
            obs_id: 'obs-1',
            recorded_at: FIXED_NOW,
            fix_at: FIXED_NOW,
            lat: 51.5,
            lon: -0.14,
            gps_accuracy_m: 5,
            photo: 'p1.jpg',
            photos: [
              { photo: 'p1.jpg', ref_photo: 'r.jpg' },
              { photo: 'p2.jpg', ref_photo: null },
            ],
            ref_obs_id: 'ref-1',
          },
        },
      ],
    });
    const parsed = parseSessionExport([
      { name: 'session.geojson', data: encoder.encode(text) },
      { name: 'photos/p1.jpg', data: new Uint8Array([1]) },
      { name: 'photos/p2.jpg', data: new Uint8Array([2]) },
    ]);

    const targetDb = await openDatabase('mint-per-photo');
    const { photoCount } = await writeImportedSession(targetDb, parsed, {
      newId: fakeIdGenerator('mint'),
    });

    const [session] = await listSessions(targetDb);
    const [obs] = await listObservationsForSession(targetDb, session.id);

    expect(photoCount).toBe(2);
    expect(obs.photos).toHaveLength(2);
    // Fresh ids, never the source zip's filenames and never each other.
    expect(obs.photos.map((p) => p.id)).not.toContain('p1');
    expect(obs.photos.map((p) => p.id)).not.toContain('p2');
    expect(obs.photos[0].id).not.toBe(obs.photos[1].id);
    // Never the observation's own id either — one observation, many photos.
    expect(obs.photos[0].id).not.toBe(obs.id);
    expect(obs.photos[1].id).not.toBe(obs.id);
    // Order and per-photo pairing survive the remint.
    expect(obs.photos[0].referencePhoto).toBe('r.jpg');
    expect(obs.photos[1].referencePhoto).toBeNull();

    const [firstPhoto, secondPhoto] = await Promise.all([
      getPhoto(targetDb, obs.photos[0].id),
      getPhoto(targetDb, obs.photos[1].id),
    ]);
    expect([...new Uint8Array(await firstPhoto.blob.arrayBuffer())]).toEqual([1]);
    expect([...new Uint8Array(await secondPhoto.blob.arrayBuffer())]).toEqual([2]);
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

  test('drops (does not null) a photo claim the zip cannot back with bytes', () => {
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

    expect(parsed.observations[0].photos).toEqual([]);
    expect(parsed.photos).toHaveLength(0);
  });

  test('an export from before audio_duration_ms existed still imports, duration null', () => {
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
          },
        },
      ],
    });

    const parsed = parseSessionExport([entry('session.geojson', text)]);

    expect(parsed.observations[0].audioDurationMs).toBeNull();
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

  test('inferred-segment flags survive the round trip — they are not derivable from geometry', async () => {
    const db = await openDatabase('roundtrip-gaps-source');
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
      note: 'interrupted walk',
      trace: {
        draftId: draft.id,
        geometry: TRACE_GEOMETRY,
        representative: { lat: 51.5005, lon: -0.1405 },
        gpsAccuracyM: 11,
        fixAt: '2026-08-06T09:40:00.000Z',
        gaps: [2],
      },
    });

    const [sourceSession] = await listSessions(db);
    const { entries } = await buildSessionExport(db, {
      sessionId: sourceSession.id,
      appVersion: '0.9.0',
    });
    const parsed = parseSessionExport(await toReaderEntries(entries));

    const targetDb = await openDatabase('roundtrip-gaps-target');
    await writeImportedSession(targetDb, parsed, { newId: fakeIdGenerator('copy') });
    const [imported] = await listSessions(targetDb);
    const [obs] = await listObservationsForSession(targetDb, imported.id);

    expect(obs.traceGaps).toEqual([2]);
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

  test('ref_obs_id and ref_photo parse back onto the observation — the pairing key never drops', () => {
    const encoderEntry = (name, text) => ({ name, data: encoder.encode(text) });
    const text = JSON.stringify({
      type: 'FeatureCollection',
      survey_session: { id: 's', name: 'S', started_at: FIXED_NOW, ended_at: null },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.14, 51.5] },
          properties: {
            obs_id: 'obs-1',
            recorded_at: FIXED_NOW,
            fix_at: FIXED_NOW,
            lat: 51.5,
            lon: -0.14,
            gps_accuracy_m: 5,
            photo: 'obs-1.jpg',
            ref_obs_id: 'ref-4',
            ref_photo: 'ref-4.jpg',
          },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.15, 51.6] },
          properties: {
            // A pre-revisit export: no ref_* keys at all → null, not undefined.
            obs_id: 'obs-2',
            recorded_at: FIXED_NOW,
            fix_at: FIXED_NOW,
            lat: 51.6,
            lon: -0.15,
            gps_accuracy_m: 5,
          },
        },
      ],
    });

    const parsed = parseSessionExport([
      encoderEntry('session.geojson', text),
      { name: 'photos/obs-1.jpg', data: new Uint8Array([1, 2, 3]) },
    ]);

    expect(parsed.observations[0].referenceObservationId).toBe('ref-4');
    expect(parsed.observations[0].photos).toEqual([
      {
        id: 'obs-1',
        referencePhoto: 'ref-4.jpg',
        focalLength35mm: null,
        focalLengthMm: null,
        lensModel: null,
      },
    ]);
    expect(parsed.observations[1].referenceObservationId).toBeNull();
    expect(parsed.observations[1].photos).toEqual([]);
  });

  test('a revisit export imports as a plain closed survey copy, pairing keys intact', async () => {
    // The copy has no reference zip on this device, so it arrives as an
    // ordinary survey — but its observations keep saying which stations they
    // revisited: self-describing, not self-contained. The survey_revisit
    // member is provenance for consumers, deliberately not re-imported.
    const encoderEntry = (name, text) => ({ name, data: encoder.encode(text) });
    const text = JSON.stringify({
      type: 'FeatureCollection',
      survey_session: { id: 's', name: 'Revisit copy', started_at: FIXED_NOW, ended_at: null },
      survey_revisit: {
        reference_file: 'ref.zip',
        reference_hash: 'a'.repeat(64),
        reference_session_id: 'ref-sess-1',
        reference_session_name: 'Long Barrow south',
        reference_started_at: '2025-04-12T09:00:00.000Z',
        stations: [{ ref_obs_id: 'ref-4', state: 'done', reason: null }],
      },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.14, 51.5] },
          properties: {
            obs_id: 'obs-1',
            recorded_at: FIXED_NOW,
            fix_at: FIXED_NOW,
            lat: 51.5,
            lon: -0.14,
            gps_accuracy_m: 5,
            photo: 'obs-1.jpg',
            ref_obs_id: 'ref-4',
            ref_photo: 'ref-4.jpg',
          },
        },
      ],
    });

    const parsed = parseSessionExport([
      encoderEntry('session.geojson', text),
      { name: 'photos/obs-1.jpg', data: new Uint8Array([1, 2, 3]) },
    ]);
    const db = await openDatabase('import-revisit-copy');
    await writeImportedSession(db, parsed, { newId: fakeIdGenerator('copy') });

    const [imported] = await listSessions(db);
    expect(imported.status).toBe('closed');
    expect(imported.sessionType ?? 'survey').toBe('survey');
    const observations = await listObservationsForSession(db, imported.id);
    expect(observations[0].referenceObservationId).toBe('ref-4');
    expect(observations[0].photos).toHaveLength(1);
    expect(observations[0].photos[0].referencePhoto).toBe('ref-4.jpg');
  });

  test('a bare ref_photo with no photo at all imports as photos: [], pairing key intact', async () => {
    // A revisited station photographed nothing new at: the pairing key
    // survives independently of any photo; the old ref_photo string has no
    // photo entry to attach to, so it's dropped rather than forced onto one.
    const encoderEntry = (name, text) => ({ name, data: encoder.encode(text) });
    const text = JSON.stringify({
      type: 'FeatureCollection',
      survey_session: { id: 's', name: 'S', started_at: FIXED_NOW, ended_at: FIXED_NOW },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.14, 51.5] },
          properties: {
            obs_id: 'obs-1',
            recorded_at: FIXED_NOW,
            fix_at: FIXED_NOW,
            lat: 51.5,
            lon: -0.14,
            gps_accuracy_m: 5,
            ref_obs_id: 'ref-1',
            ref_photo: 'old.jpg',
          },
        },
      ],
    });

    const parsed = parseSessionExport([encoderEntry('session.geojson', text)]);
    const db = await openDatabase('import-bare-ref-photo');
    const { photoCount } = await writeImportedSession(db, parsed, {
      newId: fakeIdGenerator('bare-ref'),
    });

    expect(photoCount).toBe(0);
    const [imported] = await listSessions(db);
    const [obs] = await listObservationsForSession(db, imported.id);
    expect(obs.photos).toEqual([]);
    expect(obs.referenceObservationId).toBe('ref-1');
  });
});

describe('two photos with per-photo pairing survive a full export → import → export', () => {
  test('the re-exported session.geojson matches the original, ids aside', async () => {
    // The byte-identical claim, end to end: canonical-json means identical
    // content produces identical bytes, so if order, per-photo pairing and
    // every property survive the copy, the second export's text differs from
    // the first only where import deliberately mints something new.
    const db = await openDatabase('roundtrip-two-photos-source');
    const service = createCaptureService({
      db,
      newId: fakeIdGenerator('orig'),
      nowIso: () => FIXED_NOW,
    });
    const source = await service.startSession('Long Barrow revisit', {
      reference: {
        filename: 'long-barrow-2025-04-12.zip',
        hash: 'a'.repeat(64),
        sessionId: 'ref-sess-1',
        sessionName: 'Long Barrow south',
        startedAt: '2025-04-12T09:00:00.000Z',
        stationCount: 1,
        photoCount: 1,
      },
      referenceBuffer: new Uint8Array([0x50, 0x4b, 3, 4]).buffer,
    });
    await service.saveObservation({
      reading: { lat: 51.5, lon: -0.14, accuracyM: 8.2, fixAt: '2026-08-06T09:59:20.000Z' },
      heading: null,
      note: 'stile, both faces',
      photos: [
        // The framed one answers a reference photo; the second is an extra
        // the surveyor took of the same station.
        {
          blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
          referencePhoto: 'ref-1.jpg',
        },
        { blob: new Blob([new Uint8Array([5, 6, 7, 8])], { type: 'image/jpeg' }) },
      ],
      station: { referenceObservationId: 'ref-1' },
    });
    await service.endSession();

    const firstExport = await buildSessionExport(db, {
      sessionId: source.id,
      appVersion: '0.9.0',
    });
    const parsed = parseSessionExport(await toReaderEntries(firstExport.entries));

    const targetDb = await openDatabase('roundtrip-two-photos-target');
    const { sessionId: copyId } = await writeImportedSession(targetDb, parsed, {
      newId: fakeIdGenerator('copy'),
    });

    // Both photos travelled, in capture order, each keeping its own pairing.
    const [copy] = await listObservationsForSession(targetDb, copyId);
    expect(copy.photos.map((entry) => entry.referencePhoto)).toEqual(['ref-1.jpg', null]);
    expect(copy.referenceObservationId).toBe('ref-1');
    expect([
      ...new Uint8Array(await (await getPhoto(targetDb, copy.photos[0].id)).blob.arrayBuffer()),
    ]).toEqual([1, 2, 3, 4]);
    expect([
      ...new Uint8Array(await (await getPhoto(targetDb, copy.photos[1].id)).blob.arrayBuffer()),
    ]).toEqual([5, 6, 7, 8]);
    expect(firstExport.entries.filter((entry) => entry.name.startsWith('photos/'))).toHaveLength(2);

    const secondExport = await buildSessionExport(targetDb, {
      sessionId: copyId,
      appVersion: '0.9.0',
    });
    const textOf = (result) =>
      result.entries.find((entry) => entry.name === 'session.geojson').input;

    // Everything import deliberately mints afresh, plus the two things a
    // copy is honest about not being: it carries the original's name and
    // times but its own identity, and a revisit's station list belongs to
    // the session that walked it — the copy is a plain closed survey.
    const normalise = (text, session) => {
      const collection = JSON.parse(text);
      delete collection.survey_revisit;
      collection.survey_session = { name: session.name, started_at: session.startedAt };
      collection.features.forEach((feature, index) => {
        feature.properties.obs_id = `obs-${index}`;
        feature.properties.photos = feature.properties.photos.map((entry, slot) => ({
          ...entry,
          photo: `photo-${index}-${slot}.jpg`,
        }));
        // The flat `photo`/`ref_photo` pair keeps naming the first photo, so
        // it carries a minted id too.
        if (feature.properties.photo) feature.properties.photo = `photo-${index}-0.jpg`;
      });
      return JSON.stringify(collection);
    };
    const [sourceSession] = (await listSessions(db)).filter((s) => s.id === source.id);
    const [copySession] = (await listSessions(targetDb)).filter((s) => s.id === copyId);

    expect(normalise(textOf(secondExport), copySession)).toBe(
      normalise(textOf(firstExport), sourceSession),
    );
    // The survey_revisit member is the source's alone — a copy of a revisit
    // is a plain closed survey, with the pairing intact.
    expect(JSON.parse(textOf(firstExport))).toHaveProperty('survey_revisit');
    expect(JSON.parse(textOf(secondExport))).not.toHaveProperty('survey_revisit');
  });
});
