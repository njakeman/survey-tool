import { describe, expect, test } from 'vitest';
import { computeTargetDimensions, MAX_LONG_EDGE, MAX_PHOTOS } from './dimensions.js';

describe('computeTargetDimensions', () => {
  test('exports 1600 as the default max long edge', () => {
    expect(MAX_LONG_EDGE).toBe(1600);
  });

  test('exports 10 as the soft cap on photos per observation', () => {
    expect(MAX_PHOTOS).toBe(10);
  });

  test('downscales a landscape image to the max long edge, preserving aspect ratio', () => {
    expect(computeTargetDimensions({ width: 4032, height: 3024, maxLongEdge: 1600 })).toEqual({
      width: 1600,
      height: 1200,
    });
  });

  test('downscales a portrait image to the max long edge, preserving aspect ratio', () => {
    expect(computeTargetDimensions({ width: 3024, height: 4032, maxLongEdge: 1600 })).toEqual({
      width: 1200,
      height: 1600,
    });
  });

  test('downscales a square image', () => {
    expect(computeTargetDimensions({ width: 2000, height: 2000, maxLongEdge: 1600 })).toEqual({
      width: 1600,
      height: 1600,
    });
  });

  test('never upscales an image already smaller than the max long edge', () => {
    expect(computeTargetDimensions({ width: 800, height: 600, maxLongEdge: 1600 })).toEqual({
      width: 800,
      height: 600,
    });
  });

  test('leaves an image exactly at the max long edge unchanged', () => {
    expect(computeTargetDimensions({ width: 1600, height: 900, maxLongEdge: 1600 })).toEqual({
      width: 1600,
      height: 900,
    });
  });

  test('rounds the scaled dimension to an integer', () => {
    expect(computeTargetDimensions({ width: 1000, height: 333, maxLongEdge: 500 })).toEqual({
      width: 500,
      height: 167,
    });
  });

  test('clamps an extreme aspect ratio so the short edge never rounds to zero', () => {
    expect(computeTargetDimensions({ width: 5000, height: 3, maxLongEdge: 1600 })).toEqual({
      width: 1600,
      height: 1,
    });
  });

  test('uses the default max long edge when none is given', () => {
    expect(computeTargetDimensions({ width: 4000, height: 2000 })).toEqual({
      width: 1600,
      height: 800,
    });
  });

  test.each([
    ['width is zero', { width: 0, height: 100 }],
    ['height is zero', { width: 100, height: 0 }],
    ['width is negative', { width: -100, height: 100 }],
    ['height is NaN', { width: 100, height: NaN }],
    ['width is missing', { height: 100 }],
  ])('throws when %s', (_label, dims) => {
    expect(() => computeTargetDimensions(dims)).toThrow();
  });
});
