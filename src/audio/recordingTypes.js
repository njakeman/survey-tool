// The container/codec combinations worth asking a device for, in order of
// preference: Opus is far more efficient for speech, mp4/AAC is what Safari
// has always supported. Shared by the probe page (which reports what the
// device accepts) and the real recorder (which uses the first accepted one)
// so the two can never test different lists.
//
// The answer on the actual target device is recorded in
// docs/ios-manual-checklist.md: audio/webm;codecs=opus, ~0.4 MB/min.
export const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4;codecs=opus',
  'audio/mp4',
  'audio/webm',
];
