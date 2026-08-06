import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from '../storage/db.js';
import { createCaptureService } from './captureService.js';
import { getPhoto } from '../storage/photoStore.js';
import { listObservationsForSession } from '../storage/observationStore.js';
import { newId as realNewId } from '../domain/id.js';

const FIXED_NOW = '2026-08-06T10:00:00.000Z';

function fakeIdGenerator(prefix = 'id') {
  let counter = 0;
  return () => `${prefix}-${counter++}`;
}

async function makeService(dbName, overrides = {}) {
  const db = await openDatabase(dbName);
  return createCaptureService({
    db,
    newId: overrides.newId ?? fakeIdGenerator(),
    nowIso: overrides.nowIso ?? (() => FIXED_NOW),
  });
}

const READING = {
  lat: 51.5,
  lon: -0.14,
  accuracyM: 8.2,
  altitudeM: null,
  altitudeAccuracyM: null,
  fixAt: '2026-08-06T09:59:40.000Z',
  fixAtMs: 1,
};

const HEADING = { headingDeg: 271.5, headingAccuracyDeg: 5, source: 'webkit-compass' };

describe('getOpenSession', () => {
  test('returns null on a fresh database', async () => {
    const service = await makeService('capture-service-fresh');
    expect(await service.getOpenSession()).toBeNull();
  });

  test('returns the session after startSession', async () => {
    const service = await makeService('capture-service-open');
    const session = await service.startSession('Ashton Keynes');
    expect(await service.getOpenSession()).toEqual(session);
  });

  test('returns null again after endSession', async () => {
    const service = await makeService('capture-service-open-close');
    await service.startSession('Ashton Keynes');
    await service.endSession();
    expect(await service.getOpenSession()).toBeNull();
  });
});

describe('listSessions', () => {
  test('returns an empty array on a fresh database', async () => {
    const service = await makeService('capture-service-list-sessions-empty');
    expect(await service.listSessions()).toEqual([]);
  });

  test('returns every session regardless of open/closed status', async () => {
    const service = await makeService('capture-service-list-sessions-all');
    const first = await service.startSession('Site A');
    await service.endSession();
    const second = await service.startSession('Site B');

    const sessions = await service.listSessions();

    expect(sessions.map((s) => s.id).sort()).toEqual([first.id, second.id].sort());
  });
});

describe('startSession', () => {
  test('persists an open session with the given name', async () => {
    const service = await makeService('capture-service-start');
    const session = await service.startSession('Ashton Keynes');
    expect(session).toMatchObject({ name: 'Ashton Keynes', status: 'open', startedAt: FIXED_NOW });
  });

  test('throws when a session is already open', async () => {
    const service = await makeService('capture-service-start-twice');
    await service.startSession('Ashton Keynes');
    await expect(service.startSession('Somewhere Else')).rejects.toThrow(/already open/);
  });

  test('throws on a blank name, delegated to createSession', async () => {
    const service = await makeService('capture-service-start-blank');
    await expect(service.startSession('  ')).rejects.toThrow(/name/i);
  });
});

describe('endSession', () => {
  test('sets endedAt and status closed', async () => {
    const service = await makeService('capture-service-end');
    await service.startSession('Ashton Keynes');
    const closed = await service.endSession();
    expect(closed.status).toBe('closed');
    expect(closed.endedAt).toBe(FIXED_NOW);
  });

  test('throws when no session is open', async () => {
    const service = await makeService('capture-service-end-none');
    await expect(service.endSession()).rejects.toThrow(/no open session/);
  });
});

