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

// Counts through the index rather than materialising the records: the
// history list wants integers, and a long session's notes and metadata have
// no business being read to produce one.
export function countObservationsForSession(db, sessionId) {
  return db.countFromIndex('observations', 'by-session', sessionId);
}

export function deleteObservation(db, id) {
  return db.delete('observations', id);
}

// The note, amendable after saving. A read-modify-write in a single
// transaction, and a missing id throws rather than upserting — editing is
// only ever offered on a row that exists, so a miss is a bug worth hearing
// about, not a record worth inventing. When `changedAt` is given the edit
// also stamps the change marks (observation.changedAt +
// session.changedSinceExportAt) that flag a stale export — same pair as
// photoWrite.js.
export async function updateObservationNote(db, id, note, changedAt = null) {
  const stores = changedAt ? ['observations', 'sessions'] : ['observations'];
  const tx = db.transaction(stores, 'readwrite');
  const observations = tx.objectStore('observations');
  const observation = await observations.get(id);
  if (!observation) {
    throw new Error(`updateObservationNote: no observation with id ${id}`);
  }
  observations.put(changedAt ? { ...observation, note, changedAt } : { ...observation, note });
  if (changedAt) {
    const sessions = tx.objectStore('sessions');
    const session = await sessions.get(observation.sessionId);
    if (session) {
      sessions.put({ ...session, changedSinceExportAt: changedAt });
    }
  }
  await tx.done;
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
