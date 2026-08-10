import { describe, expect, test, afterEach } from 'vitest';
import { readOfflineStatus } from './offlineStatus.js';

// Real Cache Storage, chromium + webkit (vitest.config.js). The node-tier
// test covers the counting logic with fakes; this is here specifically to
// prove that logic matches Workbox's *real* precache cache naming
// (`workbox-precache-v2-<scope>`), which a fake can't validate.
const TEST_CACHE_NAMES = [
  'workbox-precache-v2-https://example.test/survey-tool/',
  'some-runtime-cache',
];

afterEach(async () => {
  await Promise.all(TEST_CACHE_NAMES.map((name) => caches.delete(name)));
});

describe('readOfflineStatus — real Cache Storage', () => {
  test('counts entries in a real workbox precache cache', async () => {
    const cache = await caches.open('workbox-precache-v2-https://example.test/survey-tool/');
    await cache.put(new Request('https://example.test/survey-tool/index.html'), new Response('a'));
    await cache.put(
      new Request('https://example.test/survey-tool/assets/app.js'),
      new Response('b'),
    );

    const status = await readOfflineStatus({
      serviceWorker: { controller: {}, getRegistration: async () => ({}) },
      cacheStorage: caches,
      isSecureContext: true,
      standalone: false,
    });

    expect(status.precachedCount).toBe(2);
    expect(status.offlineReady).toBe(true);
  });

  test('ignores a real non-precache cache when counting', async () => {
    const cache = await caches.open('some-runtime-cache');
    await cache.put(new Request('https://example.test/tile.pbf'), new Response('tile'));

    const status = await readOfflineStatus({
      serviceWorker: { controller: {}, getRegistration: async () => ({}) },
      cacheStorage: caches,
      isSecureContext: true,
      standalone: false,
    });

    expect(status.precachedCount).toBe(0);
    expect(status.offlineReady).toBe(false);
  });
});
