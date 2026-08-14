import { describe, expect, test } from 'vitest';
import { sessionToFeatureCollection } from './geojson.js';
import { createSession } from './session.js';
import { createObservation } from './observation.js';

const session = createSession({
  id: 'sess-1',
  name: 'Ashton Keynes',
  startedAt: '2026-08-06T09:00:00.000Z',
});

describe('sessionToFeatureCollection', () => {
  test('produces a valid empty FeatureCollection for a session with no observations', () => {
    expect(sessionToFeatureCollection(session, [], { appVersion: '0.1.0' })).toEqual({
      type: 'FeatureCollection',
      survey_session: {
        id: 'sess-1',
        name: 'Ashton Keynes',
        started_at: '2026-08-06T09:00:00.000Z',
        ended_at: null,
      },
      features: [],
    });
  });

  test('carries the session itself as a foreign member, so an export can be imported', () => {
    // RFC 7946 §6.1 — foreign members are valid GeoJSON and GIS consumers
    // ignore them. Without this the file names the session on every feature
    // but never carries its id or times, and import could only approximate.
    const closed = { ...session, endedAt: '2026-08-06T17:30:00.000Z' };

    const fc = sessionToFeatureCollection(closed, [], { appVersion: '0.1.0' });

    expect(fc.survey_session).toEqual({
      id: 'sess-1',
      name: 'Ashton Keynes',
      started_at: '2026-08-06T09:00:00.000Z',
      ended_at: '2026-08-06T17:30:00.000Z',
    });
  });

  test('converts an observation into a Point feature with flat, simple-typed properties', () => {
    const obs = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T09:59:20.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8.2,
      headingDeg: 271.5,
      note: 'gate post',
      photoId: 'obs-1',
    });

    const fc = sessionToFeatureCollection(session, [obs], { appVersion: '0.1.0' });

    expect(fc.features).toEqual([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-0.14, 51.5] },
        properties: {
          obs_id: 'obs-1',
          recorded_at: '2026-08-06T10:00:00.000Z',
          fix_at: '2026-08-06T09:59:20.000Z',
          lat: 51.5,
          lon: -0.14,
          gps_accuracy_m: 8.2,
          altitude_m: null,
          altitude_accuracy_m: null,
          heading_deg: 271.5,
          heading_accuracy_deg: null,
          note: 'gate post',
          photo: 'obs-1.jpg',
          audio: null,
          audio_duration_ms: null,
          feature_layer: null,
          feature_id: null,
          feature_label: null,
          os_grid_ref: null,
          position_source: 'gps',
          trace_length_m: null,
          session_name: 'Ashton Keynes',
          app_version: '0.1.0',
        },
      },
    ]);
  });

  test('carries the voice note duration, and null for a legacy record without one', () => {
    // Emitted on every row (?? null, the feature-link precedent): a GIS
    // consumer's column set must not depend on which rows carry audio.
    const withDuration = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T09:59:20.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8.2,
      audioId: 'obs-1',
      audioDurationMs: 12_400,
    });
    const legacy = { ...withDuration, id: 'obs-2' };
    delete legacy.audioDurationMs;

    const fc = sessionToFeatureCollection(session, [withDuration, legacy], {
      appVersion: '0.1.0',
      audioFilename: (id) => `audio/${id}.webm`,
    });

    expect(fc.features[0].properties.audio_duration_ms).toBe(12_400);
    expect(fc.features[1].properties).toHaveProperty('audio_duration_ms', null);
  });

  test('carries the OS grid reference when one can be worked out', () => {
    const obs = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T09:59:20.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8.2,
    });
    const gridRef = (lat, lon) => `GRID ${lat},${lon}`;

    const { properties } = sessionToFeatureCollection(session, [obs], {
      appVersion: '0.1.0',
      gridRef,
    }).features[0];

    expect(properties.os_grid_ref).toBe('GRID 51.5,-0.14');
  });

  test('is null outside Great Britain rather than omitted', () => {
    // Same reasoning as the feature columns: a GIS consumer takes its schema
    // from the rows it sees, so the column has to exist even when the survey
    // wandered off the National Grid.
    const obs = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T09:59:20.000Z',
      lat: 48.8566,
      lon: 2.3522,
      gpsAccuracyM: 8.2,
    });

    const { properties } = sessionToFeatureCollection(session, [obs], {
      appVersion: '0.1.0',
      gridRef: () => null,
    }).features[0];

    expect(properties).toHaveProperty('os_grid_ref', null);
  });

  test('exports without a grid reference function at all', () => {
    // The grid is fetched at runtime and may not have arrived. An export must
    // never fail because of a derived convenience column.
    const obs = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T09:59:20.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8.2,
    });

    const { properties } = sessionToFeatureCollection(session, [obs], { appVersion: '0.1.0' })
      .features[0];

    expect(properties.os_grid_ref).toBeNull();
  });

  test('carries the source feature, so an export can be joined back to the dataset', () => {
    const obs = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T09:59:20.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8.2,
      featureLayerId: 'parcels',
      featureId: 'P-42',
      featureLabel: 'SU1408 3921',
    });

    const { properties } = sessionToFeatureCollection(session, [obs], { appVersion: '0.1.0' })
      .features[0];

    expect(properties.feature_layer).toBe('parcels');
    expect(properties.feature_id).toBe('P-42');
    expect(properties.feature_label).toBe('SU1408 3921');
  });

  test('emits the feature columns even when unlinked, so every row has the same shape', () => {
    // A GIS consumer reading a FeatureCollection takes its columns from the
    // features it sees. Omitting the keys on unlinked observations would make
    // the columns depend on which rows happened to be linked — worse than
    // three columns of null.
    const obs = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T09:59:20.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8.2,
    });

    const { properties } = sessionToFeatureCollection(session, [obs], { appVersion: '0.1.0' })
      .features[0];

    expect(properties).toHaveProperty('feature_layer', null);
    expect(properties).toHaveProperty('feature_id', null);
    expect(properties).toHaveProperty('feature_label', null);
  });

  test('an observation saved before feature layers existed exports the same shape', () => {
    // Records on real devices predate these three fields entirely. Reading
    // undefined off them must produce null, not a missing key — canonical
    // JSON drops undefined, so the row would silently lose its columns.
    const legacy = {
      id: 'obs-legacy',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T09:59:20.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8.2,
      altitudeM: null,
      altitudeAccuracyM: null,
      headingDeg: null,
      headingAccuracyDeg: null,
      note: '',
      photoId: null,
    };

    const { properties } = sessionToFeatureCollection(session, [legacy], { appVersion: '0.1.0' })
      .features[0];

    expect(properties.feature_layer).toBeNull();
    expect(properties.feature_id).toBeNull();
    expect(properties.feature_label).toBeNull();
    // Every observation that predates the field really was a GPS fix, so
    // 'gps' is the honest value rather than a guess.
    expect(properties.position_source).toBe('gps');
  });

  test('says when a position was placed on the map rather than measured', () => {
    const picked = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T09:59:20.000Z',
      lat: 51.5,
      lon: -0.14,
      // The map precision at the zoom it was picked at, not a fix accuracy.
      gpsAccuracyM: 12,
      positionSource: 'map',
    });

    const { properties } = sessionToFeatureCollection(session, [picked], { appVersion: '0.1.0' })
      .features[0];

    expect(properties.position_source).toBe('map');
    expect(properties.gps_accuracy_m).toBe(12);
  });

  test('carries fix_at separately from recorded_at when the surveyor saved later than the fix', () => {
    const obs = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:40.000Z',
      fixAt: '2026-08-06T10:00:00.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8.2,
    });
    const fc = sessionToFeatureCollection(session, [obs], { appVersion: '0.1.0' });
    expect(fc.features[0].properties.fix_at).toBe('2026-08-06T10:00:00.000Z');
    expect(fc.features[0].properties.recorded_at).toBe('2026-08-06T10:00:40.000Z');
  });

  test('sets photo to null when the observation has no photo', () => {
    const obs = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T10:00:00.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8.2,
    });
    const fc = sessionToFeatureCollection(session, [obs], { appVersion: '0.1.0' });
    expect(fc.features[0].properties.photo).toBeNull();
  });

  test('orders features by recorded_at ascending regardless of input order', () => {
    const earlier = createObservation({
      id: 'obs-early',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T10:00:00.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8,
    });
    const later = createObservation({
      id: 'obs-late',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T11:00:00.000Z',
      fixAt: '2026-08-06T11:00:00.000Z',
      lat: 51.6,
      lon: -0.15,
      gpsAccuracyM: 8,
    });

    const fc = sessionToFeatureCollection(session, [later, earlier], { appVersion: '0.1.0' });

    expect(fc.features.map((f) => f.properties.obs_id)).toEqual(['obs-early', 'obs-late']);
  });

  test('breaks recorded_at ties by observation id, independent of input order', () => {
    // Two saves inside the same second are entirely plausible in the field;
    // without an explicit tiebreak the output order would depend on
    // insertion order, and sync's byte-identical guarantee depends on
    // identical content always serialising identically.
    const shared = {
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T10:00:00.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8,
    };
    const first = createObservation({ ...shared, id: '01AAAAAAAAAAAAAAAAAAAAAAAA' });
    const second = createObservation({ ...shared, id: '01BBBBBBBBBBBBBBBBBBBBBBBB' });

    const fc = sessionToFeatureCollection(session, [second, first], { appVersion: '0.1.0' });

    expect(fc.features.map((f) => f.properties.obs_id)).toEqual([
      '01AAAAAAAAAAAAAAAAAAAAAAAA',
      '01BBBBBBBBBBBBBBBBBBBBBBBB',
    ]);
  });
});

