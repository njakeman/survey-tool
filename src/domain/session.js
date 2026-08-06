// A survey session: an explicit, named span of time observations attach to.
// This is the sync commit boundary and the export unit (plan decision:
// explicit start/end, named). Pure record construction — id/timestamp
// generation and persistence live elsewhere (domain/id.js, storage/).

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

// The newest open session if more than one is somehow open (ULIDs sort
// chronologically, so the greatest id is the newest) — a surveyor in the
// field must not be blocked by a data-integrity assertion; the newest open
// session is the reasonable guess.
export function findOpenSession(sessions) {
  const open = sessions.filter((session) => session.status === 'open');
  if (open.length === 0) return null;
  return open.reduce((latest, session) => (session.id > latest.id ? session : latest));
}
