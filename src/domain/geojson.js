// Converts a session + its observations into a single-FeatureCollection
// GeoJSON document: flat properties, simple types, no nesting — openable in
// QGIS by a non-specialist with no instructions (plan's data-format goal).
// Combine with canonical-json.js's canonicalStringify for the actual bytes
// written to disk/sync.

import { lineLengthM } from '../geo/lineMetrics.js';

// A traced observation's walked length: line length for a path, perimeter
// for a boundary. Derived from the geometry at export time like os_grid_ref
// — a stored copy could only ever drift from the coordinates it restates.
function traceLengthM(geometry) {
  if (!geometry) return null;
  const line = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates;
  return lineLengthM(line);
}

function observationToFeature(obs, session, appVersion, gridRef, audioFilename) {
  // A trace carries the walked LineString/Polygon; everything else is the
  // Point its lat/lon already describe. `?? null` on the read below because
  // records stored before geometry existed have no such key.
  const geometry = obs.geometry ?? null;
  return {
    type: 'Feature',
    geometry: geometry ?? { type: 'Point', coordinates: [obs.lon, obs.lat] },
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
      // Every photo, in capture order, each with the reference photo it
      // re-framed (revisit) or null. Always an array — the column-set rule.
      // `?? []` because records stored before photos[] existed have no key
      // (the DB v8 upgrade rewrites them, but be honest anyway). Adding this
      // changed every export's bytes once (2026-08-25).
      photos: (obs.photos ?? []).map((entry) => ({
        photo: `${entry.id}.jpg`,
        ref_photo: entry.referencePhoto ?? null,
      })),
      // The first photo, kept so consumers and builds that predate photos[]
      // still read one filename per row. Null where there are none.
      photo: obs.photos?.[0] ? `${obs.photos[0].id}.jpg` : null,
      // The voice note's filename inside the zip. Injected (like gridRef)
      // because the extension depends on the recording's contentType, which
      // lives with the bytes in the audio store, not on the observation.
      audio: obs.audioId ? (audioFilename?.(obs.audioId) ?? null) : null,
      // Measured at record time — the one attachment fact a consumer can use
      // without opening the file. `?? null` for records saved before the
      // field existed (canonicalStringify drops undefined, which would cost
      // the column).
      audio_duration_ms: obs.audioDurationMs ?? null,
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
      // Whether the coordinates were measured or placed on a map. Defaulted
      // rather than read straight through: records saved before this field
      // existed were all GPS fixes, and 'gps' is the honest value for them.
      position_source: obs.positionSource ?? 'gps',
      // Walked length of a trace, null on every point row — emitted always,
      // for the same column-set reason as the feature link above.
      trace_length_m: traceLengthM(geometry),
      // Segments the app inferred rather than measured (index i = the
      // segment from coordinate i-1 to i spans a fix-stream gap). Unlike
      // trace_length_m this does NOT restate the geometry, so it must ride
      // the export and be read back on import. `?? null` — the feature-link
      // precedent; adding it changed every export's bytes once (2026-08-24).
      trace_gaps: obs.traceGaps ?? null,
      // The revisit pairing: the reference station this observation revisits,
      // and the first photo's pairing; the per-photo pairings ride `photos`.
      // Emitted on every row (`?? null`, the feature-link precedent) — which
      // changed the exported bytes of existing sessions once, free while
      // nothing diffs old exports against new ones. The pairing key is what
      // makes a longitudinal record joinable; it must never drop.
      ref_obs_id: obs.referenceObservationId ?? null,
      ref_photo: obs.photos?.[0]?.referencePhoto ?? null,
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

export function sessionToFeatureCollection(
  session,
  observations,
  { appVersion, gridRef, audioFilename, revisitStations },
) {
  const features = observations
    .slice()
    .sort(compareObservations)
    .map((obs) => observationToFeature(obs, session, appVersion, gridRef, audioFilename));

  // A second foreign member for revisit sessions only — absent entirely for
  // ordinary surveys, so their canonical bytes carry no member their
  // sessions never had. Names the reference export (self-describing, not
  // self-contained: the reference itself is never copied in) and carries
  // every station with its end state, so the consumer sees the whole plan,
  // not just the stations that produced a feature.
  const revisit =
    session.sessionType === 'revisit' && session.reference
      ? {
          survey_revisit: {
            reference_file: session.reference.filename,
            reference_hash: session.reference.hash,
            reference_session_id: session.reference.sessionId ?? null,
            reference_session_name: session.reference.sessionName ?? null,
            reference_started_at: session.reference.startedAt ?? null,
            stations: revisitStations ?? [],
          },
        }
      : {};

  return {
    type: 'FeatureCollection',
    // A foreign member (RFC 7946 §6.1): valid GeoJSON that GIS consumers
    // ignore, and the thing that makes an exported session importable with
    // fidelity — the feature properties carry everything about each
    // observation, but nothing else carries the session's own id and times.
    // Deliberately no exported-at timestamp: identical data must keep
    // producing identical bytes (canonical-json.js), so exports stay
    // reproducible and diffable.
    survey_session: {
      id: session.id,
      name: session.name,
      started_at: session.startedAt,
      ended_at: session.endedAt ?? null,
    },
    ...revisit,
    features,
  };
}
