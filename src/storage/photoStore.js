// Photos are stored as an ArrayBuffer, not a Blob — storing a Blob directly
// (top-level or nested) throws in WebKit ("Error preparing Blob/File data to
// be stored in object store"; confirmed empirically against real WebKit via
// Playwright, Chromium is unaffected). ArrayBuffer round-trips cleanly on
// both. The Blob/ArrayBuffer split is kept internal to this module — callers
// still work with Blobs.

export async function putPhoto(db, { id, blob, contentType }) {
  const arrayBuffer = await blob.arrayBuffer();
  return db.put('photos', { id, arrayBuffer, contentType });
}

export async function getPhoto(db, id) {
  const record = await db.get('photos', id);
  if (!record) return undefined;
  return {
    id: record.id,
    contentType: record.contentType,
    blob: new Blob([record.arrayBuffer], { type: record.contentType }),
  };
}
