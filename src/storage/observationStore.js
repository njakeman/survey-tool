// CRUD over the 'observations' object store, plus the one sync-status
// transition (markObservationSynced) that Phase 5 needs. Takes an opened db
// as its first argument — see sessionStore.js for why.

export function putObservation(db, observation) {
  return db.put('observations', observation);
}

export function getObservation(db, id) {
  return db.get('observations', id);
}

export function listObservationsForSession(db, sessionId) {
  return db.getAllFromIndex('observations', 'by-session', sessionId);
}

export function deleteObservation(db, id) {
  return db.delete('observations', id);
}

export async function markObservationSynced(db, id, syncedAt) {
  const tx = db.transaction('observations', 'readwrite');
  const observation = await tx.store.get(id);
  if (!observation) {
    throw new Error(`markObservationSynced: no observation with id ${id}`);
  }
  await tx.store.put({ ...observation, synced: true, syncedAt });
  await tx.done;
}
