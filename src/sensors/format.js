// Display formatting for live readings. Accuracy is always shown in metres,
// never a tick — the brief is explicit that the surveyor needs a number to
// judge trustworthiness, not a boolean. Pure and logic-free so components
// stay thin.

const COMPASS_POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

export function formatLatLon(lat, lon) {
  if (lat == null || lon == null) return '—';
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

export function formatAccuracy(accuracyM) {
  if (accuracyM == null) return '—';
  return `±${Math.round(accuracyM)} m`;
}

export function accuracyQuality(accuracyM) {
  if (accuracyM == null) return 'unknown';
  if (accuracyM <= 10) return 'good';
  if (accuracyM <= 30) return 'fair';
  return 'poor';
}

export function formatAltitude(altitudeM, altitudeAccuracyM) {
  if (altitudeM == null) return '—';
  const base = `${Math.round(altitudeM)} m`;
  if (altitudeAccuracyM == null) return base;
  return `${base} ±${Math.round(altitudeAccuracyM)} m`;
}

export function compassPoint(headingDeg) {
  if (headingDeg == null) return null;
  const index = Math.round(normalizeDeg(headingDeg) / 22.5) % 16;
  return COMPASS_POINTS[index];
}

export function formatHeading(headingDeg) {
  if (headingDeg == null) return '—';
  return `${Math.round(headingDeg)}° ${compassPoint(headingDeg)}`;
}

export function formatTime(isoString) {
  if (isoString == null) return '—';
  return new Date(isoString).toLocaleTimeString('en-GB');
}

export function formatAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 3000) return 'just now';
  if (ageMs < 60000) return `${Math.floor(ageMs / 1000)} s ago`;
  return `${Math.floor(ageMs / 60000)} min ago`;
}
