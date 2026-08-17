// Compass adapter. iOS requires DeviceOrientationEvent.requestPermission()
// to be called synchronously from a user gesture — see the Start-session
// handler in CapturePage, which calls requestHeadingPermission() before any
// await. Heading comes from webkitCompassHeading (true north, clockwise) on
// iOS, falling back to the standard absolute+alpha for other browsers.
//
// Android Chrome delivers absolute headings on the separate
// deviceorientationabsolute event — its plain deviceorientation is relative
// (absolute: false), which toHeadingReading correctly maps to null. See
// headingEventTypes for the subscription logic and why it is additive, not
// a swap.

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

// Which events can carry a heading on this target. iOS Safari has only
// deviceorientation (WebKit has never implemented the absolute event, and
// webkitCompassHeading rides on the plain one); Chromium's plain
// deviceorientation is *relative*, and absolute headings arrive on
// deviceorientationabsolute instead.
//
// Subscribed in ADDITION to the plain event, never instead of it: a
// Chromium build with no relative-orientation sensor falls back to
// absolute data on the plain event with absolute: true, and that device's
// compass works today — swapping the subscription would take it away.
// Relative events map to null in toHeadingReading, which deliberately does
// not cancel the no-heading timeout, so the extra stream costs nothing
// anywhere. The `in` check (not truthiness — Chromium exposes the property
// as an unassigned null) is what keeps iOS at exactly the one listener it
// has always had.
export function headingEventTypes(target) {
  return 'ondeviceorientationabsolute' in target
    ? ['deviceorientation', 'deviceorientationabsolute']
    : ['deviceorientation'];
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

  const eventTypes = headingEventTypes(target);

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
    for (const type of eventTypes) target.removeEventListener(type, handleEvent);
  }

  timeoutId = setTimeoutFn(handleTimeout, timeoutMs);
  for (const type of eventTypes) target.addEventListener(type, handleEvent);

  return stop;
}
