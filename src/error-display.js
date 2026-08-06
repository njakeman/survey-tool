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
    const location = [errorLike.filename, errorLike.lineno, errorLike.colno]
      .filter((part) => part !== undefined)
      .join(':');
    return location ? `${errorLike.message} (${location})` : String(errorLike.message);
  }
  return String(errorLike);
}
