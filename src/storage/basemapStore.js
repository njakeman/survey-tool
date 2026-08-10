// The offline basemap archive: one record, id 'basemap', holding the raw
// PMTiles bytes as an ArrayBuffer plus the metadata the download flow needs
// for update detection (etag/sizeBytes) and diagnostics (downloadedAt).
// ArrayBuffer, never a Blob — WebKit rejects Blob-in-IndexedDB in
// ephemeral/private sessions (see photoStore.js for the full story).

const BASEMAP_ID = 'basemap';

export function putBasemap(db, { id = BASEMAP_ID, arrayBuffer, etag, sizeBytes, downloadedAt }) {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    return Promise.reject(
      new Error('putBasemap: archive bytes must be an ArrayBuffer, never a Blob'),
    );
  }
  return db.put('basemap', { id, arrayBuffer, etag, sizeBytes, downloadedAt });
}

export function getBasemap(db) {
  return db.get('basemap', BASEMAP_ID);
}

export function deleteBasemap(db) {
  return db.delete('basemap', BASEMAP_ID);
}
