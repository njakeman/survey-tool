import { distanceM } from './distance.js';

// Where to put an observation that stands for a whole polygon: its
// area-weighted centroid, and how far that point is from the polygon's
// farthest vertex. Pure geometry, no browser deps — same tier as distance.js.
//
// The shoelace formula runs on raw lon/lat. That is deliberate: at parcel
// scale the projection error is centimetres, and the alternative — projecting
// every ring — buys nothing an accuracy figure measured in tens of metres
// could ever show.

function ringCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area /= 2;
  if (area === 0) {
    // Degenerate — every vertex on one line. The vertex average is still a
    // point on (or near) the thing that was tapped, which beats refusing.
    const points = ring.slice(0, -1);
    return {
      area: 0,
      lon: points.reduce((sum, [x]) => sum + x, 0) / points.length,
      lat: points.reduce((sum, [, y]) => sum + y, 0) / points.length,
    };
  }
  return { area: Math.abs(area), lon: cx / (6 * area), lat: cy / (6 * area) };
}

// Outer rings only, holes ignored: the centroid of a ring around a pond is a
// perfectly good place to record the parcel that contains the pond.
function outerRings(geometry) {
  if (geometry?.type === 'Polygon' && geometry.coordinates?.length) {
    return [geometry.coordinates[0]];
  }
  if (geometry?.type === 'MultiPolygon' && geometry.coordinates?.length) {
    return geometry.coordinates.map((polygon) => polygon[0]).filter(Boolean);
  }
  return [];
}

export function polygonCentroid(geometry) {
  const rings = outerRings(geometry);
  if (rings.length === 0) return null;
  // A MultiPolygon is represented by its largest member, not some point in
  // the water between two islands.
  const best = rings.map(ringCentroid).reduce((a, b) => (b.area > a.area ? b : a));
  return { lat: best.lat, lon: best.lon };
}

// How honestly `gpsAccuracyM` can describe a centroid: the observation stands
// for the whole polygon, so its "accuracy" is the reach to the farthest
// vertex of any member — never less than a metre.
export function polygonExtentM(geometry, centre) {
  const rings = outerRings(geometry);
  if (rings.length === 0 || !centre) return null;
  const reach = Math.max(
    ...rings.flatMap((ring) => ring.map(([lon, lat]) => distanceM(centre, { lat, lon }))),
  );
  return Math.max(1, reach);
}
