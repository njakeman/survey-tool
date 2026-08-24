import { describe, expect, test, vi } from 'vitest';
import { createWakeLockHolder } from './wakeLock.js';

// Fakes in the style of the other sensor adapters: the holder never touches
// a global — navigator.wakeLock and document are injected by main.js.

function fakeSentinel() {
  return { release: vi.fn().mockResolvedValue(undefined) };
}

function fakeDocument(visibilityState = 'visible') {
  const listeners = new Set();
  return {
    visibilityState,
    addEventListener: vi.fn((type, fn) => {
      if (type === 'visibilitychange') listeners.add(fn);
    }),
    removeEventListener: vi.fn((type, fn) => {
      if (type === 'visibilitychange') listeners.delete(fn);
    }),
    fireVisibility(state) {
      this.visibilityState = state;
      for (const fn of [...listeners]) fn();
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createWakeLockHolder', () => {
  test('hold requests a screen lock; release releases the sentinel', async () => {
    const sentinel = fakeSentinel();
    const wakeLock = { request: vi.fn().mockResolvedValue(sentinel) };
    const holder = createWakeLockHolder({ wakeLock, documentRef: fakeDocument() });

    holder.hold();
    await flush();
    expect(wakeLock.request).toHaveBeenCalledWith('screen');

    holder.release();
    await flush();
    expect(sentinel.release).toHaveBeenCalled();
  });

  test('no wakeLock API means hold and release are silent no-ops', () => {
    const holder = createWakeLockHolder({ wakeLock: undefined, documentRef: fakeDocument() });

    expect(() => {
      holder.hold();
      holder.release();
    }).not.toThrow();
  });

  test('a refused request is swallowed — low battery must never surface as an error', async () => {
    const wakeLock = {
      request: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
    };
    const holder = createWakeLockHolder({ wakeLock, documentRef: fakeDocument() });

    holder.hold();
    await flush();
    // Nothing to assert beyond "no unhandled rejection": vitest fails the
    // test if one escapes.
    holder.release();
  });

  test('hidden at hold time defers the request until the page is visible again', async () => {
    const wakeLock = { request: vi.fn().mockResolvedValue(fakeSentinel()) };
    const doc = fakeDocument('hidden');
    const holder = createWakeLockHolder({ wakeLock, documentRef: doc });

    holder.hold();
    await flush();
    expect(wakeLock.request).not.toHaveBeenCalled();

    doc.fireVisibility('visible');
    await flush();
    expect(wakeLock.request).toHaveBeenCalledTimes(1);
  });

  test('re-acquires on return to the foreground — the platform released it on hide', async () => {
    const wakeLock = { request: vi.fn().mockResolvedValue(fakeSentinel()) };
    const doc = fakeDocument();
    const holder = createWakeLockHolder({ wakeLock, documentRef: doc });

    holder.hold();
    await flush();
    doc.fireVisibility('hidden');
    doc.fireVisibility('visible');
    await flush();

    expect(wakeLock.request).toHaveBeenCalledTimes(2);
  });

  test('after release, a visibility change acquires nothing', async () => {
    const wakeLock = { request: vi.fn().mockResolvedValue(fakeSentinel()) };
    const doc = fakeDocument();
    const holder = createWakeLockHolder({ wakeLock, documentRef: doc });

    holder.hold();
    await flush();
    holder.release();
    doc.fireVisibility('hidden');
    doc.fireVisibility('visible');
    await flush();

    expect(wakeLock.request).toHaveBeenCalledTimes(1);
  });

  test('a release that lands before the request settles still frees the lock', async () => {
    const sentinel = fakeSentinel();
    let resolve;
    const wakeLock = { request: vi.fn(() => new Promise((r) => (resolve = r))) };
    const holder = createWakeLockHolder({ wakeLock, documentRef: fakeDocument() });

    holder.hold();
    holder.release();
    resolve(sentinel);
    await flush();

    expect(sentinel.release).toHaveBeenCalled();
  });

  test('hold while already holding does not stack a second request', async () => {
    const wakeLock = { request: vi.fn().mockResolvedValue(fakeSentinel()) };
    const holder = createWakeLockHolder({ wakeLock, documentRef: fakeDocument() });

    holder.hold();
    holder.hold();
    await flush();

    expect(wakeLock.request).toHaveBeenCalledTimes(1);
  });
});
