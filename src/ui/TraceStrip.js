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
// Three stacked lines (design pass 2a): the status run with elapsed pushed
// right, then the walked total as the largest thing on the strip — mid-walk
// the question is how far you have got, not how long you have been out —
// then the actions. Finish wears the accent in both live states, same
// treatment, same slot: it is what moves the walk toward being saved.
//
// Discard is two-step, and the confirm REPLACES the action row rather than
// extending it — the row must not reflow mid-interaction at 320px, and a
// glove aiming at "Keep tracing" must not land on Finish. A walked kilometre
// must not be lost to one mistap; everything else here is single-tap because
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

  // "Keep tracing" sits where Discard was — far right — so the escape is
  // under the finger that just tapped. "Discard trace" is the app's one red
  // control.
  const discardConfirm = html`
    <span class="trace-discard-confirm">
      <button type="button" class="trace-discard-commit" onClick=${() => onDiscard()}>
        Discard trace
      </button>
      <button type="button" class="link" onClick=${() => setConfirmingDiscard(false)}>
        Keep tracing
      </button>
    </span>
  `;

  const discardLink = html`
    <button type="button" class="link" onClick=${() => setConfirmingDiscard(true)}>Discard</button>
  `;

  if (status === 'pending') {
    return html`
      <div class="trace-strip" data-status="pending">
        <p class="trace-strip-metrics" role="status">Traced ${MODE_LABEL[mode]} · ${walked}</p>
        <p class="trace-strip-note">Save to keep it</p>
        ${
          warnings.includes('self-intersection')
            ? html`<p class="trace-strip-warning warns">
                This boundary crosses itself — you can still save it.
              </p>`
            : null
        }
        ${
          confirmingDiscard
            ? discardConfirm
            : html`<span class="trace-strip-actions">${discardLink}</span>`
        }
        ${error ? html`<p class="trace-strip-error panel-danger" role="alert">${error}</p>` : null}
      </div>
    `;
  }

  return html`
    <div class="trace-strip" data-status=${status}>
      <p class="trace-strip-summary" role="status">
        <span class="trace-strip-dot" data-paused=${status === 'paused'} aria-hidden="true"></span>
        ${status === 'paused' ? `Paused · ${MODE_LABEL[mode]}` : `Tracing ${MODE_LABEL[mode]}`}
        <span class="trace-strip-elapsed">${formatElapsed(elapsedMs)}</span>
      </p>
      ${
        // Waiting takes the metrics SLOT, not a fourth line: the strip is the
        // same height before and after the first vertex, so nothing jumps
        // under the thumb.
        status === 'recording' && stats.vertexCount === 0
          ? html`<p class="trace-strip-metrics" data-waiting="true">Waiting for a good fix…</p>`
          : html`<p class="trace-strip-metrics">${walked}</p>`
      }
      ${
        confirmingDiscard
          ? discardConfirm
          : html`
              <span class="trace-strip-actions">
                <button type="button" class="button-primary" onClick=${() => onFinish()}>
                  Finish
                </button>
                ${
                  status === 'paused'
                    ? html`<button type="button" class="button-outline" onClick=${() => onResume()}>
                        Resume
                      </button>`
                    : html`<button type="button" class="button-outline" onClick=${() => onPause()}>
                        Pause
                      </button>`
                }
                ${discardLink}
              </span>
            `
      }
      ${error ? html`<p class="trace-strip-error panel-danger" role="alert">${error}</p>` : null}
    </div>
  `;
}
