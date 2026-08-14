import { html } from 'htm/preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { VoiceTransport, TRANSPORT_BAR_HEIGHTS } from './VoiceTransport.js';
import { formatDuration } from './format.js';

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

  // The URL is revoked when the blob changes or the field unmounts; the
  // transport owns the Audio element it plays through.
  const audioUrl = useMemo(() => (audio ? URL.createObjectURL(audio.blob) : null), [audio]);
  useEffect(() => () => audioUrl && URL.revokeObjectURL(audioUrl), [audioUrl]);

  // Design pass 4: 5c in full. Recording is the accent-edged row — dot,
  // activity bars, timer, Stop; recorded/playing is the shared VoiceTransport
  // (also used by the saved rows). The recording bars are a repeating
  // pattern, deliberately not live levels (user decision) — visibly a
  // rhythm, not a meter, animated to say the microphone is on.
  return html`
    <div class="voice-note-field">
      ${
        recording
          ? html`
              <span class="voice-note-recording" aria-label="Recording voice note">
                <span class="voice-note-dot" aria-hidden="true"></span>
                <span class="voice-note-bars" aria-hidden="true">
                  ${TRANSPORT_BAR_HEIGHTS.map(
                    (height, index) =>
                      html`<span
                        style="height:${height}px; animation-delay:${index * 0.12}s"
                      ></span>`,
                  )}
                </span>
                <span class="voice-note-elapsed" role="timer" aria-label="Recording time">
                  ${formatDuration(elapsedMs)}
                </span>
                <button type="button" class="voice-note-stop" onClick=${stopRecording}>
                  <span class="glyph-stop" aria-hidden="true"></span>
                  Stop
                </button>
              </span>
            `
          : audio
            ? html`
                <${VoiceTransport}
                  src=${audioUrl}
                  durationMs=${audio.durationMs ?? null}
                  onDelete=${onRemove}
                />
              `
            : html`
                <button type="button" class="voice-note-idle" onClick=${startRecording}>
                  <svg
                    class="glyph-mic"
                    viewBox="0 0 14 19"
                    width="14"
                    height="19"
                    aria-hidden="true"
                  >
                    <rect
                      x="4.5"
                      y="1"
                      width="5"
                      height="9"
                      rx="2.5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    />
                    <path
                      d="M2 8.5a5 5 0 0 0 10 0"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                    <line
                      x1="7"
                      y1="13.5"
                      x2="7"
                      y2="17"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                  Voice note
                </button>
              `
      }
      ${error ? html`<p class="voice-note-error panel-danger" role="alert">${error}</p>` : null}
    </div>
  `;
}
