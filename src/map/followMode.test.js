import { describe, expect, test } from 'vitest';
import { createFollowState, onFix, onUserPan, onRecentre, showsRecentre } from './followMode.js';

const FIX_A = { lat: 51.5, lon: -0.14, accuracyM: 8 };
const FIX_B = { lat: 51.6, lon: -0.15, accuracyM: 6 };

describe('follow mode', () => {
  test('starts following, so the first fix centres the map', () => {
    const state = createFollowState();

    const { centreOn } = onFix(state, FIX_A);

    expect(state.following).toBe(true);
    expect(centreOn).toEqual(FIX_A);
  });

  test('no re-centre affordance while following', () => {
    expect(showsRecentre(createFollowState())).toBe(false);
  });

  test('a user pan stops following and offers re-centre', () => {
    const panned = onUserPan(onFix(createFollowState(), FIX_A).state);

    expect(panned.following).toBe(false);
    expect(showsRecentre(panned)).toBe(true);
  });

  test('fixes arriving after a pan do not yank the map back', () => {
    const panned = onUserPan(onFix(createFollowState(), FIX_A).state);

    const { centreOn } = onFix(panned, FIX_B);

    expect(centreOn).toBeNull();
  });

  test('re-centre resumes following at the LATEST fix, not the one from before the pan', () => {
    const panned = onUserPan(onFix(createFollowState(), FIX_A).state);
    const withNewerFix = onFix(panned, FIX_B).state;

    const { state, centreOn } = onRecentre(withNewerFix);

    expect(centreOn).toEqual(FIX_B);
    expect(state.following).toBe(true);
    expect(showsRecentre(state)).toBe(false);
  });

  test('offers no re-centre before any fix has arrived — there is nowhere to go', () => {
    const pannedBeforeFix = onUserPan(createFollowState());

    expect(showsRecentre(pannedBeforeFix)).toBe(false);
    expect(onRecentre(pannedBeforeFix).centreOn).toBeNull();
  });

  test('panning again while already stopped changes nothing', () => {
    const once = onUserPan(onFix(createFollowState(), FIX_A).state);
    const twice = onUserPan(once);

    expect(twice).toEqual(once);
  });
});
