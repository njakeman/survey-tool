// A survey session: an explicit, named span of time observations attach to.
// This is the export and import unit (plan decision: explicit start/end,
// named). Pure record construction — id/timestamp generation and persistence
// live elsewhere (domain/id.js, storage/).

export function createSession({ id, name, startedAt }) {
  if (!id) throw new Error('createSession: id is required');
  if (!name || !name.trim()) throw new Error('createSession: name is required');
  if (!startedAt) throw new Error('createSession: startedAt is required');

  return {
    id,
    name,
    startedAt,
    endedAt: null,
    status: 'open',
  };
}

export function closeSession(session, endedAt) {
  if (session.status === 'closed') {
    throw new Error(`closeSession: session ${session.id} is already closed`);
  }
  return { ...session, endedAt, status: 'closed' };
}

// Whether one observation has left the device in some export. Sessions
// record when they were last exported and how many observations that export
// carried (sessionStore.markSessionExported); an observation was in it iff
// it had been recorded by then — plain string comparison, both are ISO-8601
// UTC. New saves after an export honestly read as not exported.
export function isExported(session, observation) {
  return Boolean(session?.lastExportedAt) && observation.recordedAt <= session.lastExportedAt;
}

// How many of a session's observations have never left the device, from the
// record alone — no per-observation writes, no loading every observation to
// answer a list-row question. Conservative on the odd edges (an undo after
// an export makes the count disagree and the session read unexported, which
// errs toward re-exporting — the export is idempotent, so that costs a tap).
export function countUnexported(session, observationCount) {
  if (!session?.lastExportedAt) return observationCount;
  return Math.max(0, observationCount - (session.lastExportCount ?? 0));
}

// The newest open session if more than one is somehow open (ULIDs sort
// chronologically, so the greatest id is the newest) — a surveyor in the
// field must not be blocked by a data-integrity assertion; the newest open
// session is the reasonable guess.
export function findOpenSession(sessions) {
  const open = sessions.filter((session) => session.status === 'open');
  if (open.length === 0) return null;
  return open.reduce((latest, session) => (session.id > latest.id ? session : latest));
}
