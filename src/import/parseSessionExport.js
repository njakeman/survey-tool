import { createObservation } from '../domain/observation.js';
import { AUDIO_TYPE_BY_EXTENSION } from '../domain/audio.js';
import { midpointOnLine } from '../geo/lineMetrics.js';
import { polygonCentroid } from '../geo/centroid.js';

// The pure inverse of domain/geojson.js: zip entries (or a bare
// session.geojson) → a validated { session, observations, photos } ready to
// be written. Validation happens here, by running every feature back through
// createObservation, so a malformed file fails on the Import tap with a
// named reason — "Feature 3: lat 512 is not a finite in-range number" — and
// never as a corrupt record discovered later.
//
// Original ids are returned untouched. Import always writes a *copy* with
// freshly minted ids (importSession.js); the ids here exist only so photos
// can be joined to the observations that reference them.

const decoder = new TextDecoder();

// '<photoId>.jpg' → the id. photos[] since 2026-08-25; earlier exports
// carried one `photo` (and `ref_photo`) instead. Either way the bytes are
// joined below, in parseSessionExport, and any entry with no matching file
// in the zip is dropped rather than trusted — the mirror of export's
// "never claim a file the zip doesn't contain".
//
// A claim that isn't a filename at all is a different thing from one the zip
// cannot back: it fails the import by name. A foreign file's `"photo": 42`
// reached String.replace and died as "name.replace is not a function", which
// tells the surveyor nothing about the file they picked.
const stripJpg = (name) => name.replace(/\.jpg$/i, '');
function photoFilename(value, where) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error(`${where} must be a photo filename string (got ${value})`);
  }
  return value;
}
function photosFrom(props) {
  if (Array.isArray(props.photos)) {
    return props.photos.flatMap((entry, index) => {
      const filename = photoFilename(entry?.photo, `photos[${index}].photo`);
      return filename
        ? [{ id: stripJpg(filename), referencePhoto: entry.ref_photo ?? null, ...lensFrom(entry) }]
        : [];
    });
  }
  const filename = photoFilename(props.photo, 'photo');
  return filename ? [{ id: stripJpg(filename), referencePhoto: props.ref_photo ?? null }] : [];
}

// The lens per photo (2026-09-04), `?? null` for exports from before it
// existed; createObservation validates the values, so a hand-edited "14"
// fails by name rather than reaching the caption as text. Exported for
// parseReferenceExport.js, which reads the same keys onto a station's
// photo filenames.
export function lensFrom(entry) {
  return {
    focalLength35mm: entry?.focal_length_35mm ?? null,
    focalLengthMm: entry?.focal_length_mm ?? null,
    lensModel: entry?.lens ?? null,
  };
}

// Exported for parseReferenceExport.js, which shares this file's whole
// validation path — the reference parse must never fork what "a valid
// feature" means, or a zip that imports could fail to load as a reference.
export function parseCollection(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Could not import: session.geojson is not valid JSON');
  }
  if (parsed?.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
    throw new Error('Could not import: the file is not a GeoJSON FeatureCollection');
  }
  return parsed;
}

// Exports since format v2 carry the session as a foreign member; earlier
// zips carried only session_name on each feature, so name and times are
// reconstructed from the features themselves.
export function sessionFrom(collection) {
  const meta = collection.survey_session;
  if (meta?.name && meta?.started_at) {
    return { name: meta.name, startedAt: meta.started_at, endedAt: meta.ended_at ?? null };
  }

  const properties = collection.features.map((feature) => feature?.properties ?? {});
  const name = properties.find((props) => props.session_name)?.session_name;
  if (!name) {
    throw new Error(
      'Could not import: the file names no session (no survey_session, no session_name)',
    );
  }
  const fixTimes = properties
    .map((props) => props.fix_at)
    .filter(Boolean)
    .sort();
  const recordedTimes = properties
    .map((props) => props.recorded_at)
    .filter(Boolean)
    .sort();
  return {
    name,
    startedAt: fixTimes[0] ?? recordedTimes[0],
    endedAt: recordedTimes[recordedTimes.length - 1] ?? null,
  };
}

// Where a geometry stands when a foreign file carries no lat/lon
// properties: the same representative point the app itself would record —
// a line's distance-midpoint, a polygon's centroid.
function representativeFrom(geometry) {
  if (geometry?.type === 'LineString') return midpointOnLine(geometry.coordinates);
  if (geometry?.type === 'Polygon') return polygonCentroid(geometry);
  return null;
}

