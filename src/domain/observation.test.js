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
      photos: [],
      audioId: null,
      featureLayerId: null,
      featureId: null,
      featureLabel: null,
      positionSource: 'gps',
      geometry: null,
      traceGaps: null,
      audioDurationMs: null,
      changedAt: null,
      referenceObservationId: null,
      synced: false,
      syncedAt: null,
    });
  });

  describe('revisit pairing', () => {
    test('carries the reference station it revisits, and that station’s photo filename', () => {
      const obs = createObservation({
        ...baseFields,
        referenceObservationId: 'ref-obs-4',
        photos: [{ id: 'photo-1', referencePhoto: 'ref-obs-4.jpg' }],
      });

      expect(obs.referenceObservationId).toBe('ref-obs-4');
      expect(obs.photos[0].referencePhoto).toBe('ref-obs-4.jpg');
    });

    test('a station with no photo still pairs — the id alone is a legal link', () => {
      const obs = createObservation({ ...baseFields, referenceObservationId: 'ref-obs-4' });

      expect(obs.referenceObservationId).toBe('ref-obs-4');
      expect(obs.photos).toEqual([]);
    });

    test('rejects a reference photo without its station — a filename joins to nothing', () => {
      expect(() =>
        createObservation({
          ...baseFields,
          photos: [{ id: 'photo-1', referencePhoto: 'ref-obs-4.jpg' }],
        }),
      ).toThrow(/referencePhoto/);
    });
  });

  test('carries a voice note duration so a list row can say 0:12 without loading the blob', () => {
    const obs = createObservation({ ...baseFields, audioId: 'obs-1', audioDurationMs: 12_400 });

    expect(obs.audioDurationMs).toBe(12_400);
  });

  test('rejects a duration that is not a non-negative number', () => {
    // NaN would render as "NaN:NaN" on the chip; a negative one is garbage in.
    expect(() => createObservation({ ...baseFields, audioDurationMs: -1 })).toThrow(
      /audioDurationMs/,
    );
    expect(() => createObservation({ ...baseFields, audioDurationMs: Number.NaN })).toThrow(
      /audioDurationMs/,
    );
  });

  test('carries the changed-since-save stamp for records edited after the fact', () => {
    const obs = createObservation({ ...baseFields, changedAt: '2026-08-14T10:00:00.000Z' });

    expect(obs.changedAt).toBe('2026-08-14T10:00:00.000Z');
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
      photos: [{ id: 'photo-1' }],
    });
    expect(obs.altitudeM).toBe(45.2);
    expect(obs.headingDeg).toBe(271.5);
    expect(obs.note).toBe('gate post, leaning');
    expect(obs.photos).toEqual([{ id: 'photo-1', referencePhoto: null }]);
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

  describe('traced geometry', () => {
    const LINE = {
      type: 'LineString',
      coordinates: [
        [-0.14, 51.5],
        [-0.141, 51.501],
      ],
    };
    const RING = [
      [-0.14, 51.5],
      [-0.141, 51.5],
      [-0.141, 51.501],
      [-0.14, 51.5],
    ];

    test('a traced path carries its LineString', () => {
      const obs = createObservation({ ...baseFields, positionSource: 'trace', geometry: LINE });

      expect(obs.positionSource).toBe('trace');
      expect(obs.geometry).toEqual(LINE);
    });

    test('a traced boundary carries its Polygon', () => {
      const obs = createObservation({
        ...baseFields,
        positionSource: 'trace',
        geometry: { type: 'Polygon', coordinates: [RING] },
      });

      expect(obs.geometry.type).toBe('Polygon');
    });

    test('rejects half a trace, mirroring the feature-link rule', () => {
      // A geometry without the 'trace' provenance claims a walked line came
      // from a single fix; 'trace' without a geometry is a line that isn't
      // there. Either half alone is worse than neither.
      expect(() => createObservation({ ...baseFields, positionSource: 'trace' })).toThrow(
        /geometry/,
      );
      expect(() => createObservation({ ...baseFields, geometry: LINE })).toThrow(/positionSource/);
    });

    test('rejects a LineString with fewer than two positions', () => {
      expect(() =>
        createObservation({
          ...baseFields,
          positionSource: 'trace',
          geometry: { type: 'LineString', coordinates: [[-0.14, 51.5]] },
        }),
      ).toThrow(/two positions/i);
    });

    test('rejects an out-of-range position anywhere in the geometry', () => {
      expect(() =>
        createObservation({
          ...baseFields,
          positionSource: 'trace',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-0.14, 51.5],
              [-0.14, 91],
            ],
          },
        }),
      ).toThrow(/geometry position/i);
    });

    test('rejects an unclosed polygon ring', () => {
      const open = [
        [-0.14, 51.5],
        [-0.141, 51.5],
        [-0.141, 51.501],
        [-0.142, 51.5],
      ];
      expect(() =>
        createObservation({
          ...baseFields,
          positionSource: 'trace',
          geometry: { type: 'Polygon', coordinates: [open] },
        }),
      ).toThrow(/ring/i);
    });

    test('rejects a polygon that is not exactly one ring — traces never have holes', () => {
      expect(() =>
        createObservation({
          ...baseFields,
          positionSource: 'trace',
          geometry: { type: 'Polygon', coordinates: [RING, RING] },
        }),
      ).toThrow(/one ring/i);
    });

    test('rejects a ring with fewer than three distinct vertices', () => {
      const flat = [
        [-0.14, 51.5],
        [-0.141, 51.5],
        [-0.14, 51.5],
        [-0.141, 51.5],
        [-0.14, 51.5],
      ];
      expect(() =>
        createObservation({
          ...baseFields,
          positionSource: 'trace',
          geometry: { type: 'Polygon', coordinates: [flat] },
        }),
      ).toThrow(/distinct/i);
    });

    test('rejects a geometry type it does not know', () => {
      expect(() =>
        createObservation({
          ...baseFields,
          positionSource: 'trace',
          geometry: { type: 'Point', coordinates: [-0.14, 51.5] },
        }),
      ).toThrow(/geometry/i);
    });

    test('accepts a self-intersecting ring — warn-save-anyway must survive re-import', () => {
      // The finish step warns about a figure-eight but saves it; validating
      // it here would make that saved boundary fail its own re-import.
      const bowTie = [
        [0, 0],
        [2, 2],
        [2, 0],
        [0, 2],
        [0, 0],
      ];
      const obs = createObservation({
        ...baseFields,
        positionSource: 'trace',
        geometry: { type: 'Polygon', coordinates: [bowTie] },
      });

      expect(obs.geometry.coordinates[0]).toEqual(bowTie);
    });
  });

  describe('trace gaps', () => {
    // A three-segment path: valid gap indices are 1 and 2 (segment i-1 → i).
    const LINE3 = {
      type: 'LineString',
      coordinates: [
        [-0.14, 51.5],
        [-0.141, 51.501],
        [-0.142, 51.502],
      ],
    };
    const traced = (overrides = {}) =>
      createObservation({ ...baseFields, positionSource: 'trace', geometry: LINE3, ...overrides });

    test('carries the inferred-segment indices of a walk the platform interrupted', () => {
      expect(traced({ traceGaps: [1] }).traceGaps).toEqual([1]);
    });

    test('defaults to null, and an empty array normalises to null', () => {
      expect(traced().traceGaps).toBeNull();
      expect(traced({ traceGaps: [] }).traceGaps).toBeNull();
    });

    test('rejects gaps without a geometry — segment indices into nothing', () => {
      expect(() => createObservation({ ...baseFields, traceGaps: [1] })).toThrow(/traceGaps/);
    });

    test('rejects a non-array, a non-integer, and an unordered list', () => {
      expect(() => traced({ traceGaps: 1 })).toThrow(/traceGaps/);
      expect(() => traced({ traceGaps: [1.5] })).toThrow(/traceGaps/);
      expect(() => traced({ traceGaps: [2, 1] })).toThrow(/traceGaps/);
      expect(() => traced({ traceGaps: [1, 1] })).toThrow(/traceGaps/);
    });

    test('rejects indices outside the segment range', () => {
      // 0 has no preceding segment; a LineString of 3 coords has segments 1..2.
      expect(() => traced({ traceGaps: [0] })).toThrow(/traceGaps/);
      expect(() => traced({ traceGaps: [3] })).toThrow(/traceGaps/);
    });

    test('a polygon ring’s synthetic closing segment is not flaggable', () => {
      const ring = [
        [-0.14, 51.5],
        [-0.141, 51.5],
        [-0.141, 51.501],
        [-0.14, 51.5],
      ];
      const boundary = (traceGaps) =>
        traced({ geometry: { type: 'Polygon', coordinates: [ring] }, traceGaps });

      // Vertices are ring[0..2]; segments 1 and 2 are walkable, 3 is closure.
      expect(boundary([1, 2]).traceGaps).toEqual([1, 2]);
      expect(() => boundary([3])).toThrow(/traceGaps/);
    });
  });

  test('throws when gpsAccuracyM is negative, since a negative accuracy is meaningless', () => {
    expect(() => createObservation({ ...baseFields, gpsAccuracyM: -1 })).toThrow(/gpsAccuracyM/i);
  });

  test.each([NaN, undefined])('throws when gpsAccuracyM is non-finite (%s)', (value) => {
    expect(() => createObservation({ ...baseFields, gpsAccuracyM: value })).toThrow(
      /gpsAccuracyM/i,
    );
  });

  describe('photos', () => {
    test('defaults to an empty array and carries no photoId', () => {
      const obs = createObservation(baseFields);
      expect(obs.photos).toEqual([]);
      expect(obs).not.toHaveProperty('photoId');
      expect(obs).not.toHaveProperty('referencePhoto');
    });

    test('keeps capture order and normalises a bare entry to referencePhoto: null', () => {
      const obs = createObservation({
        ...baseFields,
        photos: [{ id: 'p2' }, { id: 'p1', referencePhoto: null }],
      });
      expect(obs.photos).toEqual([
        { id: 'p2', referencePhoto: null },
        { id: 'p1', referencePhoto: null },
      ]);
    });

    test('rejects a non-array, an entry without an id, and a duplicate id', () => {
      expect(() => createObservation({ ...baseFields, photos: 'p1' })).toThrow(
        /photos must be an array/,
      );
      expect(() => createObservation({ ...baseFields, photos: [{}] })).toThrow(/photos\[0\]/);
      expect(() =>
        createObservation({ ...baseFields, photos: [{ id: 'p1' }, { id: 'p1' }] }),
      ).toThrow(/duplicate/);
    });

    test('a referencePhoto on any entry requires referenceObservationId', () => {
      expect(() =>
        createObservation({ ...baseFields, photos: [{ id: 'p1', referencePhoto: 'abc.jpg' }] }),
      ).toThrow(/referencePhoto requires referenceObservationId/);
      const obs = createObservation({
        ...baseFields,
        referenceObservationId: 'ref-1',
        photos: [{ id: 'p1', referencePhoto: 'abc.jpg' }, { id: 'p2' }],
      });
      expect(obs.photos[0].referencePhoto).toBe('abc.jpg');
      expect(obs.photos[1].referencePhoto).toBeNull();
    });
  });
});
