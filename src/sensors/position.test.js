import { describe, expect, test, vi } from 'vitest';
import { toPositionReading, toPositionError, watchPosition, POSITION_ERROR } from './position.js';

const TIMESTAMP = Date.UTC(2025, 7, 6, 8, 0, 0, 0); // month is 0-indexed: 7 = August

function fakePosition(overrides = {}) {
  return {
    coords: {
      latitude: 51.5,
      longitude: -0.14,
      accuracy: 8.2,
      altitude: null,
      altitudeAccuracy: null,
      heading: 45, // course-over-ground — must never appear in the mapped reading
      speed: 1.2, // must never appear in the mapped reading
      ...overrides.coords,
    },
    timestamp: TIMESTAMP,
    ...overrides,
  };
}

describe('toPositionReading', () => {
  test('maps coords and timestamp to a plain reading', () => {
    expect(toPositionReading(fakePosition())).toEqual({
      lat: 51.5,
      lon: -0.14,
      accuracyM: 8.2,
      altitudeM: null,
      altitudeAccuracyM: null,
      fixAt: new Date(TIMESTAMP).toISOString(),
      fixAtMs: TIMESTAMP,
    });
  });

  test('carries altitude through when present', () => {
    const reading = toPositionReading(
      fakePosition({ coords: { altitude: 45.2, altitudeAccuracy: 3 } }),
    );
    expect(reading.altitudeM).toBe(45.2);
    expect(reading.altitudeAccuracyM).toBe(3);
  });

  test('never carries coords.heading or coords.speed through', () => {
    const reading = toPositionReading(fakePosition());
    expect(reading).not.toHaveProperty('heading');
    expect(reading).not.toHaveProperty('speed');
  });
});

describe('toPositionError', () => {
  test.each([
    [1, POSITION_ERROR.PERMISSION_DENIED],
    [2, POSITION_ERROR.POSITION_UNAVAILABLE],
    [3, POSITION_ERROR.TIMEOUT],
    [99, POSITION_ERROR.UNKNOWN],
  ])('maps GeolocationPositionError code %s to %s', (code, expected) => {
    expect(toPositionError({ code, message: 'x' }).code).toBe(expected);
  });
});

describe('watchPosition', () => {
  test('reports unsupported and returns a no-op stop when geolocation is unavailable', () => {
    const onError = vi.fn();
    const stop = watchPosition(undefined, { onError });

    expect(onError).toHaveBeenCalledWith({
      code: POSITION_ERROR.UNSUPPORTED,
      message: expect.any(String),
    });
    expect(() => stop()).not.toThrow();
  });

  test('delivers mapped readings, not the raw GeolocationPosition', () => {
    const onReading = vi.fn();
    const geolocation = {
      watchPosition: (success) => {
        success(fakePosition());
        return 42;
      },
      clearWatch: vi.fn(),
    };

    watchPosition(geolocation, { onReading });

    expect(onReading).toHaveBeenCalledWith(expect.objectContaining({ lat: 51.5, lon: -0.14 }));
    expect(onReading.mock.calls[0][0]).not.toHaveProperty('coords');
  });

  test('an error does not stop the watch — a later success still reaches onReading', () => {
    let deliverError;
    let deliverSuccess;
    const geolocation = {
      watchPosition: (success, error) => {
        deliverSuccess = success;
        deliverError = error;
        return 1;
      },
      clearWatch: vi.fn(),
    };
    const onReading = vi.fn();
    const onError = vi.fn();

    watchPosition(geolocation, { onReading, onError });
    deliverError({ code: 2, message: 'unavailable' });
    deliverSuccess(fakePosition());

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onReading).toHaveBeenCalledTimes(1);
  });

  test('stop() suppresses a success callback that arrives afterwards', () => {
    let deliverSuccess;
    const geolocation = {
      watchPosition: (success) => {
        deliverSuccess = success;
        return 1;
      },
      clearWatch: vi.fn(),
    };
    const onReading = vi.fn();

    const stop = watchPosition(geolocation, { onReading });
    stop();
    deliverSuccess(fakePosition());

    expect(onReading).not.toHaveBeenCalled();
  });

  test('stop() calls clearWatch with the id returned by watchPosition', () => {
    const clearWatch = vi.fn();
    const geolocation = { watchPosition: () => 42, clearWatch };

    watchPosition(geolocation, {})();

    expect(clearWatch).toHaveBeenCalledWith(42);
  });

  test('stop() is idempotent — a second call does not call clearWatch again', () => {
    const clearWatch = vi.fn();
    const geolocation = { watchPosition: () => 42, clearWatch };

    const stop = watchPosition(geolocation, {});
    stop();
    stop();

    expect(clearWatch).toHaveBeenCalledTimes(1);
  });
});