export function observationFrom(feature, index, sessionId) {
  const props = feature?.properties ?? {};
  const geometry = feature?.geometry ?? null;
  // A non-Point geometry is a trace and rides into the record, where
  // createObservation does all the shape validation; Point geometry stays
  // what it always was — a duplicate of lat/lon for GIS consumers.
  const traced = Boolean(geometry) && geometry.type !== 'Point';
  const coords = geometry?.coordinates ?? [];
  const fallback = traced ? representativeFrom(geometry) : { lat: coords[1], lon: coords[0] };
  try {
    return createObservation({
      id: props.obs_id ?? `feature-${index + 1}`,
      sessionId,
      recordedAt: props.recorded_at,
      fixAt: props.fix_at,
      // The properties are the exporter's authoritative copy; the geometry
      // duplicates them for GIS consumers. Fall back for foreign files.
      lat: props.lat ?? fallback?.lat,
      lon: props.lon ?? fallback?.lon,
      gpsAccuracyM: props.gps_accuracy_m,
      altitudeM: props.altitude_m ?? null,
      altitudeAccuracyM: props.altitude_accuracy_m ?? null,
      headingDeg: props.heading_deg ?? null,
      headingAccuracyDeg: props.heading_accuracy_deg ?? null,
      note: props.note ?? '',
      photos: photosFrom(props),
      audioId: props.audio ? props.audio.replace(/\.(webm|m4a)$/i, '') : null,
      audioDurationMs: props.audio_duration_ms ?? null,
      featureLayerId: props.feature_layer ?? null,
      featureId: props.feature_id ?? null,
      featureLabel: props.feature_label ?? null,
      // A non-Point geometry defaults to 'trace' rather than 'gps': a file
      // carrying a LineString but no position_source could only mean a
      // walked line, and createObservation rightly rejects 'gps' + geometry.
      positionSource: props.position_source ?? (traced ? 'trace' : 'gps'),
      geometry: traced ? geometry : null,
      // Which segments the exporter inferred rather than measured. Unlike
      // os_grid_ref/trace_length_m below, this does NOT restate the
      // geometry, so it must be read back, not re-derived.
      traceGaps: traced ? (props.trace_gaps ?? null) : null,
      // The revisit pairing key — a copy must keep saying which reference
      // station each observation revisited, or the longitudinal join breaks
      // on first re-import. `?? null` for every export from before the
      // field existed. Each photo's own referencePhoto rides in photos[]
      // above — createObservation validates the both-halves rule against
      // this field.
      referenceObservationId: props.ref_obs_id ?? null,
      // os_grid_ref is ignored: derived from lat/lon at export time, it
      // would only ever be re-derived, never stored. trace_length_m too —
      // both restate the geometry.
    });
  } catch (error) {
    throw new Error(`Could not import feature ${index + 1}: ${error.message}`, { cause: error });
  }
}

// entries: [{ name, data: Uint8Array }] as zipReader returns them. A bare
// .geojson import is the caller wrapping its bytes as a one-entry list.
export function parseSessionExport(entries) {
  const geojsonEntry = entries.find((entry) => entry.name === 'session.geojson');
  if (!geojsonEntry) {
    throw new Error('Could not import: no session.geojson inside — is this a session export?');
  }

  const collection = parseCollection(decoder.decode(geojsonEntry.data));
  const session = sessionFrom(collection);

  // Validated with a placeholder session id — import mints the real one.
  const observations = collection.features.map((feature, index) =>
    observationFrom(feature, index, 'imported'),
  );

  const photoBytes = new Map(
    entries
      .filter((entry) => /^photos\/.+\.jpg$/i.test(entry.name))
      .map((entry) => [entry.name.slice('photos/'.length).replace(/\.jpg$/i, ''), entry.data]),
  );
  const audioBytes = new Map(
    entries
      .filter((entry) => /^audio\/.+\.(webm|m4a)$/i.test(entry.name))
      .map((entry) => [
        entry.name.slice('audio/'.length).replace(/\.(webm|m4a)$/i, ''),
        {
          data: entry.data,
          contentType: AUDIO_TYPE_BY_EXTENSION[entry.name.split('.').pop().toLowerCase()],
        },
      ]),
  );

  // Drop (never null) any photo claim the zip cannot back with bytes, and
  // null an audio claim the same way; keep only the bytes some observation
  // actually references.
  const linked = observations.map((obs) => ({
    ...obs,
    photos: obs.photos.filter((entry) => photoBytes.has(entry.id)),
    audioId: obs.audioId && !audioBytes.has(obs.audioId) ? null : obs.audioId,
  }));
  const photos = linked.flatMap((obs) =>
    obs.photos.map((entry) => ({
      photoId: entry.id,
      data: photoBytes.get(entry.id),
      contentType: 'image/jpeg',
    })),
  );
  const audio = linked
    .filter((obs) => obs.audioId)
    .map((obs) => ({ audioId: obs.audioId, ...audioBytes.get(obs.audioId) }));

  return { session, observations: linked, photos, audio };
}
