// A single GPS/compass/photo reading within a session. Pure record
// construction and validation; storage and GeoJSON conversion live
// elsewhere. `synced`/`syncedAt` are vestigial (GitHub sync was dropped,
// 2026-08-11, before anything ever flipped them): they stay in the record
// shape so stored data keeps one shape, and stay false/null forever —
// exported-or-not is derived from the session instead (isExported below in
// session.js).
//
// `recordedAt` (when the surveyor asserted the observation) and `fixAt`
// (when the position was actually measured) are deliberately distinct — a
// surveyor can stand at a point, type a note for 40 seconds, then save.

export const POSITION_SOURCE_GPS = 'gps';
export const POSITION_SOURCE_MAP = 'map';
export const POSITION_SOURCE_TRACE = 'trace';
const POSITION_SOURCES = new Set([
  POSITION_SOURCE_GPS,
  POSITION_SOURCE_MAP,
  POSITION_SOURCE_TRACE,
]);

const inRange = ([lon, lat]) =>
  Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180;

// A traced geometry: the LineString of a walked path or the single-ring
// Polygon of a walked boundary. Point is deliberately absent — a point
// observation's geometry is its lat/lon, and letting Point in here would
// create two ways to say the same thing that could disagree.
//
// Self-intersection is deliberately NOT validated: the finish step warns
// about a figure-eight and saves it anyway, so a saved boundary must pass
// back through here on re-import.
function validateGeometry(geometry) {
  if (geometry.type === 'LineString') {
    const line = geometry.coordinates;
    if (!Array.isArray(line) || line.length < 2) {
      throw new Error('createObservation: a LineString geometry needs at least two positions');
    }
    for (const position of line) {
      if (!inRange(position)) {
        throw new Error(`createObservation: geometry position ${position} is out of range`);
      }
    }
    return;
  }
  if (geometry.type === 'Polygon') {
    // Exactly one ring: traces never produce holes, and the strictness
    // protects import from foreign files this app could never have written.
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length !== 1) {
      throw new Error('createObservation: a Polygon geometry must be exactly one ring');
    }
    const ring = geometry.coordinates[0];
    if (!Array.isArray(ring) || ring.length < 4) {
      throw new Error('createObservation: a Polygon ring needs at least four positions');
    }
    const [firstLon, firstLat] = ring[0];
    const [lastLon, lastLat] = ring[ring.length - 1];
    if (firstLon !== lastLon || firstLat !== lastLat) {
      throw new Error('createObservation: a Polygon ring must close — first position repeated last');
    }
    for (const position of ring) {
      if (!inRange(position)) {
        throw new Error(`createObservation: geometry position ${position} is out of range`);
      }
    }
    const distinct = new Set(ring.map(([lon, lat]) => `${lon},${lat}`)).size;
    if (distinct < 3) {
      throw new Error('createObservation: a Polygon ring needs at least three distinct vertices');
    }
    return;
  }
  throw new Error(
    `createObservation: geometry must be a LineString or Polygon (got ${geometry.type})`,
  );
}

export function createObservation({
  id,
  sessionId,
  recordedAt,
  fixAt,
  lat,
  lon,
  gpsAccuracyM,
  altitudeM = null,
  altitudeAccuracyM = null,
  headingDeg = null,
  headingAccuracyDeg = null,
  note = '',
  photoId = null,
  audioId = null,
  // Where this observation was started from, when the surveyor tapped a
  // feature on the map rather than just standing somewhere. Optional and
  // null by default — most observations have no such origin.
  featureLayerId = null,
  featureId = null,
  featureLabel = null,
  // 'gps' when lat/lon came from a fix, 'map' when the surveyor placed the
  // point under the crosshair because they could see the thing but not reach
  // it. Everything else about the record is identical either way, which is
  // exactly why this has to be here: gpsAccuracyM carries the map precision
  // for a picked point, an honest uncertainty that says nothing about where
  // the number came from. Without this, an eyeballed point and a satellite
  // fix are indistinguishable downstream.
  positionSource = POSITION_SOURCE_GPS,
  // The walked line itself, when this observation is a trace: a LineString
  // (path) or one-ring Polygon (boundary). lat/lon then hold a representative
  // point — a path's distance-midpoint, a boundary's centroid — and
  // gpsAccuracyM the worst vertex accuracy of the walk.
  geometry = null,
}) {
  if (!id) throw new Error('createObservation: id is required');
  if (!sessionId) throw new Error('createObservation: sessionId is required');
  if (!recordedAt) throw new Error('createObservation: recordedAt is required');
  if (!fixAt) throw new Error('createObservation: fixAt is required');
  // Number.isFinite first: NaN/undefined compare false against every bound,
  // so bare range checks would let a missing or garbage reading through.
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`createObservation: lat ${lat} is not a finite in-range number`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(`createObservation: lon ${lon} is not a finite in-range number`);
  }
  if (!Number.isFinite(gpsAccuracyM) || gpsAccuracyM < 0) {
    throw new Error(
      `createObservation: gpsAccuracyM must be a non-negative number (got ${gpsAccuracyM})`,
    );
  }

  if (!POSITION_SOURCES.has(positionSource)) {
    throw new Error(
      `createObservation: positionSource must be one of ${[...POSITION_SOURCES].join(', ')} (got ${positionSource})`,
    );
  }
  // Both halves or neither, mirroring the feature-link rule below: a
  // geometry without 'trace' provenance claims a walked line came from a
  // single fix, and 'trace' without a geometry is a line that isn't there.
  if (positionSource === POSITION_SOURCE_TRACE && !geometry) {
    throw new Error("createObservation: positionSource 'trace' requires a geometry");
  }
  if (geometry && positionSource !== POSITION_SOURCE_TRACE) {
    throw new Error("createObservation: a geometry requires positionSource 'trace'");
  }
  if (geometry) validateGeometry(geometry);

  // Both halves or neither. A feature id without its layer cannot be joined
  // back to any dataset; a layer without a feature says only "somewhere in
  // there". Either half on its own is worse than nothing, because it looks
  // like a link.
  if (Boolean(featureLayerId) !== Boolean(featureId)) {
    throw new Error(
      'createObservation: featureLayerId and featureId must be given together (got ' +
        `featureLayerId=${featureLayerId}, featureId=${featureId})`,
    );
  }
  // The label is a convenience on top of the link, never the link itself.
  const linked = Boolean(featureLayerId);

  return {
    id,
    sessionId,
    recordedAt,
    fixAt,
    lat,
    lon,
    gpsAccuracyM,
    altitudeM,
    altitudeAccuracyM,
    headingDeg,
    headingAccuracyDeg,
    note,
    photoId,
    audioId,
    featureLayerId,
    featureId,
    featureLabel: linked ? featureLabel : null,
    positionSource,
    geometry,
    synced: false,
    syncedAt: null,
  };
}
