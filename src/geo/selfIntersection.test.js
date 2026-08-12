import { describe, expect, test } from 'vitest';
import { ringSelfIntersects } from './selfIntersection.js';

const SQUARE = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
];

// The classic figure-eight: the first and third segments cross at (1,1).
const BOW_TIE = [
  [0, 0],
  [2, 2],
  [2, 0],
  [0, 2],
  [0, 0],
];

describe('ringSelfIntersects', () => {
  test('a simple square does not intersect itself', () => {
    expect(ringSelfIntersects(SQUARE)).toBe(false);
  });

  test('a bow-tie does', () => {
    expect(ringSelfIntersects(BOW_TIE)).toBe(true);
  });

  test('winding direction does not matter', () => {
    expect(ringSelfIntersects([...BOW_TIE].reverse())).toBe(true);
  });

  test('adjacent segments sharing a vertex are not a crossing', () => {
    // Every ring has these; a triangle is nothing but them.
    expect(
      ringSelfIntersects([
        [0, 0],
        [2, 0],
        [1, 2],
        [0, 0],
      ]),
    ).toBe(false);
  });

  test('the closing segment meeting the first at the start point is not a crossing', () => {
    // First and last segments share the ring's start/end vertex by
    // construction — a naive all-pairs test flags every closed ring.
    expect(ringSelfIntersects(SQUARE)).toBe(false);
  });

  test('a vertex merely touching another segment is not flagged', () => {
    // Only proper (transversal) crossings warn: GPS wobble producing a
    // touch is not the surveyor walking a figure-eight.
    expect(
      ringSelfIntersects([
        [0, 0],
        [4, 0],
        [2, 0],
        [2, 3],
        [0, 3],
        [0, 0],
      ]),
    ).toBe(false);
  });

  test('degenerate rings cannot intersect', () => {
    expect(ringSelfIntersects(null)).toBe(false);
    expect(
      ringSelfIntersects([
        [0, 0],
        [1, 1],
        [0, 0],
      ]),
    ).toBe(false);
  });
});
