// Offline basemap archives: one record per region, keyed by its manifest id,
// holding the raw PMTiles bytes as an ArrayBuffer plus the metadata the
// download flow needs for update detection (etag/sizeBytes) and diagnostics
// (downloadedAt). ArrayBuffer, never a Blob — WebKit rejects Blob-in-IndexedDB
// in ephemeral/private sessions (see photoStore.js for the full story).
//
// Nothing here ever reads the store with values in bulk: every value is a
// multi-megabyte buffer, so listing regions reads keys only.

// Phase 4 stored a single archive under this fixed id, before regions had
// ids of their own. Left behind it matches no manifest entry and is invisible
// to the UI, so it would sit on the device forever.
const LEGACY_ID = 'basemap';

export function putBasemap(db, { id, arrayBuffer, etag, sizeBytes, downloadedAt }) {
  if (!id) {
    return Promise.reject(new Error('putBasemap: id is required — which region is this?'));
  }
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    return Promise.reject(
      new Error('putBasemap: archive bytes must be an ArrayBuffer, never a Blob'),
    );
  }
  return db.put('basemap', { id, arrayBuffer, etag, sizeBytes, downloadedAt });
}

export function getBasemap(db, id) {
  return db.get('basemap', id);
}

export function deleteBasemap(db, id) {
  return db.delete('basemap', id);
}

export async function listDownloadedIds(db) {
  return db.getAllKeys('basemap');
}

export function deleteLegacyBasemap(db) {
  return db.delete('basemap', LEGACY_ID);
}
