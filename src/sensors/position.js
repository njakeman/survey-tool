// Geolocation adapter: maps the raw browser API to plain data and owns
// watch lifecycle safety. GPS course/speed (coords.heading/coords.speed)
// are deliberately never exposed — that's course-over-ground, easily
// confused with compass bearing, and null when stationary; dropping it here
// makes that confusion structurally impossible downstream.

export const DEFAULT_POSITION_OPTIONS = { enableHighAccuracy: true, maximumAge: 0 };

export const POSITION_ERROR = {
  UNSUPPORTED: 'unsupported',
  PERMISSION_DENIED: 'permission-denied',
  POSITION_UNAVAILABLE: 'position-unavailable',
  TIMEOUT: 'timeout',
  UNKNOWN: 'unknown',
};

const ERROR_CODE_MAP = {
  1: POSITION_ERROR.PERMISSION_DENIED,
  2: POSITION_ERROR.POSITION_UNAVAILABLE,
  3: POSITION_ERROR.TIMEOUT,
};

export function toPositionReading(position) {
  const { coords, timestamp } = position;
  return {
    lat: coords.latitude,
    lon: coords.longitude,
    accuracyM: coords.accuracy,
    altitudeM: coords.altitude ?? null,
    altitudeAccuracyM: coords.altitudeAccuracy ?? null,
    fixAt: new Date(timestamp).toISOString(),
    fixAtMs: timestamp,
  };
}

export function toPositionError(error) {
  return {
    code: ERROR_CODE_MAP[error.code] ?? POSITION_ERROR.UNKNOWN,
    message: error.message ?? '',
  };
}

export function watchPosition(
  geolocation,
  { onReading, onError, options = DEFAULT_POSITION_OPTIONS } = {},
) {
  if (!geolocation || typeof geolocation.watchPosition !== 'function') {
    onError?.({ code: POSITION_ERROR.UNSUPPORTED, message: 'Geolocation is not supported' });
    return () => {};
  }

  let stopped = false;

  const watchId = geolocation.watchPosition(
    (position) => {
      if (stopped) return;
      onReading?.(toPositionReading(position));
    },
    (error) => {
      if (stopped) return;
      onError?.(toPositionError(error));
    },
    options,
  );

  return function stop() {
    if (stopped) return;
    stopped = true;
    geolocation.clearWatch(watchId);
  };
}
