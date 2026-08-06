import { describe, expect, test } from 'vitest';
import { isStandalone, canRequestOrientationPermission, canShareFiles } from './capabilities.js';

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

describe('canRequestOrientationPermission', () => {
  test('true when DeviceOrientationEvent.requestPermission is a function', () => {
    const ctor = { requestPermission: () => Promise.resolve('granted') };
    expect(canRequestOrientationPermission(ctor)).toBe(true);
  });

  test('false when DeviceOrientationEvent has no requestPermission (most browsers)', () => {
    expect(canRequestOrientationPermission({})).toBe(false);
  });

  test('false when DeviceOrientationEvent is undefined (unsupported browser)', () => {
    expect(canRequestOrientationPermission(undefined)).toBe(false);
  });
});

describe('canShareFiles', () => {
  test('true when navigator.canShare reports the files are shareable', () => {
    const navigatorLike = { canShare: () => true };
    expect(canShareFiles(navigatorLike, [])).toBe(true);
  });

  test('false when navigator.canShare reports the files are not shareable', () => {
    const navigatorLike = { canShare: () => false };
    expect(canShareFiles(navigatorLike, [])).toBe(false);
  });

  test('false when navigator has no canShare (Web Share API unsupported)', () => {
    expect(canShareFiles({}, [])).toBe(false);
  });
});
