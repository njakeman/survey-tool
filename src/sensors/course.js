import { bearingDeg, distanceM } from '../geo/distance.js';

// Course-over-ground from two consecutive position fixes — the third
// heading source in the station guidance chain, behind the compass events
// (deviceorientationabsolute / webkitCompassHeading). Derived from lat/lon
// deltas only, deliberately never from the GPS's own coords.heading, which
// position.js drops at the adapter boundary (see its header comment) — this
// keeps the compass-vs-course distinction structurally visible: a course
// exists only when the surveyor has demonstrably moved.
//
// The gate is the trace recorder's own motion-vs-noise rule (MIN_SPACING_M
// there): movement smaller than max(5 m, the fix's own error bar) is noise,
// and a guidance arrow twitching to GPS jitter while the surveyor stands
// still is worse than no rotation at all.
const MIN_COURSE_MOVE_M = 5;

export function courseFromFixes(previous, current) {
  const moved = distanceM(previous, current);
  if (moved === null || moved === undefined) return null;
  const floor = Math.max(
    MIN_COURSE_MOVE_M,
    Number.isFinite(current?.accuracyM) ? current.accuracyM : MIN_COURSE_MOVE_M,
  );
  if (moved < floor) return null;
  return bearingDeg(previous, current);
}
