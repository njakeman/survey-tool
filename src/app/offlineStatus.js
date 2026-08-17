// Answers, on the actual device, whether *this specific install* can serve
// the app offline — the question the "airplane mode doesn't work" reports
// kept turning out to be about the dev server rather than a real bug. There
// is no console on an installed iOS PWA, so this has to be readable in the
// UI itself rather than inferred from a passing test on a laptop.
//
// Every browser dependency is a parameter, never read from module scope —
// same pattern as `app/standalone.js` and `sensors/position.js` — so this
// stays node-testable with fakes; `.browser.test.js` covers it against the
// real Cache Storage API separately.

import { isStandalone } from './standalone.js';

// Workbox's precache cache name is `${prefix}-${precache}-${suffix}`, with
// `precache` fixed at `precache-v2` (see workbox-core's `cacheNames`). We
// only need the fixed middle segment to recognise a precache cache — the
// prefix/suffix vary with scope and aren't worth threading through.
const PRECACHE_NAME_PATTERN = /^workbox-precache-v2-/;

async function countPrecachedEntries(cacheStorage) {
  if (typeof cacheStorage?.keys !== 'function') return 0;
  const cacheNames = (await cacheStorage.keys()).filter((name) => PRECACHE_NAME_PATTERN.test(name));
  const counts = await Promise.all(
    cacheNames.map(async (name) => {
      const cache = await cacheStorage.open(name);
      return (await cache.keys()).length;
    }),
  );
  return counts.reduce((total, count) => total + count, 0);
}

export async function readOfflineStatus({
  serviceWorker,
  cacheStorage,
  isSecureContext,
  standalone,
  matchMedia,
} = {}) {
  const registration =
    typeof serviceWorker?.getRegistration === 'function'
      ? await serviceWorker.getRegistration()
      : undefined;
  const registered = Boolean(registration);
  const controlled = Boolean(serviceWorker?.controller);
  const precachedCount = await countPrecachedEntries(cacheStorage);

  return {
    secureContext: Boolean(isSecureContext),
    standalone: isStandalone({ standalone, matchMedia }),
    registered,
    controlled,
    precachedCount,
    // The dev server's SW registers and controls the page but precaches
    // nothing (`self.__WB_MANIFEST` is hardcoded to `[]` there) — this is
    // exactly the case "offline-ready" must say no to.
    offlineReady: controlled && precachedCount > 0,
  };
}

// A single `readOfflineStatus()` call made at startup (as main.js used to)
// samples the registration mid-flight: right after registerSW() fires, the
// worker is still installing/precaching, so `precachedCount` is genuinely 0
// for an instant on *every* load — not just a dev build. That produced a
// false "No offline cache" flash on a perfectly good production build. This
// reports settled state instead: once after the registration is actually
// ready, again whenever control changes (e.g. after the user taps Reload
// for an update — see App.js), and once more via a timeout backstop so a
// hung registration still reports something rather than leaving the UI
// silently blank forever. Browser globals stay injected, same as
// `readOfflineStatus` above, so this is node-testable with fakes.
export function subscribeOfflineStatus(
  {
    serviceWorker,
    cacheStorage,
    isSecureContext,
    standalone,
    matchMedia,
    settleTimeoutMs = 5000,
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout,
  } = {},
  onChange,
) {
  let stopped = false;
  let latestSeq = 0;

  const emit = () => {
    if (stopped) return;
    // ready, controllerchange and the backstop can all be in flight at
    // once; without the sequence guard an older read resolving last would
    // overwrite a newer status — with precachedCount, exactly the false
    // "No offline cache" banner this module exists to eliminate.
    const seq = ++latestSeq;
    readOfflineStatus({ serviceWorker, cacheStorage, isSecureContext, standalone, matchMedia })
      .then((status) => {
        if (!stopped && seq === latestSeq) onChange(status);
      })
      .catch(() => {
        // A failed diagnostic read (e.g. WebKit privacy modes rejecting
        // cache access) must never escape: main.js maps unhandledrejection
        // onto the fatal-error banner. precachedCount is null, not 0 —
        // unknown must not trip CapturePage's `=== 0` warning banner.
        // standalone is still resolved through isStandalone (not a bare
        // Boolean(standalone)), or this fallback would report a different
        // answer from the success path on Android — exactly the moment a
        // diagnostic must not lie.
        if (!stopped && seq === latestSeq) {
          onChange({
            secureContext: Boolean(isSecureContext),
            standalone: isStandalone({ standalone, matchMedia }),
            registered: false,
            controlled: false,
            precachedCount: null,
            offlineReady: false,
          });
        }
      });
  };

  if (!serviceWorker) {
    // No service worker API at all (unsupported browser, or a non-secure
    // context where it's undefined) — nothing will ever settle; report now.
    emit();
    return () => {
      stopped = true;
    };
  }

  serviceWorker.addEventListener?.('controllerchange', emit);

  if (serviceWorker.ready?.then) {
    serviceWorker.ready.then(emit);
  }

  const timeoutId = setTimeoutFn(emit, settleTimeoutMs);

  return () => {
    stopped = true;
    serviceWorker.removeEventListener?.('controllerchange', emit);
    clearTimeoutFn(timeoutId);
  };
}
