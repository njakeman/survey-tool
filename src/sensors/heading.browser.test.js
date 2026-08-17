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
//
// The engine discriminator is navigator.userAgent, not `'chrome' in window`:
// window.chrome is a legacy Chrome-branding object whose presence is not
// guaranteed by spec, and it is one of the classic headless-Chromium
// detection signals precisely because it can genuinely be absent in
// automated/headless contexts — confirmed the hard way when this file
// passed locally (Windows, headed-by-default local run) but failed in CI
// (Linux headless): `chrome in window` was false there even though
// `ondeviceorientationabsolute in window` was correctly true.
// navigator.userAgent's "Chrome/" token is a core identification field
// Chromium sets consistently regardless of platform or headless mode.
function isChromiumEngine() {
  return navigator.userAgent.includes('Chrome');
}

describe('headingEventTypes — real window', () => {
  test('Chromium exposes ondeviceorientationabsolute; WebKit does not', () => {
    expect('ondeviceorientationabsolute' in window).toBe(isChromiumEngine());
  });

  test('subscribes to both events on Chromium, one on WebKit', () => {
    expect(headingEventTypes(window)).toEqual(
      isChromiumEngine()
        ? ['deviceorientation', 'deviceorientationabsolute']
        : ['deviceorientation'],
    );
  });
});
