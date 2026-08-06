// Pure capability-detection helpers, each taking its browser dependency as a
// parameter so they're testable without a real browser. The device-probe page
// wires these to `window`/`navigator`/`DeviceOrientationEvent` directly.

export function isStandalone({ standalone, matchMedia } = {}) {
  if (standalone === true) return true;
  if (typeof matchMedia === 'function') {
    return matchMedia('(display-mode: standalone)').matches;
  }
  return false;
}

export function canRequestOrientationPermission(DeviceOrientationEventCtor) {
  return typeof DeviceOrientationEventCtor?.requestPermission === 'function';
}

export function canShareFiles(navigatorLike, files) {
  return typeof navigatorLike?.canShare === 'function' && navigatorLike.canShare({ files });
}
