import { describe, expect, test, vi } from 'vitest';
import { readOfflineStatus, subscribeOfflineStatus } from './offlineStatus.js';

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

describe('subscribeOfflineStatus', () => {
  // Fake timer plumbing: capture the callback instead of using a real clock,
  // so "the settle timeout fired" is a deliberate test action, not a race.
  function fakeTimers() {
    let captured;
    let clearedId;
    return {
      setTimeoutFn: (fn) => {
        captured = fn;
        return 'the-timeout-id';
      },
      clearTimeoutFn: (id) => {
        clearedId = id;
      },
      fire: () => captured?.(),
      wasCleared: () => clearedId === 'the-timeout-id',
    };
  }

  // subscribeOfflineStatus's emit() chains several `await`s inside
  // readOfflineStatus (getRegistration, cacheStorage.keys, cache.open,
  // cache.keys) — more microtask hops than a fixed number of
  // `await Promise.resolve()` reliably drains. A real (0ms) macrotask flush
  // lets every pending microtask run first, regardless of how deep the
  // chain is.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function fakeServiceWorker({ ready } = {}) {
    const listeners = new Set();
    return {
      controller: {},
      getRegistration: async () => ({}),
      ready: ready ?? new Promise(() => {}), // never resolves unless given
      addEventListener: (type, handler) => {
        if (type === 'controllerchange') listeners.add(handler);
      },
      removeEventListener: (type, handler) => {
        if (type === 'controllerchange') listeners.delete(handler);
      },
      fireControllerChange: () => listeners.forEach((handler) => handler()),
    };
  }

  test('emits once serviceWorker.ready resolves, not before', async () => {
    let resolveReady;
    const ready = new Promise((resolve) => {
      resolveReady = resolve;
    });
    const serviceWorker = fakeServiceWorker({ ready });
    const timers = fakeTimers();
    const onChange = vi.fn();

    subscribeOfflineStatus(
      {
        serviceWorker,
        cacheStorage: fakeCacheStorage({ 'workbox-precache-v2-scope': ['/one'] }),
        isSecureContext: true,
        standalone: true,
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
      },
      onChange,
    );

    await flush();
    expect(onChange).not.toHaveBeenCalled();

    resolveReady();
    await flush();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].offlineReady).toBe(true);
  });

  test('re-emits on controllerchange, e.g. after tapping Reload for an update', async () => {
    const serviceWorker = fakeServiceWorker({ ready: Promise.resolve() });
    const timers = fakeTimers();
    const onChange = vi.fn();

    subscribeOfflineStatus(
      {
        serviceWorker,
        cacheStorage: fakeCacheStorage({}),
        isSecureContext: true,
        standalone: true,
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
      },
      onChange,
    );

    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);

    serviceWorker.fireControllerChange();
    await flush();

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  test('emits immediately when there is no serviceWorker at all (unsupported or non-secure context)', async () => {
    const timers = fakeTimers();
    const onChange = vi.fn();

    subscribeOfflineStatus(
      {
        serviceWorker: undefined,
        cacheStorage: undefined,
        isSecureContext: false,
        standalone: false,
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
      },
      onChange,
    );

    await flush();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].offlineReady).toBe(false);
  });

  test('emits via the settle-timeout backstop if the registration never settles', async () => {
    const serviceWorker = fakeServiceWorker(); // ready never resolves
    const timers = fakeTimers();
    const onChange = vi.fn();

    subscribeOfflineStatus(
      {
        serviceWorker,
        cacheStorage: fakeCacheStorage({}),
        isSecureContext: true,
        standalone: true,
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
      },
      onChange,
    );

    await flush();
    expect(onChange).not.toHaveBeenCalled();

    timers.fire();
    await flush();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('a cacheStorage that rejects (WebKit privacy modes) yields a safe status, not an unhandled rejection', async () => {
    // main.js maps unhandledrejection onto the fatal-error banner, so a
    // failing diagnostic read must never escape — it would paint a red
    // error over a perfectly working capture UI.
    const serviceWorker = fakeServiceWorker({ ready: Promise.resolve() });
    const cacheStorage = {
      keys: () => Promise.reject(new Error('SecurityError: cache access denied')),
    };
    const timers = fakeTimers();
    const onChange = vi.fn();

    subscribeOfflineStatus(
      {
        serviceWorker,
        cacheStorage,
        isSecureContext: true,
        standalone: true,
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
      },
      onChange,
    );

    await flush();

    expect(onChange).toHaveBeenCalledTimes(1);
    const status = onChange.mock.calls[0][0];
    expect(status.offlineReady).toBe(false);
    // Unknown must not be reported as zero: CapturePage's warning banner
    // triggers on precachedCount === 0, and a privacy-mode read failure on
    // a healthy install would otherwise show a permanent false warning.
    expect(status.precachedCount).toBeNull();
  });

  test('an older in-flight emit resolving after a newer one is discarded, not delivered last', async () => {
    const serviceWorker = fakeServiceWorker({ ready: Promise.resolve() });
    const pendingKeys = [];
    // Each emit's readOfflineStatus blocks on cacheStorage.keys(); resolving
    // them out of order simulates the ready/controllerchange race.
    const cacheStorage = {
      keys: () => new Promise((resolve) => pendingKeys.push(resolve)),
      open: async () => ({ keys: async () => [{ url: '/one' }] }),
    };
    const timers = fakeTimers();
    const onChange = vi.fn();

    subscribeOfflineStatus(
      {
        serviceWorker,
        cacheStorage,
        isSecureContext: true,
        standalone: true,
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
      },
      onChange,
    );

    await flush();
    serviceWorker.fireControllerChange();
    await flush();
    expect(pendingKeys).toHaveLength(2);

    // Newer emit (controllerchange) resolves first, with a real precache.
    pendingKeys[1](['workbox-precache-v2-scope']);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].precachedCount).toBe(1);

    // Older emit (ready) resolves last, seeing no precache — stale, dropped.
    pendingKeys[0]([]);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('unsubscribe stops further emissions and clears the backstop timeout', async () => {
    const serviceWorker = fakeServiceWorker({ ready: Promise.resolve() });
    const timers = fakeTimers();
    const onChange = vi.fn();

    const unsubscribe = subscribeOfflineStatus(
      {
        serviceWorker,
        cacheStorage: fakeCacheStorage({}),
        isSecureContext: true,
        standalone: true,
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
      },
      onChange,
    );

    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(timers.wasCleared()).toBe(true);

    serviceWorker.fireControllerChange();
    timers.fire();
    await flush();

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
