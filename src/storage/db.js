import { openDB } from 'idb';

export const DB_NAME = 'survey-tool';
export const DB_VERSION = 8;

// `name` is overridable so tests can open an isolated database per test
// instead of sharing state through the default name.
//
// The upgrade callback is guarded per version because real devices carry
// data from every version ever shipped — a v1 install must gain the new
// stores without its existing records being touched.
export function openDatabase(name = DB_NAME) {
  return openDB(name, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
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
        // Keyed by the observation's id, which photos gave up at v8: a
        // recording stays one per observation, so its id can be the
        // observation's, while photos deliberately became a list under ids
        // of their own.
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
      if (oldVersion < 7) {
        // Revisit mode. 'revisitReferences': the reference export's zip
        // bytes, one record per revisit session (ArrayBuffer, never a Blob —
        // see photoStore.js), keyed by the session so it lives and dies with
        // it. Written once at session start and never rewritten — mutable
        // facts live on the session record instead, the basemap-metadata
        // rule. 'revisitStations': the surveyor's explicit skip/no-access
        // claims, one record per [sessionId, refObsId] — done/to-do are
        // derived from observations (domain/revisit.js), never stamped here.
        db.createObjectStore('revisitReferences', { keyPath: 'sessionId' });
        db.createObjectStore('revisitStations', { keyPath: ['sessionId', 'refObsId'] });
      }
      if (oldVersion < 8) {
        // Multi-photo (2026-08-25): the single photoId/referencePhoto pair
        // becomes photos: [{ id, referencePhoto }]. Rewritten in the upgrade
        // transaction itself so no record ever exists in both shapes; the
        // photo records are untouched — only the pointer changes shape.
        // Cursor, not getAll: a long-lived device may hold thousands.
        //
        // A photoless row's referencePhoto is dropped: with no photo slot to
        // hang it on there is nowhere for it to live, and real devices do
        // hold such rows — pre-branch captureService stamped referencePhoto
        // whether or not the surveyor took a photo. Only a convenience
        // filename is lost; referenceObservationId, the key the longitudinal
        // join actually runs on, rides through untouched.
        //
        // Every migrated record still satisfies the domain: v7 already
        // refused a referencePhoto without a referenceObservationId, so a
        // migrated photos[] entry can only name a reference photo on a
        // record that also names its station — exactly what createObservation
        // demands of photos[i].referencePhoto today.
        //
        // idb calls this upgrade callback as a bare statement — it never
        // awaits or catches whatever this chain returns, and `openDB`
        // settles from the native open request instead. Without a terminal
        // .catch, a thrown error here (a cursor.update() DataError, a bug in
        // the rebuild) would float as an unhandled rejection while the
        // native versionchange transaction auto-commits whatever it had
        // already rewritten — openDatabase() would resolve "successfully"
        // over a half-migrated observations store. Aborting the transaction
        // instead rolls every rewrite back (the data stays at v7 intact) and
        // makes openDatabase() reject, so the app's fatal-error banner
        // surfaces the failure instead of it passing silently.
        const store = transaction.objectStore('observations');
        store
          .openCursor()
          .then(function step(cursor) {
            if (!cursor) return;
            const { photoId, referencePhoto, ...rest } = cursor.value;
            const photos = photoId ? [{ id: photoId, referencePhoto: referencePhoto ?? null }] : [];
            cursor.update({ ...rest, photos });
            return cursor.continue().then(step);
          })
          .catch((error) => {
            console.error('DB v8 upgrade failed — rolling back', error);
            try {
              transaction.abort();
            } catch {
              // Already finished (auto-committed, or aborted by the failure
              // itself) — there is nothing left to roll back, and throwing
              // here would replace the real error with a bookkeeping one.
            }
            // idb caches its own `transaction.done` promise the moment it
            // wraps this transaction to hand it to us — abort() rejects
            // that promise too, and idb never consumes it itself. Left
            // alone it surfaces as a second, unrelated unhandled rejection
            // alongside the one openDatabase()'s caller correctly sees.
            transaction.done.catch(() => {});
          });
      }
    },
  });
}
