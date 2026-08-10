// Deletes an observation and its photo in one IndexedDB transaction — the
// undo-path mirror of captureWrite.js: a kill between separate deletes would
// leave an orphaned photo blob nothing would ever collect. Same rule as
// captureWrite: every await inside the transaction is an IndexedDB
// operation — a foreign promise would let the transaction auto-commit early.

export async function deleteObservationWithPhoto(db, id) {
  const tx = db.transaction(['observations', 'photos'], 'readwrite');
  const observation = await tx.objectStore('observations').get(id);
  if (observation) {
    tx.objectStore('observations').delete(id);
    if (observation.photoId) tx.objectStore('photos').delete(observation.photoId);
  }
  await tx.done;
}
