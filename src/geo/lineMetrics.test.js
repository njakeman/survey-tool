import { describe, expect, test } from 'vitest';
import { lineLengthM, midpointOnLine } from './lineMetrics.js';
import { distanceM } from './distance.js';

// One degree of latitude on the sphere distance.js uses — the fixture every
// length assertion is built from, so the tests never bake in a magic number
// that drifts if the earth radius constant changes.
const DEGREE_M = distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });

describe('lineLengthM', () => {
  test('a two-vertex line is the distance between its ends', () => {
    const length = lineLengthM([
      [0, 0],
      [0, 1],
    ]);

    expect(length).toBeCloseTo(DEGREE_M, 6);
  });

  test('sums every segment of a longer line', () => {
    const length = lineLengthM([
      [0, 0],
      [0, 1],
      [0, 3],
    ]);

    expect(length).toBeCloseTo(3 * DEGREE_M, 6);
  });

  test('a closed ring reports its perimeter', () => {
    const length = lineLengthM([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]);

    // Two meridian sides are exact degrees; the two parallel sides are
    // shorter than a degree away from the equator, so bound rather than pin.
    expect(length).toBeGreaterThan(3.9 * DEGREE_M);
    expect(length).toBeLessThanOrEqual(4 * DEGREE_M + 1);
  });

  test('is null for anything shorter than two vertices', () => {
    expect(lineLengthM([])).toBeNull();
    expect(lineLengthM([[0, 0]])).toBeNull();
    expect(lineLengthM(null)).toBeNull();
  });
});

describe('midpointOnLine', () => {
  test('a two-vertex line has its midpoint halfway between the ends', () => {
    const mid = midpointOnLine([
      [0, 0],
      [0, 2],
    ]);

    expect(mid.lat).toBeCloseTo(1, 6);
    expect(mid.lon).toBeCloseTo(0, 6);
  });

  test('is the distance-midpoint, not the middle vertex', () => {
    // Vertices at 0, 1 and 3 degrees: half the length is 1.5 degrees, which
    // lies inside the second, longer segment — the middle-by-index vertex
    // (0,1) would be wrong.
    const mid = midpointOnLine([
      [0, 0],
      [0, 1],
      [0, 3],
    ]);

    expect(mid.lat).toBeCloseTo(1.5, 5);
    expect(mid.lon).toBeCloseTo(0, 6);
  });

  test('lands exactly on a vertex when the halfway mark falls there', () => {
    const mid = midpointOnLine([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);

    expect(mid.lat).toBeCloseTo(1, 6);
  });

  test('a zero-length line collapses to its own point', () => {
    const mid = midpointOnLine([
      [0.5, 51],
      [0.5, 51],
    ]);

    expect(mid.lat).toBeCloseTo(51, 6);
    expect(mid.lon).toBeCloseTo(0.5, 6);
  });

  test('is null for anything shorter than two vertices', () => {
    expect(midpointOnLine([])).toBeNull();
    expect(midpointOnLine([[0, 0]])).toBeNull();
    expect(midpointOnLine(null)).toBeNull();
  });
});
