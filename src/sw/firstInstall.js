// Persistent "a generation has completed activation" marker for sw.js's
// claim-only-on-first-install rule. It must live in Cache Storage, not
// module scope: a worker waiting behind the update prompt can sit in
// `waiting` for hours, get terminated, and be re-evaluated — resetting any
// module-scope flag and making a genuine update look like a first install
// (which would let clients.claim() prune the precache out from under a
// still-open old page — the exact 404 failure sw.js documents).
//
// The cache name deliberately doesn't match workbox-precache-v2-*: workbox's
// cleanupOutdatedCaches() prunes that namespace on activate, and
// offlineStatus.js counts it to decide offline readiness — the marker must
// be invisible to both.

export const SW_META_CACHE_NAME = 'sw-meta';

const MARKER_URL = './__first-install-complete__';

export async function hasCompletedFirstInstall(cacheStorage) {
  const cache = await cacheStorage.open(SW_META_CACHE_NAME);
  return Boolean(await cache.match(MARKER_URL));
}

export async function markFirstInstallComplete(cacheStorage) {
  const cache = await cacheStorage.open(SW_META_CACHE_NAME);
  await cache.put(MARKER_URL, new Response('1'));
}
