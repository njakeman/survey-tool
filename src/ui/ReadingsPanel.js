import { html } from 'htm/preact';
import { formatLatLon, formatAccuracy, formatHeading, formatAge } from '../sensors/format.js';

// A fix older than this is called out. Long enough not to nag during a normal
// ~1Hz stream, short enough that a surveyor about to save an observation
// notices the coordinates are not current.
const STALE_AFTER_MS = 30_000;

// Every code position.js can emit. Previously only permission-denied was
// handled and the rest fell through to "Waiting for GPS fix…", so a device
// that could never produce a fix was indistinguishable from one about to.
const POSITION_ERROR_MESSAGES = {
  'permission-denied': 'Location access denied',
  unsupported: 'This device does not support location',
  'position-unavailable': 'Position unavailable — no signal',
  timeout: 'Location timed out',
  unknown: 'Could not read location',
};

function PositionReadout({ position, positionError, now }) {
  const message = positionError ? POSITION_ERROR_MESSAGES[positionError.code] : null;

  if (position) {
    const ageMs = now() - position.fixAtMs;
    const stale = Number.isFinite(ageMs) && ageMs >= STALE_AFTER_MS;
    return html`
      <p>
        ${formatLatLon(position.lat, position.lon)} · ${formatAccuracy(position.accuracyM)}
        ${
          // usePosition keeps the last reading when an error arrives, so
          // without this the screen shows stale coordinates that look live.
          stale ? html`<span class="reading-stale"> · ${formatAge(ageMs)} ago</span>` : null
        }
      </p>
      ${message ? html`<p class="reading-problem">${message}</p>` : null}
    `;
  }

  if (message) return html`<p class="reading-problem">${message}</p>`;
  return html`<p>Waiting for GPS fix…</p>`;
}

function CompassReadout({ heading, headingStatus, onEnableCompass, onRetryCompass }) {
  if (headingStatus === 'idle') {
    return html`<button type="button" onClick=${onEnableCompass}>Enable compass</button>`;
  }
  if (headingStatus === 'active' && heading) {
    return html`<p>${formatHeading(heading.headingDeg)}</p>`;
  }
  if (headingStatus === 'waiting' || headingStatus === 'active') {
    // The Enable button vanishes on tap and the watch allows several seconds
    // for a first reading; rendering nothing in between reads as broken.
    return html`<p>Waiting for compass…</p>`;
  }
  if (headingStatus === 'denied') {
    return html`<p class="position-only">Position only — no compass</p>`;
  }
  // 'unavailable': the watch tears itself down after its no-heading timeout
  // and nothing re-arms it, so without an explicit retry the compass is gone
  // for the rest of the session.
  return html`
    <p class="position-only">
      Position only — no compass
      ${onRetryCompass ? html`<button type="button" onClick=${onRetryCompass}>Retry</button>` : null}
    </p>
  `;
}

// Live readings, deliberately never hiding accuracy behind a tick — the
// surveyor needs the number in metres to judge whether a fix is trustworthy.
export function ReadingsPanel({
  position,
  positionError,
  heading,
  headingStatus,
  onEnableCompass,
  onRetryCompass,
  now = Date.now,
}) {
  return html`
    <div class="readings-panel">
      <${PositionReadout} position=${position} positionError=${positionError} now=${now} />
      <${CompassReadout}
        heading=${heading}
        headingStatus=${headingStatus}
        onEnableCompass=${onEnableCompass}
        onRetryCompass=${onRetryCompass}
      />
    </div>
  `;
}
