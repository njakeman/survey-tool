// Writes an observation and its optional photo and voice note in one
// IndexedDB transaction, so a kill mid-save can never leave an observation
// pointing at media that was never written.
//
// The blobs' arrayBuffer()s are awaited BEFORE the transaction opens. Awaiting
// a non-IndexedDB promise inside a live transaction lets the microtask queue
// drain and the browser auto-commit the transaction early, throwing
// InactiveTransactionError on the next store call. And per CLAUDE.md, only
// the ArrayBuffer is ever stored — never the Blob (see photoStore.js).

import { draftVertexRange } from './traceDraftStore.js';

// `traceDraftId`: the finished trace draft this observation was built from.
// Its meta record and vertex range are deleted in the same transaction as
// the observation put, so a kill mid-save leaves either the draft
// (recoverable) or the observation — never both, never neither.
export async function saveObservationWithPhoto(
  db,
  { observation, photo = null, audio = null, traceDraftId = null },
) {
  const photoBuffer = photo ? await photo.blob.arrayBuffer() : null;
  const audioBuffer = audio ? await audio.blob.arrayBuffer() : null;

  const stores = [
    'observations',
    ...(photo ? ['photos'] : []),
    ...(audio ? ['audio'] : []),
    ...(traceDraftId ? ['traceDrafts', 'traceVertices'] : []),
  ];
  const tx = db.transaction(stores, 'readwrite');
  if (traceDraftId) {
    tx.objectStore('traceDrafts').delete(traceDraftId);
    tx.objectStore('traceVertices').delete(draftVertexRange(traceDraftId));
  }
  if (photo) {
    tx.objectStore('photos').put({
      id: photo.id,
      arrayBuffer: photoBuffer,
      contentType: photo.contentType,
    });
  }
  if (audio) {
    tx.objectStore('audio').put({
      id: audio.id,
      arrayBuffer: audioBuffer,
      contentType: audio.contentType,
    });
  }
  tx.objectStore('observations').put(observation);
  await tx.done;
}
