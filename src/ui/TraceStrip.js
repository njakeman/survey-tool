import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { formatDistance } from '../sensors/format.js';

function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const MODE_LABEL = { path: 'path', boundary: 'boundary' };

// The persistent strip under the map while a trace records, pauses or waits
// to be saved. Purely presentational — the trace state machine (the reducer,
// the appender, the draft) lives in CapturePage, the same split as
// pickedPoint: the strip shows and asks, the page owns and does.
//
// Discard is two-step. A walked kilometre must not be lost to one mistap
// through a glove; everything else on this strip is single-tap because
// everything else is recoverable.
export function TraceStrip({ trace, onPause, onResume, onFinish, onDiscard }) {
  const { status, mode, startedAt, stats, warnings, error } = trace;
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Its own half-second timer, the VoiceNoteField pattern — elapsed must
  // tick while the surveyor stands still, when no GPS fix would re-render
  // anything.
  useEffect(() => {
    if (status === 'pending') return undefined;
    const startedMs = new Date(startedAt).getTime();
    setElapsedMs(Date.now() - startedMs);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedMs), 500);
    return () => clearInterval(timer);
  }, [status, startedAt]);

  const walked = `${formatDistance(stats.lengthM)} · ${stats.vertexCount} point${stats.vertexCount === 1 ? '' : 's'}`;

  const discard = confirmingDiscard
    ? html`
        <span class="trace-discard-confirm">
          <button type="button" class="button-outline" onClick=${() => onDiscard()}>
            Discard trace
          </button>
          <button type="button" class="link" onClick=${() => setConfirmingDiscard(false)}>
            Keep tracing
          </button>
        </span>
      `
    : html`
        <button type="button" class="link" onClick=${() => setConfirmingDiscard(true)}>
          Discard
        </button>
      `;

  if (status === 'pending') {
    return html`
      <div class="trace-strip" data-status="pending">
        <p class="trace-strip-summary" role="status">
          Traced ${MODE_LABEL[mode]} pending · save to keep it — ${walked}
        </p>
        ${
          warnings.includes('self-intersection')
            ? html`<p class="trace-strip-warning">
                This boundary crosses itself — you can still save it.
              </p>`
            : null
        }
        ${discard}
        ${error ? html`<p class="trace-strip-error panel-danger" role="alert">${error}</p>` : null}
      </div>
    `;
  }

  return html`
    <div class="trace-strip" data-status=${status}>
      <p class="trace-strip-summary" role="status">
        <span class="trace-strip-dot" data-paused=${status === 'paused'} aria-hidden="true"></span>
        ${status === 'paused' ? 'Paused' : 'Tracing'} ${MODE_LABEL[mode]} ·
        ${formatElapsed(elapsedMs)} · ${walked}
      </p>
      ${
        status === 'recording' && stats.vertexCount === 0
          ? html`<p class="trace-strip-hint">Waiting for a good fix…</p>`
          : null
      }
      <span class="trace-strip-actions">
        ${
          status === 'paused'
            ? html`<button type="button" class="button-outline" onClick=${() => onResume()}>
                Resume
              </button>`
            : html`<button type="button" class="button-outline" onClick=${() => onPause()}>
                Pause
              </button>`
        }
        <button type="button" class="button-outline" onClick=${() => onFinish()}>Finish</button>
        ${discard}
      </span>
      ${error ? html`<p class="trace-strip-error panel-danger" role="alert">${error}</p>` : null}
    </div>
  `;
}
