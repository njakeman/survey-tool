// The in-progress trace: a meta record in 'traceDrafts' and one record per
// accepted vertex in 'traceVertices' (composite key [draftId, seq]), so a
// walk appends cheaply and a force-quit loses at most the vertex in flight.
// Takes an opened db as its first argument — see sessionStore.js for why.

// Every vertex of one draft, and nothing else: from [draftId] up to
// [draftId, []] — an empty array sorts above every number in IndexedDB key
// order, the standard upper sentinel for a composite-key range.
const draftRange = (draftId) => IDBKeyRange.bound([draftId], [draftId, []]);

export function putTraceDraft(db, draft) {
  return db.put('traceDrafts', draft);
}

export function listTraceDrafts(db) {
  return db.getAll('traceDrafts');
}

export function appendTraceVertex(db, draftId, vertex) {
  return db.put('traceVertices', { draftId, ...vertex });
}

// Ordered by seq — the composite key sorts within a draft by its second
// component, so this is walked order without an index.
export function listTraceVertices(db, draftId) {
  return db.getAll('traceVertices', draftRange(draftId));
}

// One transaction over both stores: the draft can never survive its
// vertices or vice versa. Idempotent — a missing draft is a no-op.
export async function deleteTraceDraft(db, draftId) {
  const tx = db.transaction(['traceDrafts', 'traceVertices'], 'readwrite');
  tx.objectStore('traceDrafts').delete(draftId);
  tx.objectStore('traceVertices').delete(draftRange(draftId));
  await tx.done;
}
