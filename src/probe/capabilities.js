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

// Which container/codec combinations this device would actually record a
// voice note in. Safari has always taken audio/mp4 (AAC) and added WebM/Opus
// in 18.4, but the list is per-device and per-version, so it is asked rather
// than assumed.
//
// An absent MediaRecorder returns an empty list instead of throwing: on the
// probe page "this device has no recorder" is a finding to display, not a
// crash.
export function supportedRecordingTypes(MediaRecorderCtor, candidates) {
  if (typeof MediaRecorderCtor?.isTypeSupported !== 'function') return [];
  return candidates.filter((type) => MediaRecorderCtor.isTypeSupported(type));
}
