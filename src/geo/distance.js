// How far away, and in what direction. Used by the picking crosshair to say
// "240 m NE" while the surveyor pans the map, so a point marked from a
// distance carries a sanity check the moment it is placed.
//
// Haversine on a spherical earth. Over the distances anyone can see across a
// field — hundreds of metres, occasionally a couple of kilometres — the
// spherical assumption costs well under a metre, which is far inside the
// uncertainty of pointing at something on a map.

const EARTH_RADIUS_M = 6371008.8;

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const toDegrees = (radians) => (radians * 180) / Math.PI;

export function distanceM(from, to) {
  if (!from || !to) return null;
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLat = lat2 - lat1;
  const dLon = toRadians(to.lon - from.lon);

  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Initial great-circle bearing, degrees clockwise from true north. "Initial"
// matters over long distances, where the bearing changes along the path; over
// the distances here it is indistinguishable from a straight line.
export function bearingDeg(from, to) {
  if (!from || !to) return null;
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLon = toRadians(to.lon - from.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

// Metres per pixel at a given latitude and zoom, which is what makes an
// honest accuracy figure for a point picked off the map: at z18 a pixel is
// about half a metre, at z12 it is thirty. The inverse of
// map/overlays.js's metresToPixels, kept here rather than there because that
// module is about drawing and this is about measuring.
const EQUATOR_METRES_PER_PIXEL = 156543.03392;

export function metresPerPixel(lat, zoom) {
  return (EQUATOR_METRES_PER_PIXEL * Math.cos(toRadians(lat))) / 2 ** zoom;
}

// How well we know a point the surveyor placed under a crosshair. The
// crosshair is one pixel but a human aiming it is not, so this is a few
// pixels' worth of ground distance — which has the useful property of
// rewarding zooming in, because that is genuinely a more precise placement.
//
// Floored, because an accuracy of 0 would claim a perfect measurement and
// read as a bug rather than as confidence.
const AIM_TOLERANCE_PX = 4;
const MINIMUM_ACCURACY_M = 1;

export function pickAccuracyM(lat, zoom) {
  return Math.max(MINIMUM_ACCURACY_M, metresPerPixel(lat, zoom) * AIM_TOLERANCE_PX);
}
