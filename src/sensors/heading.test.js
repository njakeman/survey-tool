import { describe, expect, test, vi } from 'vitest';
import {
  requestHeadingPermission,
  toHeadingReading,
  watchHeading,
  HEADING_PERMISSION,
} from './heading.js';

describe('requestHeadingPermission', () => {
  test('not-required when there is no DeviceOrientationEvent constructor', () => {
    return requestHeadingPermission(undefined).then((result) => {
      expect(result).toBe(HEADING_PERMISSION.NOT_REQUIRED);
    });
  });

  test('not-required when requestPermission is not a function (most browsers)', async () => {
    expect(await requestHeadingPermission({})).toBe(HEADING_PERMISSION.NOT_REQUIRED);
  });

  test('granted when requestPermission resolves "granted"', async () => {
    const ctor = { requestPermission: () => Promise.resolve('granted') };
    expect(await requestHeadingPermission(ctor)).toBe(HEADING_PERMISSION.GRANTED);
  });

  test('denied when requestPermission resolves "denied"', async () => {
    const ctor = { requestPermission: () => Promise.resolve('denied') };
    expect(await requestHeadingPermission(ctor)).toBe(HEADING_PERMISSION.DENIED);
  });

  test('error on an unexpected resolved value', async () => {
    const ctor = { requestPermission: () => Promise.resolve('sideways') };
    expect(await requestHeadingPermission(ctor)).toBe(HEADING_PERMISSION.ERROR);
  });

  test('error when requestPermission rejects (e.g. iOS NotAllowedError outside a gesture)', async () => {
    const ctor = { requestPermission: () => Promise.reject(new Error('NotAllowedError')) };
    expect(await requestHeadingPermission(ctor)).toBe(HEADING_PERMISSION.ERROR);
  });
});

describe('toHeadingReading', () => {
  test('prefers webkitCompassHeading over alpha when both are present', () => {
    const reading = toHeadingReading({
      webkitCompassHeading: 90,
      webkitCompassAccuracy: 5,
      absolute: true,
      alpha: 45,
    });
    expect(reading).toEqual({ headingDeg: 90, headingAccuracyDeg: 5, source: 'webkit-compass' });
  });

  test('maps webkitCompassAccuracy of -1 (uncalibrated) to null, not -1', () => {
    const reading = toHeadingReading({ webkitCompassHeading: 90, webkitCompassAccuracy: -1 });
    expect(reading.headingAccuracyDeg).toBeNull();
  });

  test('falls back to 360 - alpha when absolute and alpha are usable', () => {
    const reading = toHeadingReading({ absolute: true, alpha: 90 });
    expect(reading).toEqual({
      headingDeg: 270,
      headingAccuracyDeg: null,
      source: 'absolute-alpha',
    });
  });

  test('returns null when absolute is false, even with an alpha value', () => {
    expect(toHeadingReading({ absolute: false, alpha: 90 })).toBeNull();
  });

  test('returns null when no usable field is present', () => {
    expect(toHeadingReading({})).toBeNull();
  });

  test('normalises a negative heading into 0-360', () => {
    expect(toHeadingReading({ webkitCompassHeading: -10 }).headingDeg).toBe(350);
  });

  test('normalises a heading above 360 into 0-360', () => {
    expect(toHeadingReading({ webkitCompassHeading: 370 }).headingDeg).toBe(10);
  });
});

function createFakeTarget() {
  const listeners = {};
  return {
    addEventListener: vi.fn((type, handler) => {
      listeners[type] = handler;
    }),
    removeEventListener: vi.fn((type, handler) => {
      if (listeners[type] === handler) delete listeners[type];
    }),
    dispatch(type, event) {
      listeners[type]?.(event);
    },
    hasListener(type) {
      return Boolean(listeners[type]);
    },
  };
}

function createFakeScheduler() {
  let scheduled = null;
  const setTimeoutFn = vi.fn((fn) => {
    scheduled = fn;
    return 'timer-1';
  });
  const clearTimeoutFn = vi.fn((id) => {
    if (id === 'timer-1') scheduled = null;
  });
  return {
    setTimeoutFn,
    clearTimeoutFn,
    fire() {
      const fn = scheduled;
      scheduled = null;
      fn?.();
    },
    isScheduled: () => scheduled !== null,
  };
}

