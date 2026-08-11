import { html } from 'htm/preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// A voice note on the observation being captured — record, hear it back,
// remove it. Mirrors PhotoField's contract: the recorded value lives in
// CapturePage's state (`audio` — { blob, durationMs } | null) so it survives
// view switches and is cleared on save with the note and photo; this
// component owns only the transient recording lifecycle.
//
// `recordAudio` is injected from main.js (src/audio/record.js is browser-only,
// same rule as photo/encode.js), so tests hand in a fake and no test ever
// needs a microphone. Failure — denial above all — lands as a message on
// this field and never blocks Save: a voice note is a convenience, exactly
// like the compass.
export function VoiceNoteField({ audio, error, onRecorded, onRemove, onError, recordAudio }) {
  const [recording, setRecording] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const handleRef = useRef(null);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => clearInterval(timer);
  }, [recording, startedAt]);

  // Leaving the page mid-recording must not leave the microphone live.
  useEffect(
    () => () => {
      handleRef.current?.cancel();
    },
    [],
  );

  async function startRecording() {
    onError?.(null);
    try {
      const handle = await recordAudio();
      handleRef.current = handle;
      setStartedAt(Date.now());
      setElapsedMs(0);
      setRecording(true);
    } catch (recordError) {
      onError?.(recordError.message || 'Could not start recording');
    }
  }

  async function stopRecording() {
    const handle = handleRef.current;
    handleRef.current = null;
    setRecording(false);
    if (!handle) return;
    try {
      const result = await handle.stop();
      if (result.blob.size === 0) {
        // The specific reported iOS failure: everything ran, nothing came
        // out. It must not save as a silent file.
        onError?.('No audio was captured — try again');
        return;
      }
      onRecorded(result);
    } catch (recordError) {
      onError?.(recordError.message || 'Recording failed');
    }
  }

  // Native <audio controls> for playback: play/pause/scrub for free, and iOS
  // renders it with touch-sized controls. The URL is revoked when the blob
  // changes or the field unmounts.
  const audioUrl = useMemo(() => (audio ? URL.createObjectURL(audio.blob) : null), [audio]);
  useEffect(() => () => audioUrl && URL.revokeObjectURL(audioUrl), [audioUrl]);

  return html`
    <div class="voice-note-field">
      ${
        recording
          ? html`
              <span class="voice-note-elapsed" role="status">
                <span class="voice-note-dot" aria-hidden="true"></span>
                Recording · ${formatElapsed(elapsedMs)}
              </span>
              <button type="button" class="button-outline" onClick=${stopRecording}>Stop</button>
            `
          : audio
            ? html`
                <audio controls src=${audioUrl} class="voice-note-player"></audio>
                <button type="button" class="link" onClick=${onRemove}>Remove voice note</button>
              `
            : html`
                <button type="button" class="button-outline" onClick=${startRecording}>
                  Record voice note
                </button>
              `
      }
      ${error ? html`<p class="voice-note-error panel-danger" role="alert">${error}</p>` : null}
    </div>
  `;
}