describe('saveObservation', () => {
  test('throws when no session is open, and writes nothing', async () => {
    const db = await openDatabase('capture-service-save-no-session');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });

    await expect(
      service.saveObservation({ reading: READING, heading: null, note: '', photo: null }),
    ).rejects.toThrow(/no open session/);
    expect(await listObservationsForSession(db, 'anything')).toEqual([]);
  });

  test('throws when reading is null', async () => {
    const service = await makeService('capture-service-save-no-reading');
    await service.startSession('Ashton Keynes');
    await expect(
      service.saveObservation({ reading: null, heading: null, note: '', photo: null }),
    ).rejects.toThrow(/no position fix yet/);
  });

  test('saves an observation with no photo: photoId is null, no photo record written', async () => {
    const db = await openDatabase('capture-service-save-no-photo');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    await service.startSession('Ashton Keynes');

    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photo: null,
    });

    expect(obs.photoId).toBeNull();
    expect(await getPhoto(db, obs.id)).toBeUndefined();
  });

  test('saves an observation with a photo: photoId equals the observation id, blob round-trips', async () => {
    const db = await openDatabase('capture-service-save-with-photo');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    await service.startSession('Ashton Keynes');
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });

    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photo: { blob },
    });

    expect(obs.photoId).toBe(obs.id);
    const stored = await getPhoto(db, obs.id);
    expect(stored.contentType).toBe('image/jpeg');
    expect(await stored.blob.text()).toBe('fake jpeg bytes');
  });

  test('position-only (no heading): headingDeg and headingAccuracyDeg are null, save succeeds', async () => {
    const service = await makeService('capture-service-save-no-heading');
    await service.startSession('Ashton Keynes');

    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photo: null,
    });

    expect(obs.headingDeg).toBeNull();
    expect(obs.headingAccuracyDeg).toBeNull();
  });

  test('with heading: both fields are carried through', async () => {
    const service = await makeService('capture-service-save-with-heading');
    await service.startSession('Ashton Keynes');

    const obs = await service.saveObservation({
      reading: READING,
      heading: HEADING,
      note: '',
      photo: null,
    });

    expect(obs.headingDeg).toBe(271.5);
    expect(obs.headingAccuracyDeg).toBe(5);
  });

  test('trims the note', async () => {
    const service = await makeService('capture-service-save-note-trim');
    await service.startSession('Ashton Keynes');

    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '  gate post  ',
      photo: null,
    });

    expect(obs.note).toBe('gate post');
  });

  test('an undefined note becomes an empty string', async () => {
    const service = await makeService('capture-service-save-note-undefined');
    await service.startSession('Ashton Keynes');

    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: undefined,
      photo: null,
    });

    expect(obs.note).toBe('');
  });

  test('lands under the open session and is retrievable via listObservationsForSession', async () => {
    const db = await openDatabase('capture-service-save-session-link');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    const session = await service.startSession('Ashton Keynes');

    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photo: null,
    });

    expect(obs.sessionId).toBe(session.id);
    const listed = await listObservationsForSession(db, session.id);
    expect(listed.map((o) => o.id)).toEqual([obs.id]);
  });

  test('uses the fix time from the reading, not the save time, for fixAt', async () => {
    const service = await makeService('capture-service-save-fixat');
    await service.startSession('Ashton Keynes');

    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photo: null,
    });

    expect(obs.fixAt).toBe(READING.fixAt);
    expect(obs.recordedAt).toBe(FIXED_NOW);
  });

  test('two saves in the same millisecond get distinct, increasing ids (monotonic ULID contract)', async () => {
    const db = await openDatabase('capture-service-monotonic-ids');
    const service = createCaptureService({ db, newId: realNewId, nowIso: () => FIXED_NOW });
    await service.startSession('Ashton Keynes');

    const first = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photo: null,
    });
    const second = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photo: null,
    });

    expect(second.id).not.toBe(first.id);
    expect(second.id > first.id).toBe(true);
  });
});

describe('countObservations', () => {
  test('counts 0, then 1, then 3 after successive saves', async () => {
    const db = await openDatabase('capture-service-count');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    const session = await service.startSession('Ashton Keynes');

    expect(await service.countObservations(session.id)).toBe(0);
    await service.saveObservation({ reading: READING, heading: null, note: '', photo: null });
    expect(await service.countObservations(session.id)).toBe(1);
    await service.saveObservation({ reading: READING, heading: null, note: '', photo: null });
    await service.saveObservation({ reading: READING, heading: null, note: '', photo: null });
    expect(await service.countObservations(session.id)).toBe(3);
  });
});

describe('listObservations', () => {
  test('returns an empty array for a session with no observations', async () => {
    const db = await openDatabase('capture-service-list-empty');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    const session = await service.startSession('Ashton Keynes');

    expect(await service.listObservations(session.id)).toEqual([]);
  });

  test('returns the saved observations for that session', async () => {
    const db = await openDatabase('capture-service-list-populated');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    const session = await service.startSession('Ashton Keynes');

    const first = await service.saveObservation({
      reading: READING,
      heading: null,
      note: 'a',
      photo: null,
    });
    const second = await service.saveObservation({
      reading: READING,
      heading: null,
      note: 'b',
      photo: null,
    });

    const listed = await service.listObservations(session.id);
    expect(listed.map((o) => o.id).sort()).toEqual([first.id, second.id].sort());
  });

  test('does not return observations from a different session', async () => {
    const db = await openDatabase('capture-service-list-other-session');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    const sessionA = await service.startSession('Site A');
    await service.saveObservation({ reading: READING, heading: null, note: '', photo: null });
    await service.endSession();
    const sessionB = await service.startSession('Site B');

    expect(await service.listObservations(sessionB.id)).toEqual([]);
    expect(await service.listObservations(sessionA.id)).toHaveLength(1);
  });
});

describe('deleteObservation', () => {
  test('removes the observation and its photo', async () => {
    const db = await openDatabase('capture-service-delete');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    const session = await service.startSession('Ashton Keynes');
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });
    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photo: { blob },
    });

    await service.deleteObservation(obs.id);

    expect(await listObservationsForSession(db, session.id)).toEqual([]);
    expect(await getPhoto(db, obs.id)).toBeUndefined();
  });

  test('removes an observation with no photo cleanly', async () => {
    const db = await openDatabase('capture-service-delete-no-photo');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    const session = await service.startSession('Ashton Keynes');
    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photo: null,
    });

    await expect(service.deleteObservation(obs.id)).resolves.toBeUndefined();
    expect(await listObservationsForSession(db, session.id)).toEqual([]);
  });

  test('is idempotent — deleting an id that does not exist does not throw', async () => {
    const service = await makeService('capture-service-delete-missing');
    await expect(service.deleteObservation('nope')).resolves.toBeUndefined();
  });
});
