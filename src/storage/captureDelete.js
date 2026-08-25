// Deletes an observation and its photos and voice note in one IndexedDB
// transaction — the undo-path mirror of captureWrite.js: a kill between
// separate deletes would leave orphaned media nothing would ever collect.
// Same rule as captureWrite: every await inside the transaction is an
// IndexedDB operation — a foreign promise would let the transaction
// auto-commit early.

export async function deleteObservationWithPhoto(db, id) {
  const tx = db.transaction(['observations', 'photos', 'audio'], 'readwrite');
  const observation = await tx.objectStore('observations').get(id);
  if (observation) {
    tx.objectStore('observations').delete(id);
    for (const entry of observation.photos ?? []) tx.objectStore('photos').delete(entry.id);
    if (observation.audioId) tx.objectStore('audio').delete(observation.audioId);
  }
  await tx.done;
}
