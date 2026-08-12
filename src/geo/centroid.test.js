import { describe, expect, test } from 'vitest';
import { polygonCentroid, polygonExtentM } from './centroid.js';
import { distanceM } from './distance.js';

// A 2×2 square with a 1×1 bite out of its top-right: vertices (0,0) (2,0)
// (2,1) (1,1) (1,2) (0,2). Area 3, centroid (5/6, 5/6) — decisively not the
// vertex average (1, 1), which is what a lazy implementation returns.
const L_RING = [
  [0, 0],
  [2, 0],
  [2, 1],
  [1, 1],
  [1, 2],
  [0, 2],
  [0, 0],
];

const SQUARE_RING = [
  [-0.15, 50.86],
  [-0.14, 50.86],
  [-0.14, 50.87],
  [-0.15, 50.87],
  [-0.15, 50.86],
];

describe('polygonCentroid', () => {
  test('finds the centre of a square', () => {
    const centre = polygonCentroid({ type: 'Polygon', coordinates: [SQUARE_RING] });

    expect(centre.lon).toBeCloseTo(-0.145, 6);
    expect(centre.lat).toBeCloseTo(50.865, 6);
  });

  test('is area-weighted, not the average of the vertices', () => {
    const centre = polygonCentroid({ type: 'Polygon', coordinates: [L_RING] });

    expect(centre.lon).toBeCloseTo(5 / 6, 6);
    expect(centre.lat).toBeCloseTo(5 / 6, 6);
  });

  test('does not care which way the ring winds', () => {
    const reversed = [...L_RING].reverse();
    const centre = polygonCentroid({ type: 'Polygon', coordinates: [reversed] });

    expect(centre.lon).toBeCloseTo(5 / 6, 6);
    expect(centre.lat).toBeCloseTo(5 / 6, 6);
  });

  test('a MultiPolygon takes the centroid of its largest member', () => {
    const small = [
      [10, 10],
      [10.001, 10],
      [10.001, 10.001],
      [10, 10.001],
      [10, 10],
    ];
    const centre = polygonCentroid({
      type: 'MultiPolygon',
      coordinates: [[small], [SQUARE_RING]],
    });

    expect(centre.lon).toBeCloseTo(-0.145, 6);
    expect(centre.lat).toBeCloseTo(50.865, 6);
  });

  test('falls back to the vertex average for a degenerate, zero-area ring', () => {
    const line = [
      [0, 0],
      [1, 1],
      [2, 2],
      [0, 0],
    ];
    const centre = polygonCentroid({ type: 'Polygon', coordinates: [line] });

    expect(centre.lon).toBeCloseTo(1, 6);
    expect(centre.lat).toBeCloseTo(1, 6);
  });

  test('is null for anything that is not a polygon', () => {
    expect(polygonCentroid({ type: 'Point', coordinates: [0, 0] })).toBeNull();
    expect(
      polygonCentroid({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toBeNull();
    expect(polygonCentroid(null)).toBeNull();
    expect(polygonCentroid({ type: 'Polygon', coordinates: [] })).toBeNull();
  });
});

describe('polygonExtentM', () => {
  test('reaches the farthest vertex of the outer ring', () => {
    const centre = { lat: 50.865, lon: -0.145 };
    const extent = polygonExtentM({ type: 'Polygon', coordinates: [SQUARE_RING] }, centre);

    const corner = distanceM(centre, { lat: 50.86, lon: -0.15 });
    expect(extent).toBeCloseTo(corner, 6);
  });

  test('spans every member of a MultiPolygon — the point stands for all of it', () => {
    const far = [
      [-0.2, 50.9],
      [-0.19, 50.9],
      [-0.19, 50.91],
      [-0.2, 50.91],
      [-0.2, 50.9],
    ];
    const centre = { lat: 50.865, lon: -0.145 };
    const extent = polygonExtentM(
      { type: 'MultiPolygon', coordinates: [[SQUARE_RING], [far]] },
      centre,
    );

    expect(extent).toBeGreaterThan(distanceM(centre, { lat: 50.87, lon: -0.15 }));
  });

  test('never reports below a metre', () => {
    const tiny = [
      [-0.145, 50.865],
      [-0.1450001, 50.865],
      [-0.1450001, 50.8650001],
      [-0.145, 50.865],
    ];
    const extent = polygonExtentM(
      { type: 'Polygon', coordinates: [tiny] },
      { lat: 50.865, lon: -0.145 },
    );

    expect(extent).toBe(1);
  });

  test('is null without a polygon or a centre', () => {
    expect(polygonExtentM({ type: 'Point', coordinates: [0, 0] }, { lat: 0, lon: 0 })).toBeNull();
    expect(polygonExtentM({ type: 'Polygon', coordinates: [SQUARE_RING] }, null)).toBeNull();
  });
});
