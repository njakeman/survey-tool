import { openDB } from 'idb';

export const DB_NAME = 'survey-tool';
export const DB_VERSION = 6;

// `name` is overridable so tests can open an isolated database per test
// instead of sharing state through the default name.
//
// The upgrade callback is guarded per version because real devices carry
// data from every version ever shipped — a v1 install must gain the new
// stores without its existing records being touched.
export function openDatabase(name = DB_NAME) {
  return openDB(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('sessions', { keyPath: 'id' });

        const observations = db.createObjectStore('observations', { keyPath: 'id' });
        observations.createIndex('by-session', 'sessionId');

        db.createObjectStore('photos', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        // Phase 4: the offline basemap archives (PMTiles bytes as an
        // ArrayBuffer — never a Blob, see photoStore.js). One record per
        // region, keyed by its manifest id.
        db.createObjectStore('basemap', { keyPath: 'id' });
      }
      if (oldVersion < 3) {
        // Small key/value settings — currently which basemap region is
        // selected. Deliberately not a field on the archive records: those
        // hold multi-megabyte buffers, and updating a selection flag would
        // mean reading and rewriting one.
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (oldVersion < 4) {
        // The surveyor's own GIS data, drawn over the basemap: one record per
        // layer, GeoJSON held as a string (featureLayerStore.js). Separate
        // from `basemap` because these are kilobytes fetched in one shot, not
        // megabytes read through Range requests, and several are enabled at
        // once rather than one being selected.
        db.createObjectStore('featureLayers', { keyPath: 'id' });
      }
      if (oldVersion < 5) {
        // Voice notes: one recording per observation, ArrayBuffer +
        // contentType exactly like photos (never a Blob — see photoStore.js).
        // Keyed by the observation's id, same convention as photos.
        db.createObjectStore('audio', { keyPath: 'id' });
      }
      if (oldVersion < 6) {
        // An in-progress trace: one meta record per draft, and one record
        // per thinned vertex so each append is O(1) — a force-quit mid-walk
        // must lose at most the vertex in flight, and rewriting one growing
        // record would cost O(n²) cumulative bytes over a long trace. This
        // pair is the single deliberate carve-out from the no-watch-
        // persistence rule; only trace recording ever writes here.
        db.createObjectStore('traceDrafts', { keyPath: 'id' });
        db.createObjectStore('traceVertices', { keyPath: ['draftId', 'seq'] });
      }
    },
  });
}
