// Writes an observation and its optional photo in one IndexedDB transaction,
// so a kill mid-save can never leave an observation pointing at a photo that
// was never written (geojson.js emits `${photoId}.jpg` unconditionally).
//
// photo.blob.arrayBuffer() is awaited BEFORE the transaction opens. Awaiting
// a non-IndexedDB promise inside a live transaction lets the microtask queue
// drain and the browser auto-commit the transaction early, throwing
// InactiveTransactionError on the next store call. And per CLAUDE.md, only
// the ArrayBuffer is ever stored — never the Blob (see photoStore.js).

export async function saveObservationWithPhoto(db, { observation, photo = null }) {
  const arrayBuffer = photo ? await photo.blob.arrayBuffer() : null;

  const stores = photo ? ['photos', 'observations'] : ['observations'];
  const tx = db.transaction(stores, 'readwrite');
  if (photo) {
    tx.objectStore('photos').put({ id: photo.id, arrayBuffer, contentType: photo.contentType });
  }
  tx.objectStore('observations').put(observation);
  await tx.done;
}
