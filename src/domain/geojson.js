// Converts a session + its observations into a single-FeatureCollection
// GeoJSON document: flat properties, simple types, no nesting — openable in
// QGIS by a non-specialist with no instructions (plan's data-format goal).
// Combine with canonical-json.js's canonicalStringify for the actual bytes
// written to disk/sync.

function observationToFeature(obs, session, appVersion) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [obs.lon, obs.lat] },
    properties: {
      obs_id: obs.id,
      recorded_at: obs.recordedAt,
      lat: obs.lat,
      lon: obs.lon,
      gps_accuracy_m: obs.gpsAccuracyM,
      altitude_m: obs.altitudeM,
      altitude_accuracy_m: obs.altitudeAccuracyM,
      heading_deg: obs.headingDeg,
      heading_accuracy_deg: obs.headingAccuracyDeg,
      note: obs.note,
      photo: obs.photoId ? `${obs.photoId}.jpg` : null,
      session_name: session.name,
      app_version: appVersion,
    },
  };
}

export function sessionToFeatureCollection(session, observations, { appVersion }) {
  const features = observations
    .slice()
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    .map((obs) => observationToFeature(obs, session, appVersion));

  return { type: 'FeatureCollection', features };
}
