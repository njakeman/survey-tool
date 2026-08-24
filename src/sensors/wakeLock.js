// Screen wake lock, held while a trace is recording: the screen auto-locking
// is the single most common way the fix stream dies mid-walk (no web API
// delivers geolocation to a backgrounded PWA, on either OS — the dotted
// inferred segments are the honest record of what that costs). Injected like
// the other sensor adapters: `wakeLock` is navigator.wakeLock (undefined on
// iOS < 16.4 — and broken inside installed iOS PWAs until 18.4, where the
// request simply rejects and is swallowed), `documentRef` is document.
//
// The platform releases the lock whenever the page hides; the holder
// re-acquires on return while the intent stands. Every rejection is
// swallowed — a wake lock is an optimisation, never a requirement, and a
// low-battery refusal (NotAllowedError) is normal operation.
export function createWakeLockHolder({ wakeLock, documentRef }) {
  let intent = false;
  let sentinel = null;

  function acquire() {
    if (!wakeLock?.request) return;
    if (documentRef.visibilityState === 'hidden') return;
    wakeLock
      .request('screen')
      .then((lock) => {
        if (!intent) {
          // Released while the request was in flight — free it immediately.
          lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
      })
      .catch(() => {});
  }

  function onVisibilityChange() {
    if (intent && documentRef.visibilityState === 'visible') acquire();
  }

  return {
    hold() {
      if (intent) return;
      intent = true;
      documentRef.addEventListener('visibilitychange', onVisibilityChange);
      acquire();
    },
    release() {
      if (!intent) return;
      intent = false;
      documentRef.removeEventListener('visibilitychange', onVisibilityChange);
      sentinel?.release().catch(() => {});
      sentinel = null;
    },
  };
}
