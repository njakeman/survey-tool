import { distanceM } from './distance.js';

// Length and midpoint of a walked line, for the trace modes: the length is
// what the observations list and export report, and the distance-midpoint is
// where a traced path's observation record stands ("the middle of that
// hedgerow" — the point a surveyor would read a grid reference for). The
// midpoint is measured along the line, not taken from the middle vertex,
// because automatic thinning spaces vertices unevenly. Pure geometry, same
// tier and same spherical-earth argument as distance.js.

const toPoint = ([lon, lat]) => ({ lat, lon });

export function lineLengthM(coordinates) {
  if (!coordinates || coordinates.length < 2) return null;
  let total = 0;
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    total += distanceM(toPoint(coordinates[i]), toPoint(coordinates[i + 1]));
  }
  return total;
}

export function midpointOnLine(coordinates) {
  const total = lineLengthM(coordinates);
  if (total === null) return null;
  if (total === 0) return toPoint(coordinates[0]);

  const half = total / 2;
  let walked = 0;
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const from = coordinates[i];
    const to = coordinates[i + 1];
    const segment = distanceM(toPoint(from), toPoint(to));
    if (walked + segment >= half) {
      // Linear interpolation on raw lon/lat — over one thinned segment (a
      // few metres) the projection error is unmeasurable.
      const t = segment === 0 ? 0 : (half - walked) / segment;
      return {
        lat: from[1] + (to[1] - from[1]) * t,
        lon: from[0] + (to[0] - from[0]) * t,
      };
    }
    walked += segment;
  }
  // Floating-point slack can leave the walk a hair short of `half`.
  return toPoint(coordinates[coordinates.length - 1]);
}
