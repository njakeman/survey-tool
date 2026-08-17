import { html } from 'htm/preact';
import {
  formatLatLon,
  formatAccuracy,
  formatHeading,
  formatAge,
  accuracyQuality,
} from '../sensors/format.js';

// A fix older than this is called out. Long enough not to nag during a normal
// ~1Hz stream, short enough that a surveyor about to save an observation
// notices the coordinates are not current. Exported so the map's locator
// goes stale at the same moment as the readout — two definitions of "old"
// on one screen would contradict each other.
export const STALE_AFTER_MS = 30_000;

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

// Natural case here, uppercased by CSS: VoiceOver reads a word rather than
// spelling out four capitals.
const QUALITY_WORDS = { good: 'Good', fair: 'Fair', poor: 'Poor' };

function PositionReadout({ position, positionError, gridRef, now }) {
  const message = positionError ? POSITION_ERROR_MESSAGES[positionError.code] : null;

  if (position) {
    // Null outside Great Britain, and null until the shift grid has loaded.
    // Rendered only when there is one: an empty row labelled "grid" would be
    // a permanent question rather than an occasional absence.
    const gridReference = gridRef?.(position.lat, position.lon) ?? null;
    const ageMs = now() - position.fixAtMs;
    const stale = Number.isFinite(ageMs) && ageMs >= STALE_AFTER_MS;
    // Shown as a chip beside the metre figure. The number alone asks the
    // surveyor to remember what counts as a good fix; accuracyQuality has
    // been in format.js since Phase 3 with nothing displaying it.
    const quality = QUALITY_WORDS[accuracyQuality(position.accuracyM)];
    return html`
      <p class="readings-coords">${formatLatLon(position.lat, position.lon)}</p>
      ${gridReference ? html`<p class="readings-gridref">${gridReference}</p>` : null}
      <p class="readings-accuracy">
        <span class="readings-accuracy-value">${formatAccuracy(position.accuracyM)}</span>
        <span class="readings-accuracy-word">accuracy</span>
        ${quality ? html`<span class="chip">${quality}</span>` : null}
      </p>
      ${
        // usePosition keeps the last reading when an error arrives, so
        // without this the screen shows stale coordinates that look live.
        // formatAge already ends in "ago" — appending another read
        // "1 min ago ago".
        stale ? html`<p class="reading-stale warns">Fix taken ${formatAge(ageMs)}</p>` : null
      }
      ${message ? html`<p class="reading-problem warns">${message}</p>` : null}
    `;
  }

  if (message) return html`<p class="reading-problem warns">${message}</p>`;
  return html`<p class="readings-waiting">Waiting for GPS fix…</p>`;
}

function CompassReadout({ heading, headingStatus, onEnableCompass, onRetryCompass }) {
  if (headingStatus === 'idle') {
    return html`<button type="button" class="button-outline" onClick=${onEnableCompass}>
      Enable compass
    </button>`;
  }
  if (headingStatus === 'active' && heading) {
    return html`<p class="readings-heading-value">${formatHeading(heading.headingDeg)}</p>`;
  }
  if (headingStatus === 'waiting' || headingStatus === 'active') {
    // The Enable button vanishes on tap and the watch allows several seconds
    // for a first reading; rendering nothing in between reads as broken.
    return html`<p class="readings-waiting">Waiting for compass…</p>`;
  }
  if (headingStatus === 'denied') {
    // iOS stores this answer permanently per origin — a further tap just
    // resolves 'denied' again with no dialog (useHeading.js's enable()), so
    // Retry would be a dead end and is deliberately withheld. The generic
    // "no compass" wording below is honestly ambiguous between "denied" and
    // "no magnetometer"; this branch instead names the actual fix, since it
    // is the one case where the surveyor themselves can resolve it.
    return html`<p class="position-only warns">
      Position only — compass access is blocked for this site. Reset it in Settings → Safari →
      Advanced → Website Data (or delete and re-add the home screen icon), then reload.
    </p>`;
  }
  // 'unavailable': the watch tears itself down after its no-heading timeout
  // and nothing re-arms it, so without an explicit retry the compass is gone
  // for the rest of the session.
  return html`
    <p class="position-only warns">
      Position only — no compass
      ${
        onRetryCompass
          ? html`<button type="button" class="button-outline" onClick=${onRetryCompass}>
              Retry
            </button>`
          : null
      }
    </p>
  `;
}

// Live readings, deliberately never hiding accuracy behind a tick — the
// surveyor needs the number in metres to judge whether a fix is trustworthy.
// The largest type in the app, and the reason the map is a panel rather than
// a screen: this is what gets read at arm's length in sunlight.
export function ReadingsPanel({
  position,
  positionError,
  heading,
  headingStatus,
  onEnableCompass,
  onRetryCompass,
  gridRef,
  now = Date.now,
}) {
  return html`
    <div class="readings-panel">
      <p class="field-label">Position</p>
      <${PositionReadout}
        position=${position}
        positionError=${positionError}
        gridRef=${gridRef}
        now=${now}
      />
      <div class="readings-heading">
        <p class="field-label">Heading</p>
        <${CompassReadout}
          heading=${heading}
          headingStatus=${headingStatus}
          onEnableCompass=${onEnableCompass}
          onRetryCompass=${onRetryCompass}
        />
      </div>
    </div>
  `;
}
