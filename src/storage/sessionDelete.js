import { draftVertexRange } from './traceDraftStore.js';
import { stationStateRange } from './revisitStore.js';

// Deletes a session and everything that hangs off it — observations (via
// the by-session index), their photos and voice notes (reachable only
// through each observation's photoId/audioId, exactly as captureDelete.js
// reads them), any stale trace draft still pointing at the session
// (traceDrafts has no sessionId index, deliberately — one draft exists at a
// time in practice, so a getAll-and-filter costs nothing and saves a schema
// bump), and a revisit's reference bytes and station claims (both keyed by
// the session). One transaction: a kill between separate deletes would
// leave orphaned media, vertices or a multi-megabyte reference nothing
// would ever collect. Same rule as captureWrite.js — every await inside the
// transaction is an IndexedDB operation. Idempotent: a missing session
// deletes nothing and resolves.
export async function deleteSessionWithData(db, sessionId) {
  const tx = db.transaction(
    [
      'sessions',
      'observations',
      'photos',
      'audio',
      'traceDrafts',
      'traceVertices',
      'revisitReferences',
      'revisitStations',
    ],
    'readwrite',
  );

  const observations = await tx.objectStore('observations').index('by-session').getAll(sessionId);
  for (const observation of observations) {
    tx.objectStore('observations').delete(observation.id);
    if (observation.photoId) tx.objectStore('photos').delete(observation.photoId);
    if (observation.audioId) tx.objectStore('audio').delete(observation.audioId);
  }

  const drafts = await tx.objectStore('traceDrafts').getAll();
  for (const draft of drafts) {
    if (draft.sessionId !== sessionId) continue;
    tx.objectStore('traceDrafts').delete(draft.id);
    tx.objectStore('traceVertices').delete(draftVertexRange(draft.id));
  }

  tx.objectStore('revisitReferences').delete(sessionId);
  tx.objectStore('revisitStations').delete(stationStateRange(sessionId));

  tx.objectStore('sessions').delete(sessionId);
  await tx.done;
}
