import { describe, expect, test } from 'vitest';
import { createObservation } from './observation.js';

const baseFields = {
  id: 'obs-1',
  sessionId: 'sess-1',
  recordedAt: '2026-08-06T10:00:00.000Z',
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
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8.2,
      altitudeM: null,
      altitudeAccuracyM: null,
      headingDeg: null,
      headingAccuracyDeg: null,
      note: '',
      photoId: null,
      synced: false,
      syncedAt: null,
    });
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
  ])('throws when %s is missing', (field, fields) => {
    expect(() => createObservation(fields)).toThrow(new RegExp(field, 'i'));
  });

  test.each([
    ['lat above 90', { ...baseFields, lat: 91 }],
    ['lat below -90', { ...baseFields, lat: -91 }],
    ['lon above 180', { ...baseFields, lon: 181 }],
    ['lon below -180', { ...baseFields, lon: -181 }],
  ])('throws for out-of-range coordinate: %s', (_label, fields) => {
    expect(() => createObservation(fields)).toThrow(/lat|lon/i);
  });

  test('throws when gpsAccuracyM is negative, since a negative accuracy is meaningless', () => {
    expect(() => createObservation({ ...baseFields, gpsAccuracyM: -1 })).toThrow(/gpsAccuracyM/i);
  });
});
