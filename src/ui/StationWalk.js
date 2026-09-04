import { html } from 'htm/preact';
import { useRef } from 'preact/hooks';
import { distanceM, bearingDeg } from '../geo/distance.js';
import { accumulateRotation } from '../map/locator.js';
import { compassPoint, formatDistance } from '../sensors/format.js';

// The walking instruction: arrow, distance, compass point — the largest
// numbers on the screen, read at arm's length while moving (design 8b). One
// component because it has two hosts: the station block on the page, and
// the readout over the maximised map, which covers the block (field to-do
// 2026-09-04). Each host keeps its own rotation accumulator; accumulateRotation
// is idempotent for a repeated target, so the two can never disagree.

// Rotated by a CUMULATIVE angle (the locator beam's own unwrap) so the CSS
// transition turns 2° across the 359→1 wrap instead of spinning the long
// way round.
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

export function StationWalk({
  position,
  station,
  // The effective device heading (compass, else course-over-ground) — the
  // host owns the fallback chain. Null means no source: the arrow stands at
  // TRUE bearing rather than pretending to track the device.
  guidanceHeadingDeg = null,
}) {
  const rotationRef = useRef(null);
  if (!position || !station) return null;
  const away = distanceM(position, station);
  const bearing = bearingDeg(position, station);
  if (away == null || bearing == null) return null;
  // Screen-relative when a heading drives it (up = where the device points),
  // true bearing otherwise.
  const screenDeg =
    guidanceHeadingDeg != null ? (bearing - guidanceHeadingDeg + 360) % 360 : bearing;
  rotationRef.current = accumulateRotation(rotationRef.current, screenDeg);
  return html`<p class="station-block-walk">
    <${BearingArrow} rotationDeg=${rotationRef.current} />
    <span class="station-block-distance">${formatDistance(away)}</span>
    <span class="station-block-compass">${compassPoint(bearing)}</span>
  </p>`;
}
