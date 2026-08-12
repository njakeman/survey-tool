// A blank screen on a device with no attached debugger (no Mac for Safari
// Web Inspector, no desktop devtools) is undiagnosable. main.js wraps
// startup and installs global handlers so any uncaught error renders here
// instead of leaving #app empty — the whole point is that a future failure
// is a screenshot away from a fix, not a dead end.

export function formatError(errorLike) {
  if (errorLike instanceof Error) {
    return `${errorLike.name}: ${errorLike.message}\n${errorLike.stack ?? ''}`.trim();
  }
  if (errorLike && typeof errorLike === 'object' && 'message' in errorLike) {
    // Falsy parts are dropped, not just undefined ones: line/column are
    // 1-based, so an empty filename with 0:0 is no location at all — the
    // old undefined-only filter joined '' and 0 into a truthy ':0:0' and
    // the banner read "(:0:0)".
    const location = [errorLike.filename, errorLike.lineno, errorLike.colno]
      .filter(Boolean)
      .join(':');
    return location ? `${errorLike.message} (${location})` : String(errorLike.message);
  }
  return String(errorLike);
}

// The sanitized payload browsers dispatch for errors the page may not
// inspect (the HTML spec's muted-errors rule): no error object, no source
// file, line and column 0, message "Script error." — WebKit raises these
// from browser-internal and extension-injected script during, for example,
// the iOS share sheet. Every app script is same-origin, so an event with
// this shape cannot be app code and carries nothing actionable; the fatal
// banner must not paint over a working app for it. Detected by the shape
// (null error + no filename), not the message string, which engines vary.
export function isMutedErrorEvent(event) {
  return Boolean(event) && !event.filename && event.error == null;
}
