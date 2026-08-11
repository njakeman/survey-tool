import { describe, expect, test } from 'vitest';
import { bearingDeg, distanceM, metresPerPixel, pickAccuracyM } from './distance.js';

const LONDON = { lat: 51.5, lon: -0.14 };

describe('distanceM', () => {
  test('a degree of latitude is about 111 km, anywhere', () => {
    expect(distanceM({ lat: 51, lon: -1 }, { lat: 52, lon: -1 })).toBeCloseTo(111_195, -2);
  });

  test('a degree of longitude shrinks with latitude', () => {
    // The mistake this catches is treating a degree of longitude as fixed,
    // which at UK latitudes overstates east-west distance by about 60%.
    const atEquator = distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    const atFiftyOne = distanceM({ lat: 51, lon: 0 }, { lat: 51, lon: 1 });

    expect(atFiftyOne / atEquator).toBeCloseTo(Math.cos((51 * Math.PI) / 180), 3);
  });

  test('is zero for a point and itself, not a rounding artefact', () => {
    expect(distanceM(LONDON, { ...LONDON })).toBe(0);
  });

  test('is symmetric', () => {
    const there = distanceM(LONDON, { lat: 51.51, lon: -0.12 });
    const back = distanceM({ lat: 51.51, lon: -0.12 }, LONDON);
    expect(there).toBeCloseTo(back, 9);
  });

  test('handles a missing endpoint rather than returning NaN', () => {
    // A fix may not have arrived yet when the crosshair is already moving.
    expect(distanceM(null, LONDON)).toBeNull();
    expect(distanceM(LONDON, null)).toBeNull();
  });
});

describe('bearingDeg', () => {
  test.each([
    ['north', { lat: 52, lon: -0.14 }, 0],
    ['east', { lat: 51.5, lon: 0.36 }, 90],
    ['south', { lat: 51, lon: -0.14 }, 180],
    ['west', { lat: 51.5, lon: -0.64 }, 270],
  ])('due %s reads %i degrees', (_name, to, expected) => {
    expect(bearingDeg(LONDON, to)).toBeCloseTo(expected, 0);
  });

  test('is always in 0–360, never negative', () => {
    // atan2 returns negatives for western bearings, and a "-90° NW" readout
    // would be nonsense on the picking banner.
    const westish = bearingDeg(LONDON, { lat: 51.6, lon: -0.5 });
    expect(westish).toBeGreaterThanOrEqual(0);
    expect(westish).toBeLessThan(360);
  });
});

describe('metresPerPixel', () => {
  test('halves with every zoom level', () => {
    expect(metresPerPixel(51.5, 13) / metresPerPixel(51.5, 14)).toBeCloseTo(2, 6);
  });

  test('is around half a metre at the zoom a surveyor works at', () => {
    // z18 over the UK — the sanity anchor for the accuracy figure below.
    expect(metresPerPixel(51.5, 18)).toBeGreaterThan(0.3);
    expect(metresPerPixel(51.5, 18)).toBeLessThan(0.8);
  });
});

describe('pickAccuracyM', () => {
  test('rewards zooming in — a closer pick is genuinely a better one', () => {
    expect(pickAccuracyM(51.5, 18)).toBeLessThan(pickAccuracyM(51.5, 14));
  });

  test('is a few metres zoomed right in and tens of metres zoomed out', () => {
    expect(pickAccuracyM(51.5, 18)).toBeLessThan(5);
    expect(pickAccuracyM(51.5, 12)).toBeGreaterThan(20);
  });

  test('never claims a perfect measurement', () => {
    // createObservation accepts 0, and an observation asserting zero
    // uncertainty would be the least trustworthy number in the file.
    expect(pickAccuracyM(51.5, 24)).toBeGreaterThan(0);
  });
});
