// Converts a session + its observations into a single-FeatureCollection
// GeoJSON document: flat properties, simple types, no nesting — openable in
// QGIS by a non-specialist with no instructions (plan's data-format goal).
// Combine with canonical-json.js's canonicalStringify for the actual bytes
// written to disk/sync.

function observationToFeature(obs, session, appVersion, gridRef) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [obs.lon, obs.lat] },
    properties: {
      obs_id: obs.id,
      recorded_at: obs.recordedAt,
      fix_at: obs.fixAt,
      lat: obs.lat,
      lon: obs.lon,
      gps_accuracy_m: obs.gpsAccuracyM,
      altitude_m: obs.altitudeM,
      altitude_accuracy_m: obs.altitudeAccuracyM,
      heading_deg: obs.headingDeg,
      heading_accuracy_deg: obs.headingAccuracyDeg,
      note: obs.note,
      photo: obs.photoId ? `${obs.photoId}.jpg` : null,
      // The feature the observation was started from, if any. Emitted even
      // when null: a GIS consumer takes its columns from the features it
      // sees, so omitting the keys would make the column set depend on which
      // rows happened to be linked. `?? null` rather than a bare read because
      // observations saved before these fields existed have no such keys, and
      // canonicalStringify drops undefined — the row would lose the columns
      // rather than carry them empty.
      feature_layer: obs.featureLayerId ?? null,
      feature_id: obs.featureId ?? null,
      feature_label: obs.featureLabel ?? null,
      // Derived from lat/lon at export time rather than stored on the
      // observation: it is a restatement of the coordinates, and a stored
      // copy could only ever drift from them. Null outside Great Britain,
      // and null if the shift grid never loaded — an export must not fail
      // over a convenience column.
      os_grid_ref: gridRef?.(obs.lat, obs.lon) ?? null,
      session_name: session.name,
      app_version: appVersion,
    },
  };
}

// Plain <  on ISO-8601 UTC strings and ULIDs, never localeCompare —
// collation is host-ICU-dependent, and this ordering feeds canonicalStringify,
// whose byte-identical-output guarantee sync's idempotency rests on. The id
// tiebreak makes two saves in the same instant order identically everywhere.
function compareObservations(a, b) {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export function sessionToFeatureCollection(session, observations, { appVersion, gridRef }) {
  const features = observations
    .slice()
    .sort(compareObservations)
    .map((obs) => observationToFeature(obs, session, appVersion, gridRef));

  return { type: 'FeatureCollection', features };
}