describe('watchHeading', () => {
  test('reports unsupported and returns a no-op stop when there is no event target', () => {
    const onUnavailable = vi.fn();
    const stop = watchHeading(undefined, { onUnavailable });

    expect(onUnavailable).toHaveBeenCalledWith({ reason: 'unsupported' });
    expect(() => stop()).not.toThrow();
  });

  test('delivers a usable reading to onReading', () => {
    const target = createFakeTarget();
    const onReading = vi.fn();
    const scheduler = createFakeScheduler();

    watchHeading(target, {
      onReading,
      setTimeoutFn: scheduler.setTimeoutFn,
      clearTimeoutFn: scheduler.clearTimeoutFn,
    });
    target.dispatch('deviceorientation', { webkitCompassHeading: 90, webkitCompassAccuracy: 5 });

    expect(onReading).toHaveBeenCalledWith({
      headingDeg: 90,
      headingAccuracyDeg: 5,
      source: 'webkit-compass',
    });
  });

  test('throttles: two readings within minIntervalMs deliver only the first, a third past the interval delivers', () => {
    const target = createFakeTarget();
    const onReading = vi.fn();
    const scheduler = createFakeScheduler();
    let currentTime = 0;

    watchHeading(target, {
      onReading,
      minIntervalMs: 200,
      now: () => currentTime,
      setTimeoutFn: scheduler.setTimeoutFn,
      clearTimeoutFn: scheduler.clearTimeoutFn,
    });

    currentTime = 0;
    target.dispatch('deviceorientation', { webkitCompassHeading: 10 });
    currentTime = 50;
    target.dispatch('deviceorientation', { webkitCompassHeading: 20 });
    currentTime = 250;
    target.dispatch('deviceorientation', { webkitCompassHeading: 30 });

    expect(onReading).toHaveBeenCalledTimes(2);
    expect(onReading.mock.calls[0][0].headingDeg).toBe(10);
    expect(onReading.mock.calls[1][0].headingDeg).toBe(30);
  });

  test('calls onUnavailable with reason no-heading if the timeout fires with no usable reading', () => {
    const target = createFakeTarget();
    const onUnavailable = vi.fn();
    const scheduler = createFakeScheduler();

    watchHeading(target, {
      onUnavailable,
      setTimeoutFn: scheduler.setTimeoutFn,
      clearTimeoutFn: scheduler.clearTimeoutFn,
    });
    scheduler.fire();

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith({ reason: 'no-heading' });
    expect(target.hasListener('deviceorientation')).toBe(false);
  });

  test('events that all map to null still time out to unavailable (permission granted, no magnetometer)', () => {
    const target = createFakeTarget();
    const onReading = vi.fn();
    const onUnavailable = vi.fn();
    const scheduler = createFakeScheduler();

    watchHeading(target, {
      onReading,
      onUnavailable,
      setTimeoutFn: scheduler.setTimeoutFn,
      clearTimeoutFn: scheduler.clearTimeoutFn,
    });
    target.dispatch('deviceorientation', {}); // maps to null — must not cancel the timer
    scheduler.fire();

    expect(onReading).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith({ reason: 'no-heading' });
  });

  test('a usable reading before the timeout clears the timer — no onUnavailable', () => {
    const target = createFakeTarget();
    const onUnavailable = vi.fn();
    const scheduler = createFakeScheduler();

    watchHeading(target, {
      onUnavailable,
      setTimeoutFn: scheduler.setTimeoutFn,
      clearTimeoutFn: scheduler.clearTimeoutFn,
    });
    target.dispatch('deviceorientation', { webkitCompassHeading: 10 });

    expect(scheduler.isScheduled()).toBe(false);
    scheduler.fire(); // no-op: nothing scheduled
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  test('stop() removes the listener, clears the timer, and suppresses a later event', () => {
    const target = createFakeTarget();
    const onReading = vi.fn();
    const scheduler = createFakeScheduler();

    const stop = watchHeading(target, {
      onReading,
      setTimeoutFn: scheduler.setTimeoutFn,
      clearTimeoutFn: scheduler.clearTimeoutFn,
    });
    stop();

    expect(target.hasListener('deviceorientation')).toBe(false);
    expect(scheduler.isScheduled()).toBe(false);

    target.dispatch('deviceorientation', { webkitCompassHeading: 10 });
    expect(onReading).not.toHaveBeenCalled();
  });
});
