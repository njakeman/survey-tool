// The locator: the station mark from the design pass (4a/4b) — ring,
// cardinal ticks, a fix at the centre, and a beam whose width IS the
// compass's uncertainty. Pure: this module produces markup strings and view
// descriptions; mapAdapter.js owns the DOM marker it feeds them into, which
// is what keeps beam maths and state rules node-testable.
//
// It is a DOM marker, not circle layers, because the mark needs a dashed
// ring (stale), a rotating gradient beam and per-mode CSS tokens — none of
// which a MapLibre circle layer can express. The accuracy circle is NOT
// part of the mark: it stays the existing position-accuracy circle layer,
// where the metres-to-pixels scaling already works and is already tested.
//
// Geometry is docs/locator.svg verbatim: 160×160
// viewBox, fix r9.5, ring r22 at 3px, four cardinal ticks r26→35 with round
// caps, and every stroke sitting on a 6px half-opacity casing drawn first —
// the same trick as the trace-line casings, and what makes the mark hold on
// pale vector paper and dark aerial alike. Colours ride CSS custom
// properties (--locator-stroke / --locator-casing / --accent, defined per
// mode in style.css), so dark and night need no code here.

const CENTRE = 80;
const BEAM_RADIUS = 62;

// 60° when the heading is trusted, opening toward 120° and fading as the
// reported accuracy degrades. A magnetometer next to a Land Rover door is
// wrong by a lot, and a narrow confident beam would be a lie told at
// exactly the moment it costs someone a walk in the wrong direction.
export const BEAM_MIN_DEG = 60;
export const BEAM_MAX_DEG = 120;
const TRUSTED_ACCURACY_DEG = 15;
const DEGRADED_ACCURACY_DEG = 60;
const BEAM_MIN_OPACITY = 0.35;

function round1(value) {
  return Math.round(value * 10) / 10;
}

// Cumulative rotation for CSS-transitioned compass elements: 359°→1° must
// turn 2° forward, not spin 358° the long way round, so the returned angle
// accumulates past 360 instead of wrapping. Shared by the locator beam
// (mapAdapter) and the station guidance arrow (StationBlock).
export function accumulateRotation(previous, targetDeg) {
  if (previous === null || previous === undefined) return targetDeg;
  const delta = ((((targetDeg - previous) % 360) + 540) % 360) - 180;
  return previous + delta;
}

// A wedge of `arcDeg` centred due north, rotated into place by the caller
// via a CSS transform — rotation must not rebuild the path.
export function beamPath(arcDeg) {
  const half = ((arcDeg / 2) * Math.PI) / 180;
  const xOffset = BEAM_RADIUS * Math.sin(half);
  const y = round1(CENTRE - BEAM_RADIUS * Math.cos(half));
  const left = round1(CENTRE - xOffset);
  const right = round1(CENTRE + xOffset);
  return `M${CENTRE},${CENTRE} L${left},${y} A${BEAM_RADIUS},${BEAM_RADIUS} 0 0,1 ${right},${y} Z`;
}

// heading is the sensor reading ({ headingDeg, headingAccuracyDeg|null })
// or null when the compass is denied, absent or has produced nothing —
// in which case the beam is absent entirely, the honest representation of
// not knowing; the readings panel already says "Position only — no compass"
// in words.
export function locatorView({ heading, stale }) {
  let beam = null;
  if (heading && Number.isFinite(heading.headingDeg)) {
    // The fallback source reports no accuracy at all: unknown uncertainty
    // is shown as the widest, faintest beam, never a confident one.
    const accuracy = Number.isFinite(heading.headingAccuracyDeg)
      ? heading.headingAccuracyDeg
      : DEGRADED_ACCURACY_DEG;
    const t = Math.min(
      1,
      Math.max(
        0,
        (accuracy - TRUSTED_ACCURACY_DEG) / (DEGRADED_ACCURACY_DEG - TRUSTED_ACCURACY_DEG),
      ),
    );
    beam = {
      rotationDeg: heading.headingDeg,
      arcDeg: BEAM_MIN_DEG + (BEAM_MAX_DEG - BEAM_MIN_DEG) * t,
      opacity: 1 - (1 - BEAM_MIN_OPACITY) * t,
    };
  }
  return { beam, stale: Boolean(stale) };
}

// The static mark. Order matters: beam beneath everything, then every
// casing, then every stroke, then the fix — so the crosshair silhouette
// always reads over the beam and the casing never overpaints a stroke.
export const LOCATOR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160" aria-hidden="true">
  <defs>
    <radialGradient id="locator-cone" gradientUnits="userSpaceOnUse" cx="80" cy="80" r="62">
      <stop offset="0%" style="stop-color: var(--accent, #c2611f)" stop-opacity=".5"></stop>
      <stop offset="100%" style="stop-color: var(--accent, #c2611f)" stop-opacity="0"></stop>
    </radialGradient>
  </defs>
  <g id="locator-beam" class="locator-beam">
    <path id="locator-beam-path" d="${beamPath(BEAM_MIN_DEG)}" fill="url(#locator-cone)"></path>
  </g>
  <g class="locator-casing" stroke-width="6" stroke-opacity=".5" stroke-linecap="round" fill="none">
    <line x1="80" y1="45" x2="80" y2="54"></line>
    <line x1="80" y1="106" x2="80" y2="115"></line>
    <line x1="45" y1="80" x2="54" y2="80"></line>
    <line x1="106" y1="80" x2="115" y2="80"></line>
    <circle cx="80" cy="80" r="22"></circle>
  </g>
  <g class="locator-stroke" stroke-width="3" stroke-linecap="round" fill="none">
    <line x1="80" y1="45" x2="80" y2="54"></line>
    <line x1="80" y1="106" x2="80" y2="115"></line>
    <line x1="45" y1="80" x2="54" y2="80"></line>
    <line x1="106" y1="80" x2="115" y2="80"></line>
    <circle id="locator-ring" cx="80" cy="80" r="22"></circle>
  </g>
  <circle id="locator-fix" class="locator-fix" cx="80" cy="80" r="9.5" stroke-width="2"></circle>
</svg>
`.trim();
