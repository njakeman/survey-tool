import { describe, expect, test } from 'vitest';
import { newId, nowIso } from './id.js';

describe('newId', () => {
  test('returns a 26-character ULID', () => {
    expect(newId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('returns a different id on each call', () => {
    expect(newId()).not.toBe(newId());
  });

  test('is lexicographically sortable by generation time', () => {
    const first = newId();
    const second = newId();
    expect(first < second).toBe(true);
  });
});

describe('nowIso', () => {
  test('returns a string Date can parse back losslessly to the same instant', () => {
    const iso = nowIso();
    expect(new Date(iso).toISOString()).toBe(iso);
  });
});
