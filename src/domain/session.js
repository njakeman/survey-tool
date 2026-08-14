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

// The inverse, for loading a past session back into the capture interface.
// A continuation, not a reset: everything else on the record — the export
// stamps included — stays exactly as it was, so what already left the device
// still reads Exported and only observations captured after the reopen read
// Not exported. Ending again later just stamps a fresh endedAt.
export function reopenSession(session) {
  if (session.status === 'open') {
    throw new Error(`reopenSession: session ${session.id} is already open`);
  }
  return { ...session, endedAt: null, status: 'open' };
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

// Whether one observation was edited after the export that carried it —
// the export is then stale for this record, and the badge says so rather
// than lying "exported" or pretending the record never left. `changedAt` is
// stamped by the post-save edits (photo retake/delete/add, note edit); a
// completed re-export moves lastExportedAt past it, which resolves the
// state without ever clearing anything.
export function isChangedSinceExport(session, observation) {
  return (
    // Only an observation the export actually carried can be stale in it —
    // one recorded after the export and then edited is honestly still
    // "Not exported", not "Changed".
    isExported(session, observation) &&
    Boolean(observation.changedAt) &&
    observation.changedAt > session.lastExportedAt
  );
}

// The session-level twin, answerable from the session record alone (the
// list-row rule countUnexported follows): `changedSinceExportAt` is stamped
// alongside every observation `changedAt`, so history rows and the purge
// predicate can refuse to treat a stale export as complete without loading
// any observations.
export function hasChangedSinceExport(session) {
  return (
    Boolean(session?.lastExportedAt) &&
    Boolean(session.changedSinceExportAt) &&
    session.changedSinceExportAt > session.lastExportedAt
  );
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
