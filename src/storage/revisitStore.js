// Revisit-mode storage: the reference export's bytes (one record per
// revisit session) and the surveyor's explicit station claims. Takes an
// opened db as its first argument — see sessionStore.js for why.
//
// The reference record is immutable and never listed with values (always a
// get by session id) — the basemapStore rules for multi-megabyte buffers.
// Station states hold only skip/no-access claims; done and to-do are
// derived from observations by domain/revisit.js, so the pairing and the
// state can never disagree.

function assertArrayBuffer(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    throw new Error(
      'putSessionWithReference: reference bytes must be an ArrayBuffer, never a Blob — ' +
        'WebKit rejects Blobs in IndexedDB in ephemeral sessions (see photoStore.js)',
    );
  }
}

// The session and its reference land together or not at all: a revisit
// session existing without its reference bytes would open into the degraded
// "reference missing" state on its very first capture screen.
export async function putSessionWithReference(db, { session, referenceRecord }) {
  assertArrayBuffer(referenceRecord.arrayBuffer);
  const tx = db.transaction(['sessions', 'revisitReferences'], 'readwrite');
  tx.objectStore('sessions').put(session);
  tx.objectStore('revisitReferences').put(referenceRecord);
  await tx.done;
}

// Single-record writer, mainly for tests and repair paths — the app writes
// references through putSessionWithReference.
export function putReference(db, referenceRecord) {
  assertArrayBuffer(referenceRecord.arrayBuffer);
  return db.put('revisitReferences', referenceRecord);
}

export function getReference(db, sessionId) {
  return db.get('revisitReferences', sessionId);
}

// Every claim of one session, and nothing else: from [sessionId] up to
// [sessionId, []] — the draftVertexRange sentinel idiom. Exported for
// sessionDelete.js, which clears a session's claims inside its transaction.
export const stationStateRange = (sessionId) => IDBKeyRange.bound([sessionId], [sessionId, []]);

export function putStationState(db, record) {
  return db.put('revisitStations', record);
}

// Deleting the claim is the Undo: with no record and no paired observation
// the station derives back to to-do, nothing to clear anywhere else.
export function deleteStationState(db, sessionId, refObsId) {
  return db.delete('revisitStations', [sessionId, refObsId]);
}

export function listStationStates(db, sessionId) {
  return db.getAll('revisitStations', stationStateRange(sessionId));
}
