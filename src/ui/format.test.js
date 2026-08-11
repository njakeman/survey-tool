import { describe, expect, it } from 'vitest';
import { formatSize } from './format.js';

describe('formatSize', () => {
  it('returns null for a missing or zero size, so callers can omit the part', () => {
    expect(formatSize(undefined)).toBe(null);
    expect(formatSize(null)).toBe(null);
    expect(formatSize(0)).toBe(null);
  });

  it('shows bytes below a kilobyte — a 403-byte layer is small, not empty', () => {
    expect(formatSize(403)).toBe('403 B');
  });

  it('shows kilobytes below a megabyte — a 400 kB region is not "0 MB"', () => {
    // The regression this module exists for: the region list's MB-only
    // formatter rendered exactly this value as "0 MB".
    expect(formatSize(400_000)).toBe('400 kB');
    expect(formatSize(34_000)).toBe('34 kB');
  });

  it('shows whole megabytes for archives', () => {
    expect(formatSize(24_400_000)).toBe('24 MB');
    expect(formatSize(1_200_000)).toBe('1 MB');
  });
});
