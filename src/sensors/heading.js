// Compass adapter. iOS requires DeviceOrientationEvent.requestPermission()
// to be called synchronously from a user gesture — see the Start-session
// handler in CapturePage, which calls requestHeadingPermission() before any
// await. Heading comes from webkitCompassHeading (true north, clockwise) on
// iOS, falling back to the standard absolute+alpha for other browsers.

export const HEADING_PERMISSION = {
  GRANTED: 'granted',
  DENIED: 'denied',
  NOT_REQUIRED: 'not-required', // no requestPermission() on this platform
  ERROR: 'error',
};

function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

export async function requestHeadingPermission(DeviceOrientationEventCtor) {
  if (typeof DeviceOrientationEventCtor?.requestPermission !== 'function') {
    return HEADING_PERMISSION.NOT_REQUIRED;
  }
  try {
    const result = await DeviceOrientationEventCtor.requestPermission();
    if (result === 'granted') return HEADING_PERMISSION.GRANTED;
    if (result === 'denied') return HEADING_PERMISSION.DENIED;
    return HEADING_PERMISSION.ERROR;
  } catch {
    return HEADING_PERMISSION.ERROR;
  }
}

export function toHeadingReading(event) {
  if (Number.isFinite(event.webkitCompassHeading)) {
    return {
      headingDeg: normalizeDeg(event.webkitCompassHeading),
      headingAccuracyDeg: event.webkitCompassAccuracy >= 0 ? event.webkitCompassAccuracy : null,
      source: 'webkit-compass',
    };
  }
  if (event.absolute === true && Number.isFinite(event.alpha)) {
    return {
      headingDeg: normalizeDeg(360 - event.alpha),
      headingAccuracyDeg: null,
      source: 'absolute-alpha',
    };
  }
  return null;
}

export function watchHeading(
  target,
  {
    onReading,
    onUnavailable,
    timeoutMs = 4000,
    minIntervalMs = 200,
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {},
) {
  if (!target || typeof target.addEventListener !== 'function') {
    onUnavailable?.({ reason: 'unsupported' });
    return () => {};
  }

  let stopped = false;
  let lastDeliveredAt = null;
  let timeoutId = null;

  function clearTimer() {
    if (timeoutId !== null) {
      clearTimeoutFn(timeoutId);
      timeoutId = null;
    }
  }

  function handleTimeout() {
    timeoutId = null;
    stop();
    onUnavailable?.({ reason: 'no-heading' });
  }

  function handleEvent(event) {
    if (stopped) return;
    const reading = toHeadingReading(event);
    if (reading === null) return; // does not cancel the "no magnetometer" timeout

    clearTimer();

    const t = now();
    if (lastDeliveredAt !== null && t - lastDeliveredAt < minIntervalMs) return;
    lastDeliveredAt = t;
    onReading?.(reading);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimer();
    target.removeEventListener('deviceorientation', handleEvent);
  }

  timeoutId = setTimeoutFn(handleTimeout, timeoutMs);
  target.addEventListener('deviceorientation', handleEvent);

  return stop;
}
