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

describe('countObservations', () => {
  test('counts without loading the observations themselves', async () => {
    // A session's observations carry notes and metadata; the history list
    // needs integers, not records. Counting through the index keeps a long
    // session's rows out of memory entirely.
    const db = await openDatabase('capture-service-count-cheap');
    const loaded = [];
    const trackingDb = new Proxy(db, {
      get(target, prop) {
        if (prop === 'getAllFromIndex') {
          return (...args) => {
            loaded.push(args[0]);
            return target.getAllFromIndex(...args);
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const service = createCaptureService({
      db: trackingDb,
      newId: fakeIdGenerator(),
      nowIso: () => FIXED_NOW,
    });
    const session = await service.startSession('Ashton Keynes');
    for (let i = 0; i < 3; i += 1) {
      await service.saveObservation({ reading: READING, heading: null, note: 'x', photo: null });
    }
    loaded.length = 0;

    expect(await service.countObservations(session.id)).toBe(3);

    expect(loaded).toEqual([]);
  });

  test('is zero for a session with nothing saved', async () => {
    const service = await makeService('capture-service-count-empty');
    const session = await service.startSession('Empty');
    expect(await service.countObservations(session.id)).toBe(0);
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

  test('deletes the observation and its photo in one transaction, so a kill mid-delete cannot orphan the photo', async () => {
    const db = await openDatabase('capture-service-delete-atomic');
    // Every idb one-shot convenience call (db.get/db.delete/…) opens its own
    // implicit transaction, so record those alongside explicit
    // db.transaction() calls: the delete must show up as exactly one
    // transaction spanning both stores.
    const oneShotMethods = new Set(['get', 'getAll', 'getAllFromIndex', 'put', 'add', 'delete']);
    const opened = [];
    const trackingDb = new Proxy(db, {
      get(target, prop) {
        if (prop === 'transaction') {
          return (storeNames, ...rest) => {
            opened.push([].concat(storeNames).sort());
            return target.transaction(storeNames, ...rest);
          };
        }
        if (oneShotMethods.has(prop)) {
          return (storeName, ...rest) => {
            opened.push([storeName]);
            return target[prop](storeName, ...rest);
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const service = createCaptureService({
      db: trackingDb,
      newId: fakeIdGenerator(),
      nowIso: () => FIXED_NOW,
    });
    await service.startSession('Ashton Keynes');
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });
    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photo: { blob },
    });

    opened.length = 0;
    await service.deleteObservation(obs.id);

    expect(opened).toEqual([['audio', 'observations', 'photos']]);
  });
});

describe('saveObservation — a point picked off the map', () => {
  const PICKED = { lat: 51.51, lon: -0.12, accuracyM: 12 };
  // Deliberately carries an altitude, unlike READING: a picked point must
  // drop it, and a fixture with none could not tell the difference.
  const READING_WITH_ALTITUDE = { ...READING, altitudeM: 45.2, altitudeAccuracyM: 3 };

  async function pickedSave(dbName, overrides = {}) {
    const service = await makeService(dbName);
    await service.startSession('Ashton Keynes');
    return service.saveObservation({
      reading: READING_WITH_ALTITUDE,
      heading: null,
      note: '',
      photo: null,
      pickedPoint: PICKED,
      ...overrides,
    });
  }

  test('records the picked coordinates, not the surveyor own fix', async () => {
    const observation = await pickedSave('capture-picked-coords');

    expect(observation.lat).toBe(PICKED.lat);
    expect(observation.lon).toBe(PICKED.lon);
  });

  test('takes its accuracy from the pick, which is a map precision not a fix', async () => {
    const observation = await pickedSave('capture-picked-accuracy');

    expect(observation.gpsAccuracyM).toBe(12);
  });

  test('marks the position as coming from the map', async () => {
    const observation = await pickedSave('capture-picked-source');

    expect(observation.positionSource).toBe('map');
  });

  test('drops altitude rather than claiming the surveyor own height', async () => {
    // The far side of a valley is not at the height you are standing at, and
    // an altitude carried across would be the one number nobody would think
    // to doubt.
    const observation = await pickedSave('capture-picked-altitude');

    expect(observation.altitudeM).toBeNull();
    expect(observation.altitudeAccuracyM).toBeNull();
  });

  test('keeps fixAt and the heading, because the sighting was made from the fix', async () => {
    const observation = await pickedSave('capture-picked-provenance', { heading: HEADING });

    expect(observation.fixAt).toBe(READING.fixAt);
    expect(observation.headingDeg).toBe(HEADING.headingDeg);
  });

  test('still refuses to save without a fix', async () => {
    // Picking a point does not make the surveyor position irrelevant: an
    // observation with no fixAt has no provenance at all.
    const service = await makeService('capture-picked-no-fix');
    await service.startSession('Ashton Keynes');

    await expect(
      service.saveObservation({ reading: null, heading: null, note: '', pickedPoint: PICKED }),
    ).rejects.toThrow(/no position fix/i);
  });

  test('an ordinary save keeps the fix and is marked as GPS', async () => {
    const observation = await pickedSave('capture-picked-none', { pickedPoint: null });

    expect(observation.positionSource).toBe('gps');
    expect(observation.lat).toBe(READING.lat);
    expect(observation.altitudeM).toBe(45.2);
  });
});

describe('trace drafts', () => {
  const TRACE = {
    draftId: 'id-1',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-0.14, 51.5],
        [-0.141, 51.501],
      ],
    },
    representative: { lat: 51.5005, lon: -0.1405 },
    gpsAccuracyM: 12,
    fixAt: '2026-08-06T09:40:00.000Z',
  };

  test('startTraceDraft requires an open session', async () => {
    const service = await makeService('capture-trace-no-session');

    await expect(service.startTraceDraft({ mode: 'path' })).rejects.toThrow(/no open session/i);
  });

  test('a draft and its vertices round-trip through getTraceDraft', async () => {
    const service = await makeService('capture-trace-roundtrip');
    await service.startSession('Ashton Keynes');

    const draft = await service.startTraceDraft({ mode: 'boundary' });
    expect(draft).toMatchObject({ mode: 'boundary', startedAt: FIXED_NOW });

    await service.appendTraceVertex(draft.id, { seq: 0, lat: 51.5, lon: -0.14, accuracyM: 5, fixAt: 't0' });
    await service.appendTraceVertex(draft.id, { seq: 1, lat: 51.501, lon: -0.14, accuracyM: 7, fixAt: 't1' });

    const recovered = await service.getTraceDraft();
    expect(recovered.draft).toEqual(draft);
    expect(recovered.vertices.map((v) => v.seq)).toEqual([0, 1]);
  });

  test('getTraceDraft is null when nothing is in progress', async () => {
    const service = await makeService('capture-trace-none');

    expect(await service.getTraceDraft()).toBeNull();
  });

  test('discardTraceDraft removes the draft and its vertices', async () => {
    const service = await makeService('capture-trace-discard');
    await service.startSession('Ashton Keynes');
    const draft = await service.startTraceDraft({ mode: 'path' });
    await service.appendTraceVertex(draft.id, { seq: 0, lat: 51.5, lon: -0.14, accuracyM: 5, fixAt: 't0' });

    await service.discardTraceDraft(draft.id);

    expect(await service.getTraceDraft()).toBeNull();
  });

  test('saving a trace builds the observation from the walk, not the live fix', async () => {
    const service = await makeService('capture-trace-save');
    await service.startSession('Ashton Keynes');
    const draft = await service.startTraceDraft({ mode: 'path' });

    const observation = await service.saveObservation({
      reading: READING,
      heading: HEADING,
      note: 'hedgerow, north field',
      trace: { ...TRACE, draftId: draft.id },
    });

    expect(observation.positionSource).toBe('trace');
    expect(observation.geometry).toEqual(TRACE.geometry);
    expect(observation.lat).toBe(TRACE.representative.lat);
    expect(observation.lon).toBe(TRACE.representative.lon);
    expect(observation.gpsAccuracyM).toBe(TRACE.gpsAccuracyM);
    // The trace fixAt is when measurement began, not the current fix.
    expect(observation.fixAt).toBe(TRACE.fixAt);
    // Neither the surveyor altitude nor their heading belongs to a walked line.
    expect(observation.altitudeM).toBeNull();
    expect(observation.headingDeg).toBeNull();
    expect(observation.note).toBe('hedgerow, north field');
  });

  test('the draft is gone after a trace save', async () => {
    const service = await makeService('capture-trace-save-clears');
    await service.startSession('Ashton Keynes');
    const draft = await service.startTraceDraft({ mode: 'path' });
    await service.appendTraceVertex(draft.id, { seq: 0, lat: 51.5, lon: -0.14, accuracyM: 5, fixAt: 't0' });

    await service.saveObservation({ reading: READING, heading: null, note: '', trace: { ...TRACE, draftId: draft.id } });

    expect(await service.getTraceDraft()).toBeNull();
  });

  test('a trace can be saved without a live fix - the walk is its own provenance', async () => {
    // After a relaunch recovery the watch may not have a fix yet; the trace
    // vertices already carry every timestamp and position that matters.
    const service = await makeService('capture-trace-no-reading');
    await service.startSession('Ashton Keynes');
    const draft = await service.startTraceDraft({ mode: 'path' });

    const observation = await service.saveObservation({
      reading: null,
      heading: null,
      note: '',
      trace: { ...TRACE, draftId: draft.id },
    });

    expect(observation.positionSource).toBe('trace');
  });
});
