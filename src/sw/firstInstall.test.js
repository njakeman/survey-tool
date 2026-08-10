import { describe, expect, test } from 'vitest';
import {
  SW_META_CACHE_NAME,
  hasCompletedFirstInstall,
  markFirstInstallComplete,
} from './firstInstall.js';

// A Map-of-Maps stand-in for CacheStorage: persistent across "worker
// restarts" (which reset module scope but not storage) — the property the
// real fix depends on. Honest-TDD caveat: the volatile-flag bug itself only
// reproduces in a real SW lifecycle, which this repo deliberately doesn't
// harness ("SW logic is best tested as plain functions elsewhere" — sw.js);
// these tests pin the persistent-marker semantics instead, and
// e2e/install.spec.js keeps guarding the user-visible 404 failure mode.
function fakeCacheStorage() {
  const caches = new Map();
  return {
    async open(name) {
      if (!caches.has(name)) caches.set(name, new Map());
      const cache = caches.get(name);
      return {
        async match(url) {
          return cache.get(url);
        },
        async put(url, response) {
          cache.set(url, response);
        },
      };
    },
  };
}

describe('first-install marker', () => {
  test('reports no completed install on fresh storage', async () => {
    expect(await hasCompletedFirstInstall(fakeCacheStorage())).toBe(false);
  });

  test('the marker persists across a worker restart — same storage, fresh module state', async () => {
    const cacheStorage = fakeCacheStorage();
    await markFirstInstallComplete(cacheStorage);

    // A terminated-and-restarted worker re-evaluates module scope but keeps
    // Cache Storage: only the argument carries state between these calls.
    expect(await hasCompletedFirstInstall(cacheStorage)).toBe(true);
  });

  test('marking twice is idempotent', async () => {
    const cacheStorage = fakeCacheStorage();
    await markFirstInstallComplete(cacheStorage);
    await markFirstInstallComplete(cacheStorage);
    expect(await hasCompletedFirstInstall(cacheStorage)).toBe(true);
  });

  test('the meta cache is not a workbox precache cache', () => {
    // offlineStatus.js counts caches matching workbox-precache-v2-* to
    // decide offline readiness, and cleanupOutdatedCaches() prunes them —
    // the marker must live outside both.
    expect(SW_META_CACHE_NAME).not.toMatch(/^workbox-precache-v2-/);
  });
});
