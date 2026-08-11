import { describe, expect, test } from 'vitest';
import { createObservation } from './observation.js';

const baseFields = {
  id: 'obs-1',
  sessionId: 'sess-1',
  recordedAt: '2026-08-06T10:00:00.000Z',
  fixAt: '2026-08-06T09:59:20.000Z',
  lat: 51.5,
  lon: -0.14,
  gpsAccuracyM: 8.2,
};

describe('createObservation', () => {
  test('creates an observation with required fields and sensible defaults for the rest', () => {
    const obs = createObservation(baseFields);
    expect(obs).toEqual({
      id: 'obs-1',
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
      audioId: null,
      featureLayerId: null,
      featureId: null,
      featureLabel: null,
      positionSource: 'gps',
      synced: false,
      syncedAt: null,
    });
  });

  test('records that a position was picked off the map rather than measured', () => {
    // gpsAccuracyM holds the map precision for a picked point, which is an
    // honest uncertainty but says nothing about where the number came from.
    // Without this field an eyeballed point and a satellite fix are
    // indistinguishable in the exported data.
    const obs = createObservation({ ...baseFields, positionSource: 'map' });

    expect(obs.positionSource).toBe('map');
  });

  test('rejects a position source it does not know', () => {
    // A typo here would silently claim GPS provenance for something else.
    expect(() => createObservation({ ...baseFields, positionSource: 'gsp' })).toThrow(
      /positionSource/,
    );
  });

  test('records the feature layer, feature and label an observation was started from', () => {
    const obs = createObservation({
      ...baseFields,
      featureLayerId: 'parcels',
      featureId: 'P-42',
      featureLabel: 'SU1408 3921',
    });

    expect(obs.featureLayerId).toBe('parcels');
    expect(obs.featureId).toBe('P-42');
    expect(obs.featureLabel).toBe('SU1408 3921');
  });

  test('rejects half a feature link, which points at nothing resolvable', () => {
    // A feature id without the layer it came from cannot be joined back to
    // any dataset, and a layer without a feature says only "somewhere in
    // there". Either way the link is worse than no link, because it looks
    // like one.
    expect(() => createObservation({ ...baseFields, featureId: 'P-42' })).toThrow(/featureLayerId/);
    expect(() => createObservation({ ...baseFields, featureLayerId: 'parcels' })).toThrow(
      /featureId/,
    );
  });

  test('a label alone is not a link and is dropped rather than half-stored', () => {
    // The label is a human-readable convenience on top of the link, never the
    // link itself.
    const obs = createObservation({ ...baseFields, featureLabel: 'SU1408 3921' });

    expect(obs.featureLabel).toBeNull();
  });

  test('accepts optional altitude, heading, note and photo fields when provided', () => {
    const obs = createObservation({
      ...baseFields,
      altitudeM: 45.2,
      altitudeAccuracyM: 3,
      headingDeg: 271.5,
      headingAccuracyDeg: 5,
      note: 'gate post, leaning',
      photoId: 'photo-1',
    });
    expect(obs.altitudeM).toBe(45.2);
    expect(obs.headingDeg).toBe(271.5);
    expect(obs.note).toBe('gate post, leaning');
    expect(obs.photoId).toBe('photo-1');
  });

  test.each([
    ['id', { ...baseFields, id: undefined }],
    ['sessionId', { ...baseFields, sessionId: undefined }],
    ['recordedAt', { ...baseFields, recordedAt: undefined }],
    ['fixAt', { ...baseFields, fixAt: undefined }],
  ])('throws when %s is missing', (field, fields) => {
    expect(() => createObservation(fields)).toThrow(new RegExp(field, 'i'));
  });

  test.each([
    ['lat above 90', { ...baseFields, lat: 91 }],
    ['lat below -90', { ...baseFields, lat: -91 }],
    ['lon above 180', { ...baseFields, lon: 181 }],
    ['lon below -180', { ...baseFields, lon: -181 }],
    // Non-finite values sail through `<`/`>` comparisons (NaN and undefined
    // compare false against everything), so they need explicit rejection —
    // otherwise they persist and export as invalid [null, null] coordinates.
    ['lat NaN', { ...baseFields, lat: NaN }],
    ['lat undefined', { ...baseFields, lat: undefined }],
    ['lat as string', { ...baseFields, lat: '51.5' }],
    ['lon NaN', { ...baseFields, lon: NaN }],
    ['lon undefined', { ...baseFields, lon: undefined }],
  ])('throws for out-of-range or non-finite coordinate: %s', (_label, fields) => {
    expect(() => createObservation(fields)).toThrow(/lat|lon/i);
  });

  test('throws when gpsAccuracyM is negative, since a negative accuracy is meaningless', () => {
    expect(() => createObservation({ ...baseFields, gpsAccuracyM: -1 })).toThrow(/gpsAccuracyM/i);
  });

  test.each([NaN, undefined])('throws when gpsAccuracyM is non-finite (%s)', (value) => {
    expect(() => createObservation({ ...baseFields, gpsAccuracyM: value })).toThrow(
      /gpsAccuracyM/i,
    );
  });
});
