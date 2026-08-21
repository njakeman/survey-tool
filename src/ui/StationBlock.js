import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { PlanDiagram } from './planDiagram.js';
import { distanceM, bearingDeg } from '../geo/distance.js';
import { compassPoint, formatDateLong, formatDistance } from '../sensors/format.js';

// The station block (design 8b): what a revisit puts where a new survey has
// a blank note. Three guidance devices, one job each — the plan diagram is
// orientation, the arrow and distance are the walking instruction (the
// largest numbers on the screen, same reason the readout's are), and the
// reference note is the identification: GPS gets you to ±6 m, the words get
// you to the stile.
//
// "Can't reach it" is a claim about the world that lands in the export, so
// it takes the confirm-replaces-its-trigger idiom; the commit is accent,
// not danger — it moves a record toward saved, destroys nothing, and the
// danger treatment stays reserved for the two destructive confirms.

const pad3 = (deg) => String(Math.round(deg)).padStart(3, '0');

// North-up arrow: the map never rotates, so the bearing rotates the glyph
// directly — no compass involved.
function BearingArrow({ bearing }) {
  return html`<svg
    class="station-block-arrow"
    viewBox="0 0 32 32"
    style=${`transform: rotate(${Math.round(bearing)}deg)`}
    aria-hidden="true"
  >
    <g fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <line x1="16" y1="28" x2="16" y2="7" />
      <polyline points="8.5,14.5 16,6 23.5,14.5" />
    </g>
  </svg>`;
}

export function StationBlock({
  station,
  stationCount,
  stations,
  currentId,
  position,
  referenceStartedAt,
  busy = false,
  onChange,
  onFrame,
  onSkip,
  onNoAccess,
}) {
  const [confirmingNoAccess, setConfirmingNoAccess] = useState(false);
  const [reason, setReason] = useState('');

  const away = distanceM(position, station);
  const bearing = bearingDeg(position, station);
  const note = (station.note ?? '').trim();
  // Built in JS, not across htm line breaks — htm trims whitespace between
  // expressions and would eat the separators (the describeCrosshair rule).
  const bearingMeta =
    bearing != null
      ? `bearing ${pad3(bearing)}°` +
        (position?.accuracyM != null ? ` · ±${Math.round(position.accuracyM)} m fix` : '')
      : null;

  function commitNoAccess() {
    const trimmed = reason.trim();
    setConfirmingNoAccess(false);
    setReason('');
    onNoAccess?.(trimmed || null);
  }

  return html`<section class="station-block">
    <div class="station-block-head">
      <span class="station-block-label">Station ${station.index + 1} of ${stationCount}</span>
      <button type="button" class="button-outline" disabled=${busy} onClick=${() => onChange?.()}>
        Change
      </button>
    </div>
    <div class="station-block-card">
      <div class="station-block-guidance">
        <${PlanDiagram} stations=${stations} currentId=${currentId} position=${position} />
        <div class="station-block-where">
          <p class="station-block-name">${station.name}</p>
          ${
            away != null && bearing != null
              ? html`<p class="station-block-walk">
                    <${BearingArrow} bearing=${bearing} />
                    <span class="station-block-distance">${formatDistance(away)}</span>
                    <span class="station-block-compass">${compassPoint(bearing)}</span>
                  </p>
                  <p class="station-block-meta">${bearingMeta}</p>`
              : html`<p class="station-block-meta">waiting for GPS fix</p>`
          }
        </div>
      </div>
      ${
        note
          ? html`<div class="station-block-note">
              <p class="station-block-note-label">
                Note from ${formatDateLong(referenceStartedAt)}
              </p>
              <p class="station-block-note-text">${note}</p>
            </div>`
          : null
      }
    </div>
    ${
      confirmingNoAccess
        ? html`<div class="station-block-confirm">
            <p class="station-block-confirm-title">Mark ${station.name} as no access?</p>
            <p class="station-block-confirm-copy">
              It leaves the to-do count and is recorded as unreachable on this date. You can still
              revisit it later in the session.
            </p>
            <label class="field">
              <span class="field-label">Reason — optional</span>
              <input
                type="text"
                value=${reason}
                onInput=${(event) => setReason(event.target.value)}
                disabled=${busy}
              />
            </label>
            <div class="station-block-confirm-actions">
              <button
                type="button"
                class="button-primary"
                disabled=${busy}
                onClick=${commitNoAccess}
              >
                Mark no access
              </button>
              <button
                type="button"
                class="link"
                disabled=${busy}
                onClick=${() => {
                  setConfirmingNoAccess(false);
                  setReason('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>`
        : html`<button
              type="button"
              class="button-primary station-block-frame"
              disabled=${busy}
              onClick=${() => onFrame?.()}
            >
              Frame the photo
            </button>
            <div class="station-block-secondary">
              <button
                type="button"
                class="button-outline"
                disabled=${busy}
                onClick=${() => onSkip?.()}
              >
                Skip for now
              </button>
              <button
                type="button"
                class="button-outline"
                disabled=${busy}
                onClick=${() => setConfirmingNoAccess(true)}
              >
                Can't reach it
              </button>
            </div>`
    }
  </section>`;
}
