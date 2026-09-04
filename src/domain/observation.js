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
const POSITION_SOURCES = new Set([POSITION_SOURCE_GPS, POSITION_SOURCE_MAP, POSITION_SOURCE_TRACE]);

const inRange = ([lon, lat]) =>
  Number.isFinite(lat) &&
  lat >= -90 &&
  lat <= 90 &&
  Number.isFinite(lon) &&
  lon >= -180 &&
  lon <= 180;

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
      throw new Error(
        'createObservation: a Polygon ring must close — first position repeated last',
      );
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

// A per-photo focal length: finite, positive, or null. `0`, negatives and
// strings are refused by name — a "14" from a hand-edited export would
// otherwise ride into the caption as text.
function photoNumber(value, index, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `createObservation: photos[${index}].${field} must be a positive number or null (got ${value})`,
    );
  }
  return value;
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
  // Every photo attached to this observation, in capture order. Each entry
  // is the photo record's id plus — for a revisit — the reference photo
  // filename it re-framed. Empty when there are none. Ids are minted fresh
  // per photo (never the observation's id) — one observation can hold many.
  photos = [],
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
  // Segments of a traced geometry the app inferred rather than measured:
  // each entry i means the segment from coordinate i-1 to i spans a gap in
  // the fix stream (the platform suspended the page, a pause, a recovered
  // draft). Not derivable from the coordinates, so unlike trace_length_m it
  // must survive export and import. Null when the whole walk was measured.
  traceGaps = null,
  // The voice note's length, measured at record time — the one thing that
  // decides whether you play it now or later, so a list row can say 0:12
  // without loading the blob.
  audioDurationMs = null,
  // Stamped when a saved observation is edited after the fact (photo
  // retaken/deleted/added, note amended). Compared against the session's
  // lastExportedAt to mark records whose export is stale — see
  // isChangedSinceExport in session.js.
  changedAt = null,
  // The revisit pairing: which reference station this observation revisits.
  // The id is the key longitudinal comparison joins on; each photo's own
  // referencePhoto (above) is a convenience that survives the reference's
  // own ids being reminted on re-export.
  referenceObservationId = null,
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

  const normalisedGaps = Array.isArray(traceGaps) && traceGaps.length === 0 ? null : traceGaps;
  if (normalisedGaps !== null && normalisedGaps !== undefined) {
    if (!geometry) {
      throw new Error('createObservation: traceGaps require a geometry to index into');
    }
    if (!Array.isArray(normalisedGaps)) {
      throw new Error(`createObservation: traceGaps must be an array or null (got ${traceGaps})`);
    }
    // Valid segment indices: 1..n-1 over the walked vertices. A LineString
    // of n coordinates has segments 1..n-1; a Polygon ring's last coordinate
    // repeats the first, and that synthetic closing segment is never
    // flaggable — the walk ended before it existed.
    const segmentCount =
      geometry.type === 'Polygon'
        ? geometry.coordinates[0].length - 2
        : geometry.coordinates.length - 1;
    let previous = 0;
    for (const seq of normalisedGaps) {
      if (!Number.isInteger(seq) || seq < 1 || seq > segmentCount || seq <= previous) {
        throw new Error(
          `createObservation: traceGaps must be strictly increasing integers in 1..${segmentCount} (got ${normalisedGaps})`,
        );
      }
      previous = seq;
    }
  }

  if (audioDurationMs !== null && (!Number.isFinite(audioDurationMs) || audioDurationMs < 0)) {
    throw new Error(
      `createObservation: audioDurationMs must be a non-negative number or null (got ${audioDurationMs})`,
    );
  }

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

  if (!Array.isArray(photos)) {
    throw new Error(`createObservation: photos must be an array (got ${photos})`);
  }
  const seenPhotoIds = new Set();
  const normalisedPhotos = photos.map((entry, index) => {
    const id = entry?.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`createObservation: photos[${index}] needs a non-empty string id`);
    }
    if (seenPhotoIds.has(id)) {
      throw new Error(`createObservation: duplicate photo id ${id} in photos`);
    }
    seenPhotoIds.add(id);
    const referencePhoto = entry.referencePhoto ?? null;
    // It names a file inside the reference zip — anything else could only be
    // joined by accident, and would ride out into the export as ref_photo.
    if (referencePhoto !== null && typeof referencePhoto !== 'string') {
      throw new Error(
        `createObservation: photos[${index}].referencePhoto must be a string or null (got ${referencePhoto})`,
      );
    }
    // Half of both-halves: a reference photo filename without its station
    // id joins to nothing. The id alone IS legal — a station may honestly
    // have no photo, and the pairing is still a pairing.
    if (referencePhoto && !referenceObservationId) {
      throw new Error(
        `createObservation: photos[${index}].referencePhoto requires referenceObservationId`,
      );
    }
    // The lens the shot was taken on, read from the original file before
    // the downscale (photo/exif.js) — the stored bytes carry nothing. Null
    // is the honest value for a direct capture (WebKit's camera UI strips
    // it) and for every record from before this existed.
    const focalLength35mm = photoNumber(entry.focalLength35mm, index, 'focalLength35mm');
    const focalLengthMm = photoNumber(entry.focalLengthMm, index, 'focalLengthMm');
    const lensModel = entry.lensModel ?? null;
    if (lensModel !== null && typeof lensModel !== 'string') {
      throw new Error(
        `createObservation: photos[${index}].lensModel must be a string or null (got ${lensModel})`,
      );
    }
    return { id, referencePhoto, focalLength35mm, focalLengthMm, lensModel };
  });

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
    photos: normalisedPhotos,
    audioId,
    featureLayerId,
    featureId,
    featureLabel: linked ? featureLabel : null,
    positionSource,
    geometry,
    traceGaps: normalisedGaps ?? null,
    audioDurationMs,
    changedAt,
    referenceObservationId,
    synced: false,
    syncedAt: null,
  };
}
