import { describe, expect, test } from 'vitest';
import { parseReferenceExport } from './parseReferenceExport.js';

// The reference parse: the same validation as import (every feature back
// through createObservation) but returning photo *filenames* instead of
// bytes — the zip stays where it is and photos decode one at a time later.

const encoder = new TextEncoder();

function feature(props) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [props.lon, props.lat] },
    properties: {
      obs_id: 'ref-1',
      recorded_at: '2025-04-12T10:00:00.000Z',
      fix_at: '2025-04-12T09:59:20.000Z',
      lat: 51.5,
      lon: -0.14,
      gps_accuracy_m: 4.1,
      heading_deg: 38,
      note: 'Stone stile, west boundary.',
      photo: 'ref-1.jpg',
      ...props,
    },
  };
}

function collectionBytes({ features, session = true }) {
  const collection = {
    type: 'FeatureCollection',
    ...(session
      ? {
          survey_session: {
            id: 'ref-sess-1',
            name: 'Long Barrow south',
            started_at: '2025-04-12T09:00:00.000Z',
            ended_at: '2025-04-12T12:00:00.000Z',
          },
        }
      : {}),
    features,
  };
  return encoder.encode(JSON.stringify(collection));
}

describe('parseReferenceExport', () => {
  test('returns the reference session identity, id included', () => {
    const { session } = parseReferenceExport(collectionBytes({ features: [feature({})] }), [
      'session.geojson',
      'photos/ref-1.jpg',
    ]);

    expect(session).toEqual({
      id: 'ref-sess-1',
      name: 'Long Barrow south',
      startedAt: '2025-04-12T09:00:00.000Z',
      endedAt: '2025-04-12T12:00:00.000Z',
    });
  });

  test('stations are validated observations in feature order, with their photos', () => {
    const bytes = collectionBytes({
      features: [
        feature({}),
        feature({ obs_id: 'ref-2', photo: 'ref-2.jpg', note: 'Culvert head.' }),
      ],
    });

    const { stations } = parseReferenceExport(bytes, [
      'session.geojson',
      'photos/ref-1.jpg',
      'photos/ref-2.jpg',
    ]);

    expect(stations.map((s) => s.id)).toEqual(['ref-1', 'ref-2']);
    expect(stations[0].lat).toBe(51.5);
    expect(stations[0].headingDeg).toBe(38);
    expect(stations[0].note).toBe('Stone stile, west boundary.');
    expect(stations[0].photos).toEqual([
      {
        filename: 'ref-1.jpg',
        entryName: 'photos/ref-1.jpg',
        focalLength35mm: null,
        focalLengthMm: null,
        lensModel: null,
      },
    ]);
  });

  test('lists every backed reference photo per station in order, ignoring unbacked claims', () => {
    const bytes = collectionBytes({
      features: [
        feature({
          photo: undefined,
          photos: [{ photo: 'a.jpg' }, { photo: 'missing.jpg' }, { photo: 'B.JPG' }],
        }),
      ],
    });

    const { stations } = parseReferenceExport(bytes, [
      'session.geojson',
      'photos/a.jpg',
      'photos/b.jpg',
    ]);

    expect(stations[0].photos).toEqual([
      {
        filename: 'a.jpg',
        entryName: 'photos/a.jpg',
        focalLength35mm: null,
        focalLengthMm: null,
        lensModel: null,
      },
      {
        filename: 'B.JPG',
        entryName: 'photos/b.jpg',
        focalLength35mm: null,
        focalLengthMm: null,
        lensModel: null,
      },
    ]);
    expect(stations[0]).not.toHaveProperty('photoFilename');
    expect(stations[0]).not.toHaveProperty('photoEntryName');
  });

  test('a legacy reference with a single photo property yields one entry', () => {
    const bytes = collectionBytes({ features: [feature({ photo: 'ref-1.jpg' })] });

    const { stations } = parseReferenceExport(bytes, ['session.geojson', 'photos/ref-1.jpg']);

    expect(stations[0].photos).toEqual([
      {
        filename: 'ref-1.jpg',
        entryName: 'photos/ref-1.jpg',
        focalLength35mm: null,
        focalLengthMm: null,
        lensModel: null,
      },
    ]);
  });

  test('a photo claim the zip cannot back is dropped, not trusted', () => {
    const { stations } = parseReferenceExport(collectionBytes({ features: [feature({})] }), [
      'session.geojson',
    ]);

    expect(stations[0].photos).toEqual([]);
  });

  test('a station without a photo is still a station', () => {
    const { stations } = parseReferenceExport(
      collectionBytes({ features: [feature({ photo: null })] }),
      ['session.geojson'],
    );

    expect(stations[0].photos).toEqual([]);
  });

  test('a photo property that is not a filename string fails by name, never as a TypeError', () => {
    expect(() =>
      parseReferenceExport(collectionBytes({ features: [feature({ photo: 42 })] }), [
        'session.geojson',
      ]),
    ).toThrow(/photo must be a photo filename string/);
  });

  test('refuses an export with nothing to revisit, by name', () => {
    expect(() =>
      parseReferenceExport(collectionBytes({ features: [] }), ['session.geojson']),
    ).toThrow(/no observations to revisit/);
  });

  test('tolerates a v1 export with no survey_session member — the id is simply unknown', () => {
    const bytes = collectionBytes({
      features: [feature({ session_name: 'Old survey' })],
      session: false,
    });

    const { session } = parseReferenceExport(bytes, ['session.geojson', 'photos/ref-1.jpg']);

    expect(session.id).toBeNull();
    expect(session.name).toBe('Old survey');
  });

  test('a malformed feature fails with a named reason, exactly as import does', () => {
    expect(() =>
      parseReferenceExport(collectionBytes({ features: [feature({ lat: 512 })] }), [
        'session.geojson',
      ]),
    ).toThrow(/feature 1.*lat/i);
  });
});

describe('the lens per photo on a station (2026-09-04)', () => {
  test('each station photo carries the lens the reference was shot on, null when unknown', () => {
    const bytes = collectionBytes({
      features: [
        feature({
          photos: [
            {
              photo: 'ref-1.jpg',
              ref_photo: null,
              focal_length_35mm: 14,
              focal_length_mm: 2.22,
              lens: 'uw',
            },
            { photo: 'ref-1b.jpg', ref_photo: null },
          ],
        }),
      ],
    });

    const { stations } = parseReferenceExport(bytes, [
      'session.geojson',
      'photos/ref-1.jpg',
      'photos/ref-1b.jpg',
    ]);

    expect(stations[0].photos).toEqual([
      {
        filename: 'ref-1.jpg',
        entryName: 'photos/ref-1.jpg',
        focalLength35mm: 14,
        focalLengthMm: 2.22,
        lensModel: 'uw',
      },
      {
        filename: 'ref-1b.jpg',
        entryName: 'photos/ref-1b.jpg',
        focalLength35mm: null,
        focalLengthMm: null,
        lensModel: null,
      },
    ]);
  });
});
