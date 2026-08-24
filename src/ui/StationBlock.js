import { html } from 'htm/preact';
import { useRef, useState } from 'preact/hooks';
import { distanceM, bearingDeg } from '../geo/distance.js';
import { accumulateRotation } from '../map/locator.js';
import { compassPoint, formatDateLong, formatDistance } from '../sensors/format.js';

// The station block (design 8b, revised 2026-08-24): what a revisit puts
// where a new survey has a blank note. Two guidance devices, one job each —
// the arrow and distance are the whole walking instruction (the largest
// numbers on the screen, read at arm's length while moving), and the
// reference note is the identification: GPS gets you to ±6 m, the words get
// you to the stile. An earlier draft put an 86px plan diagram beside the
// arrow; it was dropped as superseded — static, and it duplicated the map
// panel directly above. Don't rebuild it.
//
// "Can't reach it" is a claim about the world that lands in the export, so
// it takes the confirm-replaces-its-trigger idiom; the commit is accent,
// not danger — it moves a record toward saved, destroys nothing, and the
// danger treatment stays reserved for the two destructive confirms.

const pad3 = (deg) => String(Math.round(deg)).padStart(3, '0');

// The walking arrow. Rotated by a CUMULATIVE angle (the locator beam's own
// unwrap) so the CSS transition turns 2° across the 359→1 wrap instead of
// spinning the long way round.
function BearingArrow({ rotationDeg }) {
  return html`<svg
    class="station-block-arrow"
    viewBox="0 0 32 32"
    style=${`transform: rotate(${Math.round(rotationDeg)}deg)`}
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
  position,
  // The effective device heading (compass reading, else course-over-ground)
  // — CapturePage owns the fallback chain. Null when no source exists, in
  // which case the arrow rotates to TRUE bearing and the caption honestly
  // drops "live": a static arrow labelled as a bearing is an instruction, a
  // static arrow implying it tracks the device is a lie. Never pinned.
  guidanceHeadingDeg = null,
  referenceStartedAt,
  busy = false,
  onChange,
  onFrame,
  onSkip,
  onNoAccess,
}) {
  const [confirmingNoAccess, setConfirmingNoAccess] = useState(false);
  const [reason, setReason] = useState('');
  const rotationRef = useRef(null);

  const away = distanceM(position, station);
  const bearing = bearingDeg(position, station);
  // Screen-relative when a heading drives it (up = where the device points),
  // true bearing otherwise. Accumulated across renders for the short turn;
  // accumulateRotation is idempotent for a repeated target, so a re-render
  // without a new reading cannot drift the arrow.
  if (bearing != null) {
    const screenDeg =
      guidanceHeadingDeg != null ? (bearing - guidanceHeadingDeg + 360) % 360 : bearing;
    rotationRef.current = accumulateRotation(rotationRef.current, screenDeg);
  }
  const note = (station.note ?? '').trim();
  // Built in JS, not across htm line breaks — htm trims whitespace between
  // expressions and would eat the separators (the describeCrosshair rule).
  const bearingMeta =
    bearing != null
      ? `bearing ${pad3(bearing)}°` +
        (position?.accuracyM != null ? ` · ±${Math.round(position.accuracyM)} m fix` : '') +
        (guidanceHeadingDeg != null ? ' · live' : '')
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
      <div class="station-block-where">
        <p class="station-block-name">${station.name}</p>
        ${
          away != null && bearing != null
            ? html`<p class="station-block-walk">
                  <${BearingArrow} rotationDeg=${rotationRef.current} />
                  <span class="station-block-distance">${formatDistance(away)}</span>
                  <span class="station-block-compass">${compassPoint(bearing)}</span>
                </p>
                <p class="station-block-meta">${bearingMeta}</p>`
            : html`<p class="station-block-meta">waiting for GPS fix</p>`
        }
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
