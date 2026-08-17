import { describe, expect, test } from 'vitest';
import {
  canRequestOrientationPermission,
  canShareFiles,
  supportedRecordingTypes,
} from './capabilities.js';

describe('canRequestOrientationPermission', () => {
  test('true when DeviceOrientationEvent.requestPermission is a function', () => {
    const ctor = { requestPermission: () => Promise.resolve('granted') };
    expect(canRequestOrientationPermission(ctor)).toBe(true);
  });

  test('false when DeviceOrientationEvent has no requestPermission (most browsers)', () => {
    expect(canRequestOrientationPermission({})).toBe(false);
  });

  test('false when DeviceOrientationEvent is undefined (unsupported browser)', () => {
    expect(canRequestOrientationPermission(undefined)).toBe(false);
  });
});

describe('canShareFiles', () => {
  test('true when navigator.canShare reports the files are shareable', () => {
    const navigatorLike = { canShare: () => true };
    expect(canShareFiles(navigatorLike, [])).toBe(true);
  });

  test('false when navigator.canShare reports the files are not shareable', () => {
    const navigatorLike = { canShare: () => false };
    expect(canShareFiles(navigatorLike, [])).toBe(false);
  });

  test('false when navigator has no canShare (Web Share API unsupported)', () => {
    expect(canShareFiles({}, [])).toBe(false);
  });
});

describe('supportedRecordingTypes', () => {
  // Which container and codec a voice note could actually use. The constructor
  // is injected for the same reason DeviceOrientationEvent is: node has no
  // MediaRecorder, and the interesting cases are the ones a laptop cannot
  // produce anyway.
  function fakeRecorder(supported) {
    return { isTypeSupported: (type) => supported.includes(type) };
  }

  test('returns only the candidates the device accepts, in the order offered', () => {
    const recorder = fakeRecorder(['audio/mp4', 'audio/webm;codecs=opus']);

    expect(
      supportedRecordingTypes(recorder, ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg']),
    ).toEqual(['audio/webm;codecs=opus', 'audio/mp4']);
  });

  test('is empty when the device accepts none of them', () => {
    expect(supportedRecordingTypes(fakeRecorder([]), ['audio/mp4'])).toEqual([]);
  });

  test('is empty when there is no MediaRecorder at all, rather than throwing', () => {
    // An older WebView, or a browser where the API is simply absent. The probe
    // has to report that as a finding, not fall over.
    expect(supportedRecordingTypes(undefined, ['audio/mp4'])).toEqual([]);
    expect(supportedRecordingTypes({}, ['audio/mp4'])).toEqual([]);
  });
});
