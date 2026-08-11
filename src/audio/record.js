import { RECORDING_MIME_CANDIDATES } from './recordingTypes.js';

// The MediaRecorder half of voice notes. Browser dependencies are injected
// (navigator.mediaDevices, window.MediaRecorder) exactly as the sensor
// adapters take theirs, so the whole start/stop/cancel lifecycle is
// node-testable with fakes; main.js binds the real globals and is the only
// place that does.
//
// Two rules, both learned from the field reports that made the probe exist
// rather than guessed: every track is stopped on every exit path — a capture
// left running keeps the iOS recording indicator lit and is the likeliest
// cause of "works once, then never again until you restart the phone" — and
// a permission denial surfaces as the thrown getUserMedia error, distinct
// from a recording that ran and produced nothing.

// Voice, not music; the device probe measured ~0.4 MB/min at this setting.
export const RECORDING_BITS_PER_SECOND = 24_000;

// A backstop, not a feature: a note nobody meant to leave running (a phone
// back in a pocket) must not record until storage runs out. At ~0.4 MB/min
// the cap costs ~2 MB.
export const MAX_RECORDING_MS = 5 * 60_000;

function stopTracks(stream) {
  for (const track of stream.getTracks()) track.stop();
}

// Resolves to a live handle once the stream and recorder are running:
//   { stop(): Promise<{ blob, durationMs }>, cancel(): void }
// stop() resolves with the finished note; cancel() discards it. Either way
// the microphone is released. Reaching the time cap behaves exactly like a
// stop() at that moment.
export async function startRecording({
  mediaDevices,
  MediaRecorderCtor,
  maxMs = MAX_RECORDING_MS,
} = {}) {
  if (typeof MediaRecorderCtor !== 'function') {
    throw new Error('This device has no audio recorder');
  }
  const mimeType = RECORDING_MIME_CANDIDATES.find((type) =>
    MediaRecorderCtor.isTypeSupported?.(type),
  );
  if (!mimeType) {
    throw new Error('This device supports none of the recording formats');
  }

  // Thrown errors from here (NotAllowedError above all) propagate to the
  // caller with the browser's own name and message — the UI shows them.
  const stream = await mediaDevices.getUserMedia({ audio: true });

  let recorder;
  try {
    recorder = new MediaRecorderCtor(stream, {
      mimeType,
      audioBitsPerSecond: RECORDING_BITS_PER_SECOND,
    });
  } catch (error) {
    stopTracks(stream);
    throw error;
  }

  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  const startedAt = Date.now();
  const result = new Promise((resolve, reject) => {
    recorder.onstop = () => {
      stopTracks(stream);
      resolve({
        // The full mime (codecs included) rides as the Blob type; the audio
        // store keeps it as contentType and the export derives the file
        // extension from its container half (domain/audio.js).
        blob: new Blob(chunks, { type: mimeType }),
        durationMs: Date.now() - startedAt,
      });
    };
    recorder.onerror = (event) => {
      stopTracks(stream);
      reject(event?.error ?? new Error('Recording failed'));
    };
  });

  const timer = setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, maxMs);

  recorder.start();

  function stop() {
    clearTimeout(timer);
    if (recorder.state !== 'inactive') recorder.stop();
    return result;
  }

  return {
    stop,
    cancel() {
      // Same shutdown, result discarded — the promise resolves unobserved.
      stop().catch(() => {});
    },
  };
}
