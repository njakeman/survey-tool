// Is this install running standalone (added to the home screen), rather
// than in a browser tab? Two signals, because no one browser answers both:
// `navigator.standalone` is iOS Safari's legacy, non-standard flag; the
// `(display-mode: standalone)` media query is the standard both engines
// answer, including Chrome on Android. Dependencies are injected, same
// pattern as `sensors/heading.js`, so this is node-testable with fakes.
//
// Lives in `app/`, not `probe/`, even though the device-probe page is a
// consumer: `offlineStatus.js` needs it too, and `probe/` is a leaf that
// already imports `app/offlineStatus.js` — importing this the other way
// round would be a directory-level cycle. `audio/recordingTypes.js` is the
// repo's existing precedent for pulling a shared value out of `probe/` for
// exactly this reason.
export function isStandalone({ standalone, matchMedia } = {}) {
  if (standalone === true) return true;
  if (typeof matchMedia === 'function') {
    return matchMedia('(display-mode: standalone)').matches;
  }
  return false;
}
