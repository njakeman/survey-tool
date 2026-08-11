// The two containers a voice note can arrive in, and the file extensions
// they travel under in an export. One map, used from both directions: the
// export names its files from the stored contentType, and the import reads
// the contentType back off the extension. Anything else a MediaRecorder
// might produce is recorded under the closest of these two at capture time —
// Safari has only ever produced these (AAC-in-mp4 always, Opus-in-webm since
// 18.4).

export const AUDIO_EXTENSION_BY_TYPE = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
};

export const AUDIO_TYPE_BY_EXTENSION = {
  webm: 'audio/webm',
  m4a: 'audio/mp4',
};

// 'audio/webm;codecs=opus' → 'audio/webm': the recorder reports the full
// mime it was asked for, the map keys on the container alone.
export function audioExtension(contentType) {
  const container = (contentType ?? '').split(';')[0].trim();
  return AUDIO_EXTENSION_BY_TYPE[container] ?? 'webm';
}
