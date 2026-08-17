import { describe, expect, test } from 'vitest';
import { isStandalone } from './standalone.js';

describe('isStandalone', () => {
  test('true when navigator.standalone is true (iOS Safari legacy flag)', () => {
    expect(isStandalone({ standalone: true, matchMedia: undefined })).toBe(true);
  });

  test('true when the display-mode: standalone media query matches', () => {
    const matchMedia = (query) => ({ matches: query === '(display-mode: standalone)' });
    expect(isStandalone({ standalone: false, matchMedia })).toBe(true);
  });

  test('false when neither signal indicates standalone', () => {
    const matchMedia = () => ({ matches: false });
    expect(isStandalone({ standalone: false, matchMedia })).toBe(false);
  });

  test('false when matchMedia is unavailable and standalone flag is absent', () => {
    expect(isStandalone({})).toBe(false);
  });
});
