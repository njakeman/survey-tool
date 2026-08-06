import { html } from 'htm/preact';
import { formatLatLon, formatAccuracy, formatHeading } from '../sensors/format.js';

const POSITION_ONLY_STATUSES = ['denied', 'unavailable'];

function PositionReadout({ position, positionError }) {
  if (position) {
    return html`<p>
      ${formatLatLon(position.lat, position.lon)} · ${formatAccuracy(position.accuracyM)}
    </p>`;
  }
  if (positionError?.code === 'permission-denied') {
    return html`<p>Location access denied</p>`;
  }
  return html`<p>Waiting for GPS fix…</p>`;
}

function CompassReadout({ heading, headingStatus, onEnableCompass }) {
  if (headingStatus === 'idle') {
    return html`<button type="button" onClick=${onEnableCompass}>Enable compass</button>`;
  }
  if (headingStatus === 'active' && heading) {
    return html`<p>${formatHeading(heading.headingDeg)}</p>`;
  }
  if (POSITION_ONLY_STATUSES.includes(headingStatus)) {
    return html`<p class="position-only">Position only — no compass</p>`;
  }
  return null;
}

// Live readings, deliberately never hiding accuracy behind a tick — the
// surveyor needs the number in metres to judge whether a fix is trustworthy.
export function ReadingsPanel({
  position,
  positionError,
  heading,
  headingStatus,
  onEnableCompass,
}) {
  return html`
    <div class="readings-panel">
      <${PositionReadout} position=${position} positionError=${positionError} />
      <${CompassReadout}
        heading=${heading}
        headingStatus=${headingStatus}
        onEnableCompass=${onEnableCompass}
      />
    </div>
  `;
}
