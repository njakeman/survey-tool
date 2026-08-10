import { describe, expect, test } from 'vitest';
import { readOfflineStatus } from './offlineStatus.js';

function fakeCacheStorage(cacheEntries) {
  // cacheEntries: { [cacheName]: string[] of urls }
  return {
    keys: async () => Object.keys(cacheEntries),
    open: async (name) => ({
      keys: async () => (cacheEntries[name] ?? []).map((url) => ({ url })),
    }),
  };
}

describe('readOfflineStatus', () => {
  test('a build with nothing precached is not offline-ready, even if a service worker controls the page', async () => {
    // This is exactly the dev-server shim: registered, controlling, but
    // precacheAndRoute([]) means the precache caches are empty or absent.
    const status = await readOfflineStatus({
      serviceWorker: { controller: {}, getRegistration: async () => ({}) },
      cacheStorage: fakeCacheStorage({}),
      isSecureContext: true,
      standalone: true,
    });

    expect(status.controlled).toBe(true);
    expect(status.precachedCount).toBe(0);
    expect(status.offlineReady).toBe(false);
  });

  test('a production build with real precache entries and a controlling worker is offline-ready', async () => {
    const status = await readOfflineStatus({
      serviceWorker: { controller: {}, getRegistration: async () => ({}) },
      cacheStorage: fakeCacheStorage({
        'workbox-precache-v2-https://example.test/survey-tool/': [
          '/survey-tool/index.html',
          '/survey-tool/assets/index.js',
        ],
      }),
      isSecureContext: true,
      standalone: true,
    });

    expect(status.registered).toBe(true);
    expect(status.precachedCount).toBe(2);
    expect(status.offlineReady).toBe(true);
  });

  test('sums entries across multiple precache caches (e.g. across a version update)', async () => {
    const status = await readOfflineStatus({
      serviceWorker: { controller: {}, getRegistration: async () => ({}) },
      cacheStorage: fakeCacheStorage({
        'workbox-precache-v2-scope-a': ['/one'],
        'workbox-precache-v2-scope-b': ['/two', '/three'],
      }),
      isSecureContext: true,
      standalone: true,
    });

    expect(status.precachedCount).toBe(3);
  });

  test('ignores non-precache caches when counting', async () => {
    const status = await readOfflineStatus({
      serviceWorker: { controller: {}, getRegistration: async () => ({}) },
      cacheStorage: fakeCacheStorage({
        'workbox-precache-v2-scope': ['/one'],
        'some-runtime-cache': ['/two', '/three', '/four'],
      }),
      isSecureContext: true,
      standalone: true,
    });

    expect(status.precachedCount).toBe(1);
  });

  test('not controlled when there is no active controller, regardless of precache contents', async () => {
    const status = await readOfflineStatus({
      serviceWorker: { controller: null, getRegistration: async () => undefined },
      cacheStorage: fakeCacheStorage({ 'workbox-precache-v2-scope': ['/one'] }),
      isSecureContext: true,
      standalone: false,
    });

    expect(status.registered).toBe(false);
    expect(status.controlled).toBe(false);
    expect(status.offlineReady).toBe(false);
  });

  test('reports a non-secure context rather than throwing (service workers are unavailable there)', async () => {
    const status = await readOfflineStatus({
      serviceWorker: undefined,
      cacheStorage: undefined,
      isSecureContext: false,
      standalone: false,
    });

    expect(status.secureContext).toBe(false);
    expect(status.registered).toBe(false);
    expect(status.controlled).toBe(false);
    expect(status.precachedCount).toBe(0);
    expect(status.offlineReady).toBe(false);
  });
});
