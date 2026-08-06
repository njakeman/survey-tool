import { describe, expect, test } from 'vitest';
import { canonicalStringify } from './canonical-json.js';

describe('canonicalStringify', () => {
  test('sorts object keys regardless of insertion order', () => {
    const a = canonicalStringify({ b: 1, a: 2 });
    const b = canonicalStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  test('sorts nested object keys, not just top-level', () => {
    const result = canonicalStringify({ z: { y: 1, x: 2 } });
    expect(result).toBe('{\n  "z": {\n    "x": 2,\n    "y": 1\n  }\n}\n');
  });

  test('preserves array element order (order is meaningful, unlike object keys)', () => {
    const result = canonicalStringify([3, 1, 2]);
    expect(result).toBe('[\n  3,\n  1,\n  2\n]\n');
  });

  test('sorts keys of objects nested inside arrays', () => {
    const a = canonicalStringify([{ b: 1, a: 2 }]);
    const b = canonicalStringify([{ a: 2, b: 1 }]);
    expect(a).toBe(b);
  });

  test('ends with exactly one trailing newline', () => {
    expect(canonicalStringify({ a: 1 })).toMatch(/[^\n]\n$/);
  });

  test('uses two-space indentation, opening the door to being read without tooling', () => {
    expect(canonicalStringify({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  test('produces byte-identical output for repeated calls on equivalent data', () => {
    const value = { note: 'hello', lat: 51.5, nested: { z: 1, a: 2 } };
    expect(canonicalStringify(value)).toBe(canonicalStringify(structuredClone(value)));
  });

  test('passes null through unchanged rather than dropping it (unlike undefined)', () => {
    expect(canonicalStringify({ a: null })).toBe('{\n  "a": null\n}\n');
  });
});
