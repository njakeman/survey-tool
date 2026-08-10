import { openDB } from 'idb';

export const DB_NAME = 'survey-tool';
export const DB_VERSION = 2;

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
        // Phase 4: the offline basemap archive (PMTiles bytes as an
        // ArrayBuffer — never a Blob, see photoStore.js).
        db.createObjectStore('basemap', { keyPath: 'id' });
      }
    },
  });
}
