import { openDB } from 'idb';

export const DB_NAME = 'survey-tool';
export const DB_VERSION = 1;

// `name` is overridable so tests can open an isolated database per test
// instead of sharing state through the default name.
export function openDatabase(name = DB_NAME) {
  return openDB(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('sessions', { keyPath: 'id' });

      const observations = db.createObjectStore('observations', { keyPath: 'id' });
      observations.createIndex('by-session', 'sessionId');

      db.createObjectStore('photos', { keyPath: 'id' });
    },
  });
}
