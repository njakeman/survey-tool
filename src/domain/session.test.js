import { describe, expect, test } from 'vitest';
import { createSession, closeSession, findOpenSession } from './session.js';

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
