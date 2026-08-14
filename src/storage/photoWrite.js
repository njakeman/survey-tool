// The post-save photo edits — retake, delete, add — each in one IndexedDB
// transaction over observations, photos and sessions, so a kill mid-edit can
// never leave an observation pointing at a photo that is gone (or vice
// versa). A retake writes a NEW photo record under a fresh id and deletes
// the old one: repointing photoId is what busts a row's cached object URL.
//
// Both writes stamp `changedAt` on the observation and `changedSinceExportAt`
// on its session — the marks isChangedSinceExport/hasChangedSinceExport
// (domain/session.js) compare against lastExportedAt so a stale export says
// so instead of lying "exported".
//
// The blob's arrayBuffer() is awaited BEFORE the transaction opens — same
// auto-commit hazard as captureWrite.js, and per CLAUDE.md only the
// ArrayBuffer is ever stored, never the Blob.

export async function setObservationPhoto(db, { observationId, photo, changedAt }) {
  const arrayBuffer = await photo.blob.arrayBuffer();
  const contentType = photo.contentType ?? photo.blob.type;

  const tx = db.transaction(['observations', 'photos', 'sessions'], 'readwrite');
  const observations = tx.objectStore('observations');
  const observation = await observations.get(observationId);
  if (!observation) {
    throw new Error(`setObservationPhoto: no observation with id ${observationId}`);
  }
  if (observation.photoId) {
    tx.objectStore('photos').delete(observation.photoId);
  }
  tx.objectStore('photos').put({ id: photo.id, arrayBuffer, contentType });
  observations.put({ ...observation, photoId: photo.id, changedAt });
  await stampSession(tx, observation.sessionId, changedAt);
  await tx.done;
}

export async function deleteObservationPhoto(db, observationId, changedAt) {
  const tx = db.transaction(['observations', 'photos', 'sessions'], 'readwrite');
  const observations = tx.objectStore('observations');
  const observation = await observations.get(observationId);
  if (!observation) {
    throw new Error(`deleteObservationPhoto: no observation with id ${observationId}`);
  }
  if (observation.photoId) {
    tx.objectStore('photos').delete(observation.photoId);
  }
  observations.put({ ...observation, photoId: null, changedAt });
  await stampSession(tx, observation.sessionId, changedAt);
  await tx.done;
}

async function stampSession(tx, sessionId, changedAt) {
  const sessions = tx.objectStore('sessions');
  const session = await sessions.get(sessionId);
  // A missing session is an orphaned observation — the edit itself still
  // stands, and there is no record to mark stale.
  if (session) {
    sessions.put({ ...session, changedSinceExportAt: changedAt });
  }
}
