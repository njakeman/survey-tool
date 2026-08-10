// Follow-me as a pure state machine, kept out of the map adapter so the
// behaviour that actually matters in the field — the map must not yank itself
// back under your thumb while you're looking at something — is testable
// without a renderer.
//
// Each transition returns { state, centreOn }: `centreOn` is the fix the
// caller should recentre on, or null for "leave the viewport alone".

export function createFollowState() {
  return { following: true, lastFix: null };
}

export function onFix(state, fix) {
  const next = { ...state, lastFix: fix };
  return { state: next, centreOn: next.following ? fix : null };
}

export function onUserPan(state) {
  if (!state.following) return state;
  return { ...state, following: false };
}

export function onRecentre(state) {
  // Resumes at the newest fix, not the one from before the pan — fixes kept
  // arriving while the surveyor was looking elsewhere.
  return { state: { ...state, following: true }, centreOn: state.lastFix ?? null };
}

export function showsRecentre(state) {
  return !state.following && state.lastFix !== null;
}
