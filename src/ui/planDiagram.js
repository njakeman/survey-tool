import { html } from 'htm/preact';
import { distanceM, bearingDeg } from '../geo/distance.js';
import { formatDistance } from '../sensors/format.js';

// The 86px plan diagram in the station block: where the stations sit
// relative to where you stand, north up, no basemap — orientation, not
// navigation. Pure projection first (node-testable numbers), a thin SVG
// component after — the locator.js split. DOM SVG rather than anything on
// the map canvas, so night mode arrives free through the CSS tokens.

export const PLAN_SIZE = 86;
export const PLAN_CENTRE = PLAN_SIZE / 2;
export const PLAN_OUTER_R = 38;

// The disc's radius in metres: 50 m by default (rings at 25/50, the design
// figure), growing in tidy steps until the farthest station fits. Tidy
// because the corner caption is read, not measured against.
const SCALE_STEPS_M = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];

function outerScaleM(maxDistanceM) {
  for (const step of SCALE_STEPS_M) {
    if (maxDistanceM <= step) return step;
  }
  return Math.ceil(maxDistanceM / 50000) * 50000;
}

export function planDiagramView(stations, currentId, position) {
  if (!position || !stations?.length) return null;

  const measured = stations.map((station) => ({
    id: station.id,
    kind: station.id === currentId ? 'current' : station.state === 'done' ? 'done' : 'todo',
    d: distanceM(position, station),
    b: bearingDeg(position, station),
  }));

  const outerM = outerScaleM(Math.max(...measured.map((p) => p.d)));
  const points = measured.map(({ id, kind, d, b }) => {
    const r = (d / outerM) * PLAN_OUTER_R;
    const rad = (b * Math.PI) / 180;
    return {
      id,
      kind,
      x: PLAN_CENTRE + r * Math.sin(rad),
      y: PLAN_CENTRE - r * Math.cos(rad),
    };
  });

  return {
    outerM,
    caption: formatDistance(outerM),
    rings: [PLAN_OUTER_R / 2, PLAN_OUTER_R],
    points,
    currentBearingDeg: measured.find((p) => p.kind === 'current')?.b ?? null,
  };
}

// Station shapes are 5px diamonds (rects rotated about their own centre);
// colours ride CSS classes with token-driven fills, so the diagram follows
// every scheme including night.
function stationShape({ id, kind, x, y }) {
  return html`<rect
    key=${id}
    class="plan-diagram-station plan-diagram-${kind}"
    x=${x - 2.5}
    y=${y - 2.5}
    width="5"
    height="5"
    transform="rotate(45 ${x} ${y})"
  />`;
}

export function PlanDiagram({ stations, currentId, position }) {
  const view = planDiagramView(stations, currentId, position);
  if (!view) return null;

  // A short tick from the you-dot toward the current station — the same
  // "which way from here" the big arrow answers, kept on the diagram so the
  // two never disagree.
  const tick =
    view.currentBearingDeg != null
      ? (() => {
          const rad = (view.currentBearingDeg * Math.PI) / 180;
          return html`<line
            class="plan-diagram-tick"
            x1=${PLAN_CENTRE + 5 * Math.sin(rad)}
            y1=${PLAN_CENTRE - 5 * Math.cos(rad)}
            x2=${PLAN_CENTRE + 13 * Math.sin(rad)}
            y2=${PLAN_CENTRE - 13 * Math.cos(rad)}
          />`;
        })()
      : null;

  return html`<svg
    class="plan-diagram"
    viewBox="0 0 ${PLAN_SIZE} ${PLAN_SIZE}"
    width=${PLAN_SIZE}
    height=${PLAN_SIZE}
    role="img"
    aria-label="Plan of stations around you"
  >
    ${view.rings.map(
      (r) => html`<circle class="plan-diagram-ring" cx=${PLAN_CENTRE} cy=${PLAN_CENTRE} r=${r} />`,
    )}
    ${tick}
    <circle class="plan-diagram-you" cx=${PLAN_CENTRE} cy=${PLAN_CENTRE} r="3.5" />
    ${view.points.map(stationShape)}
    <text class="plan-diagram-caption" x=${PLAN_SIZE - 4} y=${PLAN_SIZE - 4} text-anchor="end">
      ${view.caption}
    </text>
  </svg>`;
}
