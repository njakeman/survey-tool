// Feature layers: the surveyor's own GIS data, drawn over the basemap. One
// record per layer, keyed by its manifest id, holding the GeoJSON plus what
// the fetch flow needs for update detection (etag/sizeBytes) and diagnostics
// (fetchedAt).
//
// The GeoJSON is a **string**, never a parsed object and never a Blob. A
// FeatureCollection is deeply nested, and structured-cloning it on every read
// costs more than a single JSON.parse at the point of use; the string is also
// the smaller record. Blob is out for the reason it is out everywhere in this
// app — WebKit rejects Blob-in-IndexedDB in ephemeral sessions (photoStore.js).
//
// Unlike `basemap`, these values are kilobytes rather than megabytes, so
// reading one is cheap. Listing still reads keys only: nothing is gained by
// deserialising every feature of every layer to render a list of names.

export function putFeatureLayer(db, { id, geojson, etag, sizeBytes, fetchedAt }) {
  if (!id) {
    return Promise.reject(new Error('putFeatureLayer: id is required — which layer is this?'));
  }
  if (typeof geojson !== 'string') {
    return Promise.reject(
      new Error('putFeatureLayer: geojson must be a string, never a Blob or a parsed object'),
    );
  }
  return db.put('featureLayers', { id, geojson, etag, sizeBytes, fetchedAt });
}

export function getFeatureLayer(db, id) {
  return db.get('featureLayers', id);
}

export function deleteFeatureLayer(db, id) {
  return db.delete('featureLayers', id);
}

export function listStoredIds(db) {
  return db.getAllKeys('featureLayers');
}
