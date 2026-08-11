// Voice notes, stored exactly as photos are: ArrayBuffer + contentType,
// reconstructed into a Blob on read. Never store the Blob itself — WebKit
// rejects Blob-in-IndexedDB in ephemeral sessions (see photoStore.js for the
// full story; the rule is CLAUDE.md-level).
//
// contentType matters more here than for photos: photos are always JPEG, but
// a recording is whatever the device's MediaRecorder produced —
// audio/webm (Opus) on current Safari, audio/mp4 (AAC) on older — and the
// export's file extension and any future playback both derive from it.

export async function putAudio(db, { id, blob, contentType }) {
  const arrayBuffer = await blob.arrayBuffer();
  return db.put('audio', { id, arrayBuffer, contentType });
}

export function deleteAudio(db, id) {
  return db.delete('audio', id);
}

export async function getAudio(db, id) {
  const record = await db.get('audio', id);
  if (!record) return undefined;
  return {
    id: record.id,
    contentType: record.contentType,
    blob: new Blob([record.arrayBuffer], { type: record.contentType }),
  };
}
