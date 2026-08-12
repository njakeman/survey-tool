import { describe, expect, test } from 'vitest';
import {
  createSession,
  closeSession,
  reopenSession,
  findOpenSession,
  isExported,
  countUnexported,
} from './session.js';

describe('createSession', () => {
  test('creates an open session with the given id, name and start time', () => {
    const session = createSession({
      id: 'sess-1',
      name: 'Ashton Keynes',
      startedAt: '2026-08-06T10:00:00.000Z',
    });
    expect(session).toEqual({
      id: 'sess-1',
      name: 'Ashton Keynes',
      startedAt: '2026-08-06T10:00:00.000Z',
      endedAt: null,
      status: 'open',
    });
  });

  test('throws when name is empty, since an unnamed session defeats the point of naming them', () => {
    expect(() =>
      createSession({ id: 'sess-1', name: '  ', startedAt: '2026-08-06T10:00:00.000Z' }),
    ).toThrow(/name/i);
  });

  test('throws when id is missing', () => {
    expect(() =>
      createSession({ name: 'Ashton Keynes', startedAt: '2026-08-06T10:00:00.000Z' }),
    ).toThrow(/id/i);
  });

  test('throws when startedAt is missing', () => {
    expect(() => createSession({ id: 'sess-1', name: 'Ashton Keynes' })).toThrow(/startedAt/i);
  });
});

describe('closeSession', () => {
  test('marks an open session closed with the given end time', () => {
    const open = createSession({
      id: 'sess-1',
      name: 'Ashton Keynes',
      startedAt: '2026-08-06T10:00:00.000Z',
    });
    const closed = closeSession(open, '2026-08-06T12:00:00.000Z');
    expect(closed).toEqual({
      id: 'sess-1',
      name: 'Ashton Keynes',
      startedAt: '2026-08-06T10:00:00.000Z',
      endedAt: '2026-08-06T12:00:00.000Z',
      status: 'closed',
    });
  });

  test('throws when closing an already-closed session, rather than silently re-closing it', () => {
    const open = createSession({
      id: 'sess-1',
      name: 'Ashton Keynes',
      startedAt: '2026-08-06T10:00:00.000Z',
    });
    const closed = closeSession(open, '2026-08-06T12:00:00.000Z');
    expect(() => closeSession(closed, '2026-08-06T13:00:00.000Z')).toThrow(/already closed/i);
  });

  test('does not mutate the session object passed in', () => {
    const open = createSession({
      id: 'sess-1',
      name: 'Ashton Keynes',
      startedAt: '2026-08-06T10:00:00.000Z',
    });
    closeSession(open, '2026-08-06T12:00:00.000Z');
    expect(open.status).toBe('open');
  });
});

describe('reopenSession', () => {
  function closedSession() {
    return closeSession(
      createSession({ id: 'sess-1', name: 'Ashton Keynes', startedAt: '2026-08-06T10:00:00.000Z' }),
      '2026-08-06T12:00:00.000Z',
    );
  }

  test('makes a closed session open again, clearing its end time', () => {
    const reopened = reopenSession(closedSession());

    expect(reopened).toEqual({
      id: 'sess-1',
      name: 'Ashton Keynes',
      startedAt: '2026-08-06T10:00:00.000Z',
      endedAt: null,
      status: 'open',
    });
  });

  test('keeps the export stamps intact, so old observations still read Exported', () => {
    // Reopening is a continuation, not a reset: what already left the device
    // has still left it, and only what is captured afterwards should read
    // Not exported.
    const exported = {
      ...closedSession(),
      lastExportedAt: '2026-08-06T12:00:00.000Z',
      lastExportCount: 3,
    };
    const reopened = reopenSession(exported);

    expect(reopened.lastExportedAt).toBe('2026-08-06T12:00:00.000Z');
    expect(reopened.lastExportCount).toBe(3);
  });

  test('throws when the session is already open, mirroring closeSession', () => {
    const open = createSession({
      id: 'sess-1',
      name: 'Ashton Keynes',
      startedAt: '2026-08-06T10:00:00.000Z',
    });
    expect(() => reopenSession(open)).toThrow(/already open/i);
  });

  test('does not mutate the session object passed in', () => {
    const closed = closedSession();
    reopenSession(closed);
    expect(closed.status).toBe('closed');
    expect(closed.endedAt).toBe('2026-08-06T12:00:00.000Z');
  });

  test('round-trips: a reopened session can be closed again with a fresh end time', () => {
    const again = closeSession(reopenSession(closedSession()), '2026-08-06T15:00:00.000Z');
    expect(again.status).toBe('closed');
    expect(again.endedAt).toBe('2026-08-06T15:00:00.000Z');
  });
});

describe('findOpenSession', () => {
  test('returns null when there are no sessions', () => {
    expect(findOpenSession([])).toBeNull();
  });

  test('returns the open session when there is exactly one', () => {
    const open = createSession({
      id: 'sess-1',
      name: 'Site A',
      startedAt: '2026-08-06T10:00:00.000Z',
    });
    const closed = closeSession(
      createSession({ id: 'sess-0', name: 'Site Z', startedAt: '2026-08-05T10:00:00.000Z' }),
      '2026-08-05T12:00:00.000Z',
    );
    expect(findOpenSession([closed, open])).toEqual(open);
  });

  test('returns null when every session is closed', () => {
    const closed = closeSession(
      createSession({ id: 'sess-1', name: 'Site A', startedAt: '2026-08-06T10:00:00.000Z' }),
      '2026-08-06T12:00:00.000Z',
    );
    expect(findOpenSession([closed])).toBeNull();
  });

  test('returns the session with the greatest id when more than one is open (data-integrity edge case)', () => {
    const older = createSession({
      id: 'sess-1',
      name: 'Site A',
      startedAt: '2026-08-06T09:00:00.000Z',
    });
    const newer = createSession({
      id: 'sess-2',
      name: 'Site B',
      startedAt: '2026-08-06T10:00:00.000Z',
    });
    expect(findOpenSession([newer, older])).toEqual(newer);
  });
});

describe('isExported / countUnexported', () => {
  const exportedSession = {
    id: 'sess-1',
    lastExportedAt: '2026-08-06T12:00:00.000Z',
    lastExportCount: 2,
  };

  test('an observation recorded before the last export has left the device', () => {
    expect(isExported(exportedSession, { recordedAt: '2026-08-06T11:00:00.000Z' })).toBe(true);
    expect(isExported(exportedSession, { recordedAt: '2026-08-06T12:00:00.000Z' })).toBe(true);
  });

  test('an observation recorded after the last export has not', () => {
    expect(isExported(exportedSession, { recordedAt: '2026-08-06T12:00:01.000Z' })).toBe(false);
  });

  test('nothing is exported from a session never exported (or absent)', () => {
    expect(isExported({ id: 's' }, { recordedAt: '2026-08-06T11:00:00.000Z' })).toBe(false);
    expect(isExported(null, { recordedAt: '2026-08-06T11:00:00.000Z' })).toBe(false);
  });

  test('countUnexported is the whole count before any export, the difference after', () => {
    expect(countUnexported({ id: 's' }, 5)).toBe(5);
    expect(countUnexported(exportedSession, 2)).toBe(0);
    expect(countUnexported(exportedSession, 5)).toBe(3);
  });

  test('never goes negative when an undo shrank the session after an export', () => {
    expect(countUnexported(exportedSession, 1)).toBe(0);
  });
});
