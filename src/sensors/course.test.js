import { describe, expect, test } from 'vitest';
import { courseFromFixes } from './course.js';
import { distanceM } from '../geo/distance.js';

const DEGREE_M = distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });

// A fix `metres` north of the origin — the trace fixtures' idiom.
function fix(metres, accuracyM = 5) {
  return { lat: metres / DEGREE_M, lon: 0, accuracyM };
}

describe('courseFromFixes', () => {
  test('two fixes a clear walk apart yield the bearing between them', () => {
    expect(courseFromFixes(fix(0), fix(20))).toBeCloseTo(0, 3);
  });

  test('walking east reads 090', () => {
    const east = { lat: 0, lon: 20 / DEGREE_M, accuracyM: 5 };
    expect(courseFromFixes(fix(0), east)).toBeCloseTo(90, 1);
  });

  test('movement below the noise floor is not a course', () => {
    // The trace recorder's own rule: motion smaller than max(5 m, the fix's
    // own error bar) is noise, and a jittering arrow is worse than none.
    expect(courseFromFixes(fix(0), fix(3))).toBeNull();
    expect(courseFromFixes(fix(0), fix(10, 15))).toBeNull();
    expect(courseFromFixes(fix(0), fix(16, 15))).toBeCloseTo(0, 3);
  });

  test('null-safe on either side', () => {
    expect(courseFromFixes(null, fix(20))).toBeNull();
    expect(courseFromFixes(fix(0), null)).toBeNull();
    expect(courseFromFixes(null, null)).toBeNull();
  });
});
