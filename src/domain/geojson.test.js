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
      features: [],
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
          session_name: 'Ashton Keynes',
          app_version: '0.1.0',
        },
      },
    ]);
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
});
