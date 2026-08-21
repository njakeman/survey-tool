import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { StationList } from './StationList.js';
import { deriveStations, nearestStations } from '../domain/revisit.js';
import { compassPoint, formatDateLong, formatDistance } from '../sensors/format.js';

// The revisit half of the session-start screen (design 8a): pick the
// reference export, see what was loaded — read only, always — and check the
// nearest stations before deciding to start. Dumb about loading itself:
// SessionBar owns the picked file's journey through loadReferenceFile and
// hands the result down as `loaded` ({ buffer, stations, reference }).

function pluralise(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// Both pickers (first load and Replace) are the app's one file-input shape:
// a styled label wrapping a visually hidden input. value cleared on pick so
// the same file can be chosen twice (the Retake precedent).
function FilePick({ label, onPickFile, busy }) {
  return html`<label class="revisit-setup-pick button-outline">
    ${busy ? 'Reading…' : label}
    <input
      type="file"
      accept=".zip,application/zip"
      class="visually-hidden"
      disabled=${busy}
      onChange=${(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) onPickFile(file);
      }}
    />
  </label>`;
}

export function RevisitSetup({
  loaded = null,
  busy = false,
  error = null,
  position = null,
  onPickFile,
}) {
  const [reviewing, setReviewing] = useState(false);

  const errorLine = error
    ? html`<p class="revisit-setup-error" role="alert">${error}</p>`
    : null;

  if (!loaded) {
    // No hint line: the chooser button that revealed this block already
    // says what a revisit is; the one thing left to do is pick the file.
    return html`<div class="revisit-setup">
      <${FilePick} label="Load reference export" onPickFile=${onPickFile} busy=${busy} />
      ${errorLine}
    </div>`;
  }

  const { reference } = loaded;
  const stations = deriveStations(loaded.stations, [], []);
  const nearest = nearestStations(stations, position, 3);

  return html`<div class="revisit-setup">
    <p class="revisit-setup-label">Reference survey</p>
    <div class="revisit-setup-card">
      <p class="revisit-setup-file">
        <span class="revisit-setup-filename">${reference.filename}</span>
        <span class="chip station-chip-readonly">Read only</span>
      </p>
      <p class="revisit-setup-summary">
        ${pluralise(reference.stationCount, 'station')} ·${' '}
        ${pluralise(reference.photoCount, 'photo')} · ${formatDateLong(reference.startedAt)}
      </p>
      <div class="revisit-setup-actions">
        <${FilePick} label="Replace file" onPickFile=${onPickFile} busy=${busy} />
        <button
          type="button"
          class="button-outline"
          aria-expanded=${reviewing}
          onClick=${() => setReviewing((current) => !current)}
        >
          Review stations
        </button>
      </div>
    </div>
    ${errorLine}
    ${reviewing ? html`<${StationList} stations=${stations} />` : null}
    ${nearest.length > 0
      ? html`<div class="revisit-setup-nearest">
          <p class="revisit-setup-label">
            Nearest stations <span class="revisit-setup-caption">by distance</span>
          </p>
          <ul class="revisit-setup-nearest-list">
            ${nearest.map(
              ({ station, distanceM: away, bearingDeg: bearing }) =>
                html`<li class="revisit-setup-nearest-row" key=${station.id}>
                  <span class="revisit-setup-nearest-distance">${formatDistance(away)}</span>
                  <span class="revisit-setup-nearest-name">${station.name}</span>
                  <span class="revisit-setup-nearest-compass">${compassPoint(bearing)}</span>
                </li>`,
            )}
          </ul>
        </div>`
      : null}
  </div>`;
}
