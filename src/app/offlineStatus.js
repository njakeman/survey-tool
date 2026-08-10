// Answers, on the actual device, whether *this specific install* can serve
// the app offline — the question the "airplane mode doesn't work" reports
// kept turning out to be about the dev server rather than a real bug. There
// is no console on an installed iOS PWA, so this has to be readable in the
// UI itself rather than inferred from a passing test on a laptop.
//
// Every browser dependency is a parameter, never read from module scope —
// same pattern as `probe/capabilities.js` and `sensors/position.js` — so
// this stays node-testable with fakes; `.browser.test.js` covers it against
// the real Cache Storage API separately.

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
    standalone: Boolean(standalone),
    registered,
    controlled,
    precachedCount,
    // The dev server's SW registers and controls the page but precaches
    // nothing (`self.__WB_MANIFEST` is hardcoded to `[]` there) — this is
    // exactly the case "offline-ready" must say no to.
    offlineReady: controlled && precachedCount > 0,
  };
}
