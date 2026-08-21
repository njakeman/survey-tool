import { html } from 'htm/preact';
import { distanceM, bearingDeg } from '../geo/distance.js';
import { compassPoint, formatDistance } from '../sensors/format.js';

// The station list, serving three surfaces with one vocabulary: Review
// stations before a session starts (read-only), the Change chooser during
// one (rows tappable — pass onSelect), and anywhere the 8d states need
// showing. Every state is a shape plus a chip word, never colour alone;
// chips carry natural case in the DOM and CSS uppercases them.
//
// stations are domain/revisit.js deriveStations output: id, name, state
// ('done' | 'todo' | 'skipped' | 'noAccess'), reason, lat/lon.

const CHIP_WORDS = {
  done: 'Done',
  todo: 'To do',
  skipped: 'Skipped',
  noAccess: 'No access',
};

function glyphClass(state, isCurrent) {
  if (isCurrent) return 'station-glyph station-glyph-current';
  return `station-glyph station-glyph-${state === 'noAccess' ? 'noaccess' : state}`;
}

function chipFor(state, isCurrent) {
  if (isCurrent) return html`<span class="chip station-chip-current">Current</span>`;
  const variant = state === 'noAccess' ? 'noaccess' : state;
  return html`<span class="chip station-chip-${variant}">${CHIP_WORDS[state]}</span>`;
}

// Built in JS, not across an htm line break — htm trims whitespace between
// expressions and would eat the separators (the describeCrosshair rule).
function walkTo(position, station) {
  const away = distanceM(position, station);
  const compass = compassPoint(bearingDeg(position, station));
  if (away == null || !compass) return null;
  return `${formatDistance(away)} ${compass}`;
}

export function StationList({ stations, currentId = null, position = null, onSelect = null }) {
  const row = (station) => {
    const isCurrent = station.id === currentId;
    const walk = isCurrent && position ? walkTo(position, station) : null;
    const body = html`
      <span class=${glyphClass(station.state, isCurrent)} aria-hidden="true"></span>
      <span class="station-list-name">${station.name}</span>
      ${walk ? html`<span class="station-list-walk">${walk}</span>` : null}
      ${station.reason ? html`<span class="station-list-reason">${station.reason}</span>` : null}
      ${chipFor(station.state, isCurrent)}
    `;
    return html`<li class="station-list-row" key=${station.id}>
      ${
        onSelect
          ? html`<button
              type="button"
              class="station-list-select"
              onClick=${() => onSelect(station.id)}
            >
              ${body}
            </button>`
          : html`<span class="station-list-static">${body}</span>`
      }
    </li>`;
  };

  return html`<ul class="station-list">
    ${(stations ?? []).map(row)}
  </ul>`;
}
