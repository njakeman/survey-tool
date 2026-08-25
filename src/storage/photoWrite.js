// The post-save photo edits — add, replace, delete — each in one IndexedDB
// transaction over observations, photos and sessions, so a kill mid-edit can
// never leave an observation pointing at a photo record that is gone (or
// vice versa). An add appends a new slot; a replace writes a NEW record
// under a fresh id in the same slot — the fresh id is what busts a row's
// cached object URL — and deletes the old record; a delete drops the slot
// and its record outright.
//
// All three stamp `changedAt` on the observation and `changedSinceExportAt`
// on its session — the marks isChangedSinceExport/hasChangedSinceExport
// (domain/session.js) compare against lastExportedAt so a stale export says
// so instead of lying "exported".
//
// A blob's arrayBuffer() is awaited BEFORE the transaction opens — same
// auto-commit hazard as captureWrite.js, and per CLAUDE.md only the
// ArrayBuffer is ever stored, never the Blob.

async function readObservation(observations, observationId, fn) {
  const observation = await observations.get(observationId);
  if (!observation) {
    throw new Error(`${fn}: no observation with id ${observationId}`);
  }
  return observation;
}

export async function addObservationPhoto(db, { observationId, photo, changedAt }) {
  const arrayBuffer = await photo.blob.arrayBuffer();
  const contentType = photo.contentType ?? photo.blob.type;

  const tx = db.transaction(['observations', 'photos', 'sessions'], 'readwrite');
  const observations = tx.objectStore('observations');
  const observation = await readObservation(observations, observationId, 'addObservationPhoto');
  tx.objectStore('photos').put({ id: photo.id, arrayBuffer, contentType });
  observations.put({
    ...observation,
    photos: [...(observation.photos ?? []), { id: photo.id, referencePhoto: null }],
    changedAt,
  });
  await stampSession(tx, observation.sessionId, changedAt);
  await tx.done;
}

export async function replaceObservationPhoto(db, { observationId, photoId, photo, changedAt }) {
  const arrayBuffer = await photo.blob.arrayBuffer();
  const contentType = photo.contentType ?? photo.blob.type;

  const tx = db.transaction(['observations', 'photos', 'sessions'], 'readwrite');
  const observations = tx.objectStore('observations');
  const observation = await readObservation(observations, observationId, 'replaceObservationPhoto');
  const photos = observation.photos ?? [];
  const index = photos.findIndex((entry) => entry.id === photoId);
  if (index === -1) {
    throw new Error(
      `replaceObservationPhoto: photo ${photoId} is not attached to ${observationId}`,
    );
  }
  tx.objectStore('photos').delete(photoId);
  tx.objectStore('photos').put({ id: photo.id, arrayBuffer, contentType });
  const nextPhotos = photos.slice();
  nextPhotos[index] = { ...photos[index], id: photo.id };
  observations.put({ ...observation, photos: nextPhotos, changedAt });
  await stampSession(tx, observation.sessionId, changedAt);
  await tx.done;
}

export async function deleteObservationPhoto(db, { observationId, photoId, changedAt }) {
  const tx = db.transaction(['observations', 'photos', 'sessions'], 'readwrite');
  const observations = tx.objectStore('observations');
  const observation = await readObservation(observations, observationId, 'deleteObservationPhoto');
  const photos = observation.photos ?? [];
  if (!photos.some((entry) => entry.id === photoId)) {
    throw new Error(`deleteObservationPhoto: photo ${photoId} is not attached to ${observationId}`);
  }
  tx.objectStore('photos').delete(photoId);
  observations.put({
    ...observation,
    photos: photos.filter((entry) => entry.id !== photoId),
    changedAt,
  });
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
