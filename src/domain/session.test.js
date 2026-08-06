import { describe, expect, test } from 'vitest';
import { createSession, closeSession } from './session.js';

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
