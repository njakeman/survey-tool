// CRUD over the 'sessions' object store. Takes an opened db (see db.js) as
// its first argument rather than a module-level singleton, so tests can pass
// an isolated database instead of sharing state.

export function putSession(db, session) {
  return db.put('sessions', session);
}

export function getSession(db, id) {
  return db.get('sessions', id);
}

export function listSessions(db) {
  return db.getAll('sessions');
}
