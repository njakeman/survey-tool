// A single GPS/compass/photo reading within a session. Pure record
// construction and validation; storage and GeoJSON conversion live
// elsewhere. `synced`/`syncedAt` start false/null and are only ever flipped
// by the sync layer (Phase 5) — never set here.
//
// `recordedAt` (when the surveyor asserted the observation) and `fixAt`
// (when the position was actually measured) are deliberately distinct — a
// surveyor can stand at a point, type a note for 40 seconds, then save.

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
    synced: false,
    syncedAt: null,
  };
}
