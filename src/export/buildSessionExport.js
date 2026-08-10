import { getSession } from '../storage/sessionStore.js';
import { listObservationsForSession } from '../storage/observationStore.js';
import { getPhoto } from '../storage/photoStore.js';
import { sessionToFeatureCollection } from '../domain/geojson.js';
import { canonicalStringify } from '../domain/canonical-json.js';

// Assembles the data for a session export — GeoJSON text + photo Blobs, as
// {name, input} entries ready for a zip step (client-zip's own entry shape,
// kept separate from the actual zipping so this half stays node-testable
// with fake-indexeddb, no browser deps).
function slugify(name) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'session';
}

export async function buildSessionExport(db, { sessionId, appVersion }) {
  const session = await getSession(db, sessionId);
  if (!session) {
    throw new Error(`buildSessionExport: no session with id ${sessionId}`);
  }

  const observations = await listObservationsForSession(db, sessionId);

  // Photos are resolved before the GeoJSON is serialised so the two can't
  // disagree: an orphan photoId (record missing) is skipped rather than
  // failing the export, and the feature's `photo` property is nulled to
  // match — the zip must never claim a file it doesn't contain.
  const photoEntries = [];
  const presentPhotoIds = new Set();
  for (const obs of observations) {
    if (!obs.photoId) continue;
    const photo = await getPhoto(db, obs.photoId);
    if (!photo) continue;
    presentPhotoIds.add(obs.photoId);
    photoEntries.push({ name: `photos/${obs.photoId}.jpg`, input: photo.blob });
  }

  const exportObservations = observations.map((obs) =>
    obs.photoId && !presentPhotoIds.has(obs.photoId) ? { ...obs, photoId: null } : obs,
  );
  const geojsonText = canonicalStringify(
    sessionToFeatureCollection(session, exportObservations, { appVersion }),
  );

  const entries = [{ name: 'session.geojson', input: geojsonText }, ...photoEntries];

  const dateStr = session.startedAt.slice(0, 10); // YYYY-MM-DD
  const filename = `${slugify(session.name)}-${dateStr}.zip`;

  return { filename, entries };
}
