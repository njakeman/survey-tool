// Web Share API as the primary export route, Blob download only as a
// fallback — not the reverse (CLAUDE.md, non-negotiable). An installed iOS
// PWA traps the user in a preview sheet with no way back on `<a download>`
// (confirmed in the Phase 1 device probe); Web Share doesn't have that
// failure mode. Browser-only, same DI pattern as sensors/heading.js — real
// DOM (createAnchor/createObjectURL) is exercised for real in the browser
// tier, only navigator.share/canShare need faking since headless
// automation can't trigger a native share sheet regardless.
//
// The fallback fires on ANY share failure that isn't a user cancellation —
// not just when Share is unsupported. Desktop Chrome rejects share() with
// NotAllowedError ("Permission denied") once the triggering tap's transient
// user activation has expired, which a session's zip build (IndexedDB reads
// + compression, all before this function is ever called) can realistically
// outlast. A fallback exists precisely to catch the primary path failing
// for any reason, not one enumerated error — the alternative is dead-ending
// an export the surveyor is entitled to get out of the device.

const DOWNLOAD_REVOKE_DELAY_MS = 10_000;

export async function shareOrDownload(
  file,
  {
    title,
    navigatorLike = navigator,
    createAnchor = () => document.createElement('a'),
    createObjectURL = (blob) => URL.createObjectURL(blob),
    revokeObjectURL = (url) => URL.revokeObjectURL(url),
    setTimeoutFn = setTimeout,
    revokeDelayMs = DOWNLOAD_REVOKE_DELAY_MS,
  } = {},
) {
  if (typeof navigatorLike.canShare === 'function' && navigatorLike.canShare({ files: [file] })) {
    try {
      await navigatorLike.share({ files: [file], title });
      return { method: 'share' };
    } catch (error) {
      if (error.name === 'AbortError') {
        return { method: 'share', cancelled: true }; // user dismissed the sheet — not a failure
      }
      // Any other failure (e.g. Chrome's NotAllowedError on expired
      // activation) falls through to the download fallback below, rather
      // than rethrowing — see the header comment.
    }
  }

  const url = createObjectURL(file);
  const anchor = createAnchor();
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  // Delayed revoke: some browsers haven't finished reading the blob by the
  // time click() returns.
  setTimeoutFn(() => revokeObjectURL(url), revokeDelayMs);
  return { method: 'download' };
}
