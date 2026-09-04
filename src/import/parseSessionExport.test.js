import { describe, expect, test } from 'vitest';
import { parseSessionExport } from './parseSessionExport.js';

// Focused unit tests for parseSessionExport's photos[] handling: which of
// `photos`/legacy `photo` wins, and which entries survive once checked
// against the zip's actual files. importSession.test.js covers the same
// parse as part of the full export→import round trip through storage.

const encoder = new TextEncoder();
const FIXED_NOW = '2026-08-06T10:00:00.000Z';

const geojsonEntry = (text) => ({ name: 'session.geojson', data: encoder.encode(text) });
const photoEntry = (name, bytes) => ({ name: `photos/${name}`, data: new Uint8Array(bytes) });

// One Point feature, `properties` merged over a valid baseline — every test
// below only cares about the photo-related keys.
function collectionWith(properties) {
  return JSON.stringify({
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
          ...properties,
        },
      },
    ],
  });
}

describe('parseSessionExport: photos[]', () => {
  test('reads photos[] with per-photo ref_photo, keeping only backed entries', () => {
    const text = collectionWith({
      photos: [
        { photo: 'p1.jpg', ref_photo: 'r.jpg' },
        { photo: 'p2.jpg', ref_photo: null },
      ],
      ref_obs_id: 'ref-1',
      photo: 'p1.jpg',
    });

    const parsed = parseSessionExport([geojsonEntry(text), photoEntry('p1.jpg', [1, 2, 3])]);

    expect(parsed.observations[0].photos).toEqual([
      {
        id: 'p1',
        referencePhoto: 'r.jpg',
        focalLength35mm: null,
        focalLengthMm: null,
        lensModel: null,
      },
    ]);
    expect(parsed.photos.map((p) => p.photoId)).toEqual(['p1']);
  });

  test('a legacy export with only photo/ref_photo becomes a one-entry photos[]', () => {
    const text = collectionWith({ photo: 'obs-1.jpg', ref_photo: 'r.jpg', ref_obs_id: 'ref-1' });

    const parsed = parseSessionExport([geojsonEntry(text), photoEntry('obs-1.jpg', [4, 5, 6])]);

    expect(parsed.observations[0].photos).toEqual([
      {
        id: 'obs-1',
        referencePhoto: 'r.jpg',
        focalLength35mm: null,
        focalLengthMm: null,
        lensModel: null,
      },
    ]);
  });

  test('photos[] wins over a legacy photo prop when both are present', () => {
    const text = collectionWith({
      photos: [{ photo: 'p1.jpg', ref_photo: null }],
      photo: 'legacy-only.jpg',
    });

    const parsed = parseSessionExport([geojsonEntry(text), photoEntry('p1.jpg', [1])]);

    expect(parsed.observations[0].photos).toEqual([
      {
        id: 'p1',
        referencePhoto: null,
        focalLength35mm: null,
        focalLengthMm: null,
        lensModel: null,
      },
    ]);
  });

  test('neither photos nor a legacy photo leaves an empty array, not null', () => {
    const text = collectionWith({});

    const parsed = parseSessionExport([geojsonEntry(text)]);

    expect(parsed.observations[0].photos).toEqual([]);
  });

  test('an entry with no matching file in the zip is dropped, not nulled', () => {
    const text = collectionWith({
      photos: [
        { photo: 'p1.jpg', ref_photo: null },
        { photo: 'missing.jpg', ref_photo: null },
      ],
    });

    const parsed = parseSessionExport([geojsonEntry(text), photoEntry('p1.jpg', [1])]);

    expect(parsed.observations[0].photos).toEqual([
      {
        id: 'p1',
        referencePhoto: null,
        focalLength35mm: null,
        focalLengthMm: null,
        lensModel: null,
      },
    ]);
    expect(parsed.photos.map((p) => p.photoId)).toEqual(['p1']);
  });

  test('a photo property that is not a filename string fails by name', () => {
    // A foreign file's "photo": 42 used to reach String.replace and die as
    // "name.replace is not a function" — unreadable on the Import tap.
    const text = collectionWith({ photo: 42 });

    expect(() => parseSessionExport([geojsonEntry(text)])).toThrow(
      /Could not import feature 1: photo must be a photo filename string/,
    );
  });

  test('a photos[] entry whose photo is not a filename string fails by name', () => {
    const text = collectionWith({ photos: [{ photo: 42, ref_photo: null }] });

    expect(() => parseSessionExport([geojsonEntry(text)])).toThrow(
      /Could not import feature 1: photos\[0\]\.photo must be a photo filename string/,
    );
  });

  test('a bare ref_photo with no photo at all imports as photos: [], referenceObservationId intact', () => {
    // A station a surveyor revisited but photographed nothing new at: the
    // pairing key survives independently of any photo, and the old
    // ref_photo convenience string has nothing to attach to, so it's
    // dropped rather than forced onto a photo entry that doesn't exist.
    const text = collectionWith({ ref_obs_id: 'ref-1', ref_photo: 'old.jpg' });

    const parsed = parseSessionExport([geojsonEntry(text)]);

    expect(parsed.observations[0].photos).toEqual([]);
    expect(parsed.observations[0].referenceObservationId).toBe('ref-1');
  });
});

describe('parseSessionExport: the lens per photo (2026-09-04)', () => {
  test('reads focal_length_35mm, focal_length_mm and lens back onto each photo', () => {
    const text = collectionWith({
      photos: [
        {
          photo: 'p1.jpg',
          ref_photo: null,
          focal_length_35mm: 14,
          focal_length_mm: 2.22,
          lens: 'uw',
        },
      ],
      photo: 'p1.jpg',
    });

    const parsed = parseSessionExport([geojsonEntry(text), photoEntry('p1.jpg', [1])]);

    expect(parsed.observations[0].photos).toEqual([
      { id: 'p1', referencePhoto: null, focalLength35mm: 14, focalLengthMm: 2.22, lensModel: 'uw' },
    ]);
  });

  test('an export from before the lens existed imports with nulls', () => {
    const text = collectionWith({
      photos: [{ photo: 'p1.jpg', ref_photo: null }],
      photo: 'p1.jpg',
    });

    const parsed = parseSessionExport([geojsonEntry(text), photoEntry('p1.jpg', [1])]);

    expect(parsed.observations[0].photos[0]).toMatchObject({
      focalLength35mm: null,
      focalLengthMm: null,
      lensModel: null,
    });
  });
});
