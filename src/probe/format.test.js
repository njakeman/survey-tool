import { describe, expect, test } from 'vitest';
import { formatBytes, formatDuration } from './format.js';

describe('formatBytes', () => {
  test('formats bytes under 1024 as bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  test('formats kilobytes to one decimal place', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  test('formats megabytes to one decimal place', () => {
    expect(formatBytes(12_300_000)).toBe('11.7 MB');
  });

  test('formats gigabytes to one decimal place', () => {
    expect(formatBytes(61_200_000_000)).toBe('57.0 GB');
  });

  test('formats zero as 0 B', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  test('formats an unknown (undefined) size as a dash', () => {
    expect(formatBytes(undefined)).toBe('—');
  });
});

describe('formatDuration', () => {
  test('formats sub-second durations in milliseconds', () => {
    expect(formatDuration(842)).toBe('842 ms');
  });

  test('formats durations of a second or more in seconds to two decimal places', () => {
    expect(formatDuration(1834)).toBe('1.83 s');
  });
});
