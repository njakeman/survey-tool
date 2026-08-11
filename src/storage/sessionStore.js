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

// The one write export is allowed to make: when it was last exported, and
// how many observations that export carried. Everything the Exported badge
// shows derives from these two fields (domain/session.js) — observations and
// photos are never touched, and nothing is ever cleared.
export async function markSessionExported(db, id, { exportedAt, observationCount }) {
  const session = await db.get('sessions', id);
  if (!session) return;
  await db.put('sessions', {
    ...session,
    lastExportedAt: exportedAt,
    lastExportCount: observationCount,
  });
}
