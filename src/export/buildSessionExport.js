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
  const geojsonText = canonicalStringify(
    sessionToFeatureCollection(session, observations, { appVersion }),
  );

  const entries = [{ name: 'session.geojson', input: geojsonText }];

  for (const obs of observations) {
    if (!obs.photoId) continue;
    const photo = await getPhoto(db, obs.photoId);
    if (!photo) continue; // orphan reference — skip rather than fail the whole export
    entries.push({ name: `photos/${obs.photoId}.jpg`, input: photo.blob });
  }

  const dateStr = session.startedAt.slice(0, 10); // YYYY-MM-DD
  const filename = `${slugify(session.name)}-${dateStr}.zip`;

  return { filename, entries };
}
