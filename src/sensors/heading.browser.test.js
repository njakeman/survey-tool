import { describe, expect, test } from 'vitest';
import { headingEventTypes } from './heading.js';

// Real Chromium + WebKit (vitest.config.js). The node-tier test covers the
// detection logic with plain object fakes; this is the only place the
// detection's premise — which engine actually exposes
// ondeviceorientationabsolute on window — is checked rather than assumed.
// Confirmed directly against both real engines before writing this
// assertion: Chromium reports `true`, WebKit reports `false`. Playwright's
// WebKit is not Safari (CLAUDE.md), but it is the closest automated proxy
// available for "does this engine have the property at all", which is what
// the `in` check depends on.
describe('headingEventTypes — real window', () => {
  test('Chromium exposes ondeviceorientationabsolute; WebKit does not', () => {
    const isChromium = 'chrome' in window;
    expect('ondeviceorientationabsolute' in window).toBe(isChromium);
  });

  test('subscribes to both events on Chromium, one on WebKit', () => {
    const isChromium = 'chrome' in window;
    expect(headingEventTypes(window)).toEqual(
      isChromium ? ['deviceorientation', 'deviceorientationabsolute'] : ['deviceorientation'],
    );
  });
});
