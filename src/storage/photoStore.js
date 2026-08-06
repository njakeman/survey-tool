// Photos are stored as an ArrayBuffer, not a Blob — storing a Blob directly
// (top-level or nested) throws in WebKit with "Error preparing Blob/File
// data to be stored in object store". Confirmed via research: real Safari
// has supported Blob-in-IndexedDB since 2016, but WebKit deliberately
// rejects it in ephemeral/private-browsing sessions (writing blob bytes to a
// temp file conflicts with private mode's on-disk-nothing guarantee) — and
// that's the session type both Playwright's default WebKit context and
// actual Safari Private Browsing use. Since an installed PWA's users could
// genuinely hit Private Browsing too, this isn't just a test artifact to
// route around — ArrayBuffer sidesteps the restriction entirely and is the
// standard recommended pattern. See CLAUDE.md: never store a Blob directly
// in IndexedDB anywhere in this app.

export async function putPhoto(db, { id, blob, contentType }) {
  const arrayBuffer = await blob.arrayBuffer();
  return db.put('photos', { id, arrayBuffer, contentType });
}

export function deletePhoto(db, id) {
  return db.delete('photos', id);
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