describe('traced observations', () => {
  const LINE = {
    type: 'LineString',
    coordinates: [
      [-0.14, 51.5],
      [-0.14, 51.501],
    ],
  };

  const traceObs = (geometry) =>
    createObservation({
      id: 'obs-t',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T09:40:00.000Z',
      lat: 51.5005,
      lon: -0.14,
      gpsAccuracyM: 12,
      positionSource: 'trace',
      geometry,
    });

  test('a traced path exports its LineString and walked length', () => {
    const fc = sessionToFeatureCollection(session, [traceObs(LINE)], { appVersion: '0.1.0' });

    expect(fc.features[0].geometry).toEqual(LINE);
    // ~111 m of northing - derived from the geometry at export time.
    expect(fc.features[0].properties.trace_length_m).toBeCloseTo(111.2, 0);
    expect(fc.features[0].properties.position_source).toBe('trace');
    // The representative point still rides in the properties, authoritative
    // for import exactly like a Point observation's coordinates.
    expect(fc.features[0].properties.lat).toBe(51.5005);
  });

  test('a traced boundary exports its Polygon and perimeter', () => {
    const ring = [
      [-0.14, 51.5],
      [-0.1386, 51.5],
      [-0.1386, 51.501],
      [-0.14, 51.5],
    ];
    const fc = sessionToFeatureCollection(
      session,
      [traceObs({ type: 'Polygon', coordinates: [ring] })],
      { appVersion: '0.1.0' },
    );

    expect(fc.features[0].geometry.type).toBe('Polygon');
    expect(fc.features[0].properties.trace_length_m).toBeGreaterThan(300);
  });

  test('point observations carry trace_length_m null, keeping the column set stable', () => {
    const obs = createObservation({
      id: 'obs-1',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T09:59:20.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8.2,
    });

    const fc = sessionToFeatureCollection(session, [obs], { appVersion: '0.1.0' });

    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [-0.14, 51.5] });
    expect(fc.features[0].properties).toHaveProperty('trace_length_m', null);
  });

  test('records stored before geometry existed still export as Points', () => {
    // A raw stored record with no geometry key at all - `?? null` reads,
    // because canonicalStringify drops undefined.
    const legacy = {
      id: 'obs-old',
      sessionId: 'sess-1',
      recordedAt: '2026-08-06T10:00:00.000Z',
      fixAt: '2026-08-06T09:59:20.000Z',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8.2,
    };

    const fc = sessionToFeatureCollection(session, [legacy], { appVersion: '0.1.0' });

    expect(fc.features[0].geometry.type).toBe('Point');
    expect(fc.features[0].properties.trace_length_m).toBeNull();
  });
});
