// Writes an observation and its optional photo and voice note in one
// IndexedDB transaction, so a kill mid-save can never leave an observation
// pointing at media that was never written.
//
// The blobs' arrayBuffer()s are awaited BEFORE the transaction opens. Awaiting
// a non-IndexedDB promise inside a live transaction lets the microtask queue
// drain and the browser auto-commit the transaction early, throwing
// InactiveTransactionError on the next store call. And per CLAUDE.md, only
// the ArrayBuffer is ever stored — never the Blob (see photoStore.js).

export async function saveObservationWithPhoto(db, { observation, photo = null, audio = null }) {
  const photoBuffer = photo ? await photo.blob.arrayBuffer() : null;
  const audioBuffer = audio ? await audio.blob.arrayBuffer() : null;

  const stores = ['observations', ...(photo ? ['photos'] : []), ...(audio ? ['audio'] : [])];
  const tx = db.transaction(stores, 'readwrite');
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
