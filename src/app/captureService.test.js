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
    // Ending an empty session discards it, so the closed one needs a record.
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
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

describe('endSession — a session with nothing recorded is discarded', () => {
  // User decision (2026-08-14): an empty session is a mistaken start, not a
  // record. Ending it deletes it — one transaction via deleteSessionWithData,
  // so an abandoned trace draft cannot orphan either. Note the accepted
  // consequence: reopening a pre-fix empty closed session and ending it
  // again discards it, export stamps included — there is nothing in it for
  // the stamps to describe.
  test('ending at zero observations resolves discarded and removes the session', async () => {
    const db = await openDatabase('capture-service-end-discard');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    const session = await service.startSession('Mistaken start');

    const result = await service.endSession();

    expect(result.discarded).toBe(true);
    expect(result.session.id).toBe(session.id);
    expect(await db.get('sessions', session.id)).toBeUndefined();
    expect(await service.listSessions()).toEqual([]);
  });

  test('an abandoned trace draft goes with the discarded session', async () => {
    const db = await openDatabase('capture-service-end-discard-draft');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    await service.startSession('Mistaken start');
    const draft = await service.startTraceDraft({ mode: 'path' });
    await service.appendTraceVertex(draft.id, { lat: 51.5, lon: -0.14, accuracyM: 8, seq: 0 });

    const result = await service.endSession();

    expect(result.discarded).toBe(true);
    expect(await db.get('traceDrafts', draft.id)).toBeUndefined();
    expect(await db.getAll('traceVertices')).toEqual([]);
  });

  test('a session with observations closes as ever, and says so', async () => {
    const service = await makeService('capture-service-end-kept');
    await service.startSession('Real work');
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });

    const result = await service.endSession();

    expect(result.discarded).toBe(false);
    expect(result.session.status).toBe('closed');
    expect(result.session.endedAt).toBe(FIXED_NOW);
    expect((await service.listSessions()).map(({ id }) => id)).toEqual([result.session.id]);
  });
});

describe('endSession', () => {
  // The closed status/endedAt happy path lives in the discard describe above
  // ("a session with observations closes as ever").
  test('throws when no session is open', async () => {
    const service = await makeService('capture-service-end-none');
    await expect(service.endSession()).rejects.toThrow(/no open session/);
  });
});

describe('reopenSession', () => {
  test('makes a past session the open one again, ready to capture into', async () => {
    const service = await makeService('capture-service-reopen');
    const session = await service.startSession('Ashton Keynes');
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
    await service.endSession();

    const reopened = await service.reopenSession(session.id);

    expect(reopened.status).toBe('open');
    expect(reopened.endedAt).toBeNull();
    expect(await service.getOpenSession()).toEqual(reopened);

    // The whole point: new observations attach to the reopened session.
    const observation = await service.saveObservation({
      reading: READING,
      heading: null,
      note: 'back again',
      photos: [],
    });
    expect(observation.sessionId).toBe(session.id);
  });

  test('a reopened session can be ended again with a fresh end time', async () => {
    let now = FIXED_NOW;
    const service = await makeService('capture-service-reopen-end', { nowIso: () => now });
    const session = await service.startSession('Ashton Keynes');
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
    await service.endSession();

    await service.reopenSession(session.id);
    now = '2026-08-06T15:00:00.000Z';
    const { session: closed } = await service.endSession();

    expect(closed.endedAt).toBe('2026-08-06T15:00:00.000Z');
  });

  test('refuses while another session is open — reopening must never steal capture', async () => {
    // findOpenSession silently prefers the newest open session, so a reopen
    // that skipped this check would not error: the surveyor's live session
    // would just stop receiving observations.
    const service = await makeService('capture-service-reopen-busy');
    const past = await service.startSession('Site A');
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
    await service.endSession();
    await service.startSession('Site B');

    await expect(service.reopenSession(past.id)).rejects.toThrow(/already open/i);
    expect((await service.getOpenSession()).name).toBe('Site B');
  });

  test('throws on an unknown session id', async () => {
    const service = await makeService('capture-service-reopen-unknown');
    await expect(service.reopenSession('no-such-session')).rejects.toThrow(/no session/i);
  });

  test('keeps the export stamps, so exported observations still read Exported', async () => {
    const db = await openDatabase('capture-service-reopen-exported');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    const session = await service.startSession('Ashton Keynes');
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
    await service.endSession();
    const stored = await db.get('sessions', session.id);
    await db.put('sessions', {
      ...stored,
      lastExportedAt: '2026-08-06T12:00:00.000Z',
      lastExportCount: 2,
    });

    const reopened = await service.reopenSession(session.id);

    expect(reopened.lastExportedAt).toBe('2026-08-06T12:00:00.000Z');
    expect(reopened.lastExportCount).toBe(2);
  });
});

describe('deleteSession', () => {
  test('deletes a past session with everything it holds', async () => {
    const db = await openDatabase('capture-service-delete-session');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    const session = await service.startSession('Ashton Keynes');
    await service.saveObservation({ reading: READING, heading: null, note: 'gate', photos: [] });
    await service.endSession();

    await service.deleteSession(session.id);

    expect(await service.listSessions()).toEqual([]);
    expect(await listObservationsForSession(db, session.id)).toEqual([]);
  });

  test('refuses to delete the currently open session', async () => {
    // History never lists the open session, but the service must not trust
    // the UI: deleting live capture out from under the mounted CapturePage
    // is the one unrecoverable case.
    const service = await makeService('capture-service-delete-open');
    const session = await service.startSession('Ashton Keynes');

    await expect(service.deleteSession(session.id)).rejects.toThrow(/open/i);
    expect(await service.getOpenSession()).toBeTruthy();
  });

  test('deleting a past session while a different one is open is fine', async () => {
    const service = await makeService('capture-service-delete-other-open');
    const past = await service.startSession('Site A');
    await service.endSession();
    await service.startSession('Site B');

    await service.deleteSession(past.id);

    expect((await service.listSessions()).map((s) => s.name)).toEqual(['Site B']);
  });
});

describe('deleteExportedSessions', () => {
  async function makeDbService(dbName) {
    const db = await openDatabase(dbName);
    return {
      db,
      service: createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW }),
    };
  }

  async function stampExported(db, sessionId, count) {
    const stored = await db.get('sessions', sessionId);
    await db.put('sessions', {
      ...stored,
      lastExportedAt: '2026-08-06T12:00:00.000Z',
      lastExportCount: count,
    });
  }

  test('deletes only closed sessions whose every observation has been exported', async () => {
    const { db, service } = await makeDbService('capture-service-purge');
    const exported = await service.startSession('Fully exported');
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
    await service.endSession();
    await stampExported(db, exported.id, 1);

    const partial = await service.startSession('Partly exported');
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
    await service.endSession();
    await stampExported(db, partial.id, 1); // one of two exported

    const never = await service.startSession('Never exported');
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
    await service.endSession();

    const result = await service.deleteExportedSessions();

    expect(result).toEqual({ deletedCount: 1 });
    const remaining = (await service.listSessions()).map((s) => s.id);
    expect(remaining.sort()).toEqual([never.id, partial.id].sort());
  });

  test('never touches the open session, even a fully exported one', async () => {
    const { db, service } = await makeDbService('capture-service-purge-open');
    const open = await service.startSession('Live');
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
    await stampExported(db, open.id, 1);

    const result = await service.deleteExportedSessions();

    expect(result).toEqual({ deletedCount: 0 });
    expect(await service.getOpenSession()).toBeTruthy();
  });

  test('with nothing eligible, deletes nothing and reports zero', async () => {
    const service = await makeService('capture-service-purge-empty');
    await service.startSession('Only session');
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
    await service.endSession();

    expect(await service.deleteExportedSessions()).toEqual({ deletedCount: 0 });
    expect(await service.listSessions()).toHaveLength(1);
  });

  test('refuses a session edited after its export — the export on disk is stale', async () => {
    const { db, service } = await makeDbService('capture-service-purge-changed');
    const session = await service.startSession('Edited after export');
    const saved = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [],
    });
    await service.endSession();
    await stampExported(db, session.id, 1);
    // The edit lands after the export stamp (FIXED_NOW < the stamp, so use a
    // later service clock for the edit itself).
    const later = createCaptureService({
      db,
      newId: fakeIdGenerator('late'),
      nowIso: () => '2026-08-06T13:00:00.000Z',
    });
    await later.updateNote(saved.id, 'amended');

    expect(await service.deleteExportedSessions()).toEqual({ deletedCount: 0 });
    expect(await service.listSessions()).toHaveLength(1);
  });
});

describe('updateNote', () => {
  test('replaces a saved observation note, trimmed the same way a save trims it', async () => {
    const service = await makeService('capture-service-update-note');
    await service.startSession('Ashton Keynes');
    const saved = await service.saveObservation({
      reading: READING,
      heading: null,
      note: 'gate post',
      photos: [],
    });

    await service.updateNote(saved.id, '  hinge broken  ');

    const [observation] = await service.listObservations(saved.sessionId);
    expect(observation.note).toBe('hinge broken');
  });

  test('treats a cleared field as an empty note, like a save would', async () => {
    const service = await makeService('capture-service-update-note-clear');
    await service.startSession('Ashton Keynes');
    const saved = await service.saveObservation({
      reading: READING,
      heading: null,
      note: 'wrong field',
      photos: [],
    });

    await service.updateNote(saved.id, null);

    const [observation] = await service.listObservations(saved.sessionId);
    expect(observation.note).toBe('');
  });

  test('rejects on an unknown observation id', async () => {
    const service = await makeService('capture-service-update-note-missing');
    await expect(service.updateNote('nope', 'anything')).rejects.toThrow(/nope/);
  });

  test('stamps the change marks, so an export made before the edit reads stale', async () => {
    const service = await makeService('capture-service-update-note-changed');
    const session = await service.startSession('Ashton Keynes');
    const saved = await service.saveObservation({
      reading: READING,
      heading: null,
      note: 'gate post',
      photos: [],
    });

    await service.updateNote(saved.id, 'hinge broken');

    const [observation] = await service.listObservations(session.id);
    expect(observation.changedAt).toBe(FIXED_NOW);
    const [stored] = await service.listSessions();
    expect(stored.changedSinceExportAt).toBe(FIXED_NOW);
  });
});

describe('addPhoto / replacePhoto / deletePhoto — the post-save photo edits', () => {
  const JPEG = () => new Blob(['retaken jpeg'], { type: 'image/jpeg' });

  test('addPhoto attaches a new photo under a fresh id and stamps the change marks', async () => {
    const service = await makeService('capture-service-add-photo');
    const session = await service.startSession('Ashton Keynes');
    const saved = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [{ blob: new Blob(['first jpeg'], { type: 'image/jpeg' }) }],
    });

    await service.addPhoto(saved.id, { blob: JPEG() });

    const [observation] = await service.listObservations(session.id);
    expect(observation.photos).toHaveLength(2);
    expect(observation.photos[0].id).toBe(saved.photos[0].id);
    expect(observation.changedAt).toBe(FIXED_NOW);
    const photo = await service.getPhoto(observation.photos[1].id);
    expect(await photo.blob.text()).toBe('retaken jpeg');
  });

  test('replacePhoto swaps a photo record in place under a fresh id and stamps the change marks', async () => {
    const service = await makeService('capture-service-replace-photo');
    const session = await service.startSession('Ashton Keynes');
    const saved = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [{ blob: new Blob(['first jpeg'], { type: 'image/jpeg' }) }],
    });
    const originalPhotoId = saved.photos[0].id;

    await service.replacePhoto(saved.id, originalPhotoId, { blob: JPEG() });

    const [observation] = await service.listObservations(session.id);
    expect(observation.photos).toHaveLength(1);
    expect(observation.photos[0].id).not.toBe(originalPhotoId);
    expect(observation.changedAt).toBe(FIXED_NOW);
    // The old record is gone; the new one reads back.
    expect(await service.getPhoto(originalPhotoId)).toBeUndefined();
    const photo = await service.getPhoto(observation.photos[0].id);
    expect(await photo.blob.text()).toBe('retaken jpeg');
  });

  test('deletePhoto clears one photo, deletes its record and stamps the marks', async () => {
    const service = await makeService('capture-service-delete-photo');
    const session = await service.startSession('Ashton Keynes');
    const saved = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [{ blob: JPEG() }],
    });
    const photoId = saved.photos[0].id;

    await service.deletePhoto(saved.id, photoId);

    const [observation] = await service.listObservations(session.id);
    expect(observation.photos).toEqual([]);
    expect(observation.changedAt).toBe(FIXED_NOW);
    expect(await service.getPhoto(photoId)).toBeUndefined();
    const [stored] = await service.listSessions();
    expect(stored.changedSinceExportAt).toBe(FIXED_NOW);
  });

  test('add, then replace, then delete leave the photos in the right order with the kept reference pairing', async () => {
    const service = await makeService('capture-service-photo-lifecycle');
    const session = await service.startSession('Ashton Keynes');
    const saved = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [
        { blob: new Blob(['first'], { type: 'image/jpeg' }), referencePhoto: 'r1.jpg' },
        { blob: new Blob(['second'], { type: 'image/jpeg' }) },
      ],
      station: { referenceObservationId: 'ref-9' },
    });
    const [firstId, secondId] = saved.photos.map((p) => p.id);

    // Append a third.
    await service.addPhoto(saved.id, { blob: new Blob(['third'], { type: 'image/jpeg' }) });
    let [observation] = await service.listObservations(session.id);
    expect(observation.photos).toHaveLength(3);
    const thirdId = observation.photos[2].id;

    // Replace the first (the one with the reference pairing) in place.
    await service.replacePhoto(saved.id, firstId, {
      blob: new Blob(['first retaken'], { type: 'image/jpeg' }),
    });
    [observation] = await service.listObservations(session.id);
    expect(observation.photos).toHaveLength(3);
    const replacedFirstId = observation.photos[0].id;
    // Order preserved: replaced-first, second, third.
    expect(observation.photos.map((p) => p.id)).toEqual([replacedFirstId, secondId, thirdId]);
    // The reference pairing survives the replace.
    expect(observation.photos[0].referencePhoto).toBe('r1.jpg');
    // The old record for the replaced slot is gone.
    expect(await service.getPhoto(firstId)).toBeUndefined();
    const replacedPhoto = await service.getPhoto(replacedFirstId);
    expect(await replacedPhoto.blob.text()).toBe('first retaken');

    // Delete the middle one.
    await service.deletePhoto(saved.id, secondId);
    [observation] = await service.listObservations(session.id);
    expect(observation.photos.map((p) => p.id)).toEqual([replacedFirstId, thirdId]);
    expect(await service.getPhoto(secondId)).toBeUndefined();
  });
});

describe('getPhoto', () => {
  test('returns a saved photo as { id, contentType, blob } for its own id', async () => {
    const service = await makeService('capture-service-get-photo');
    await service.startSession('Ashton Keynes');
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });
    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [{ blob }],
    });

    const record = await service.getPhoto(obs.photos[0].id);
    expect(record.id).toBe(obs.photos[0].id);
    expect(record.contentType).toBe('image/jpeg');
    expect(await record.blob.text()).toBe('fake jpeg bytes');
  });

  test('resolves undefined for an id with no photo', async () => {
    const service = await makeService('capture-service-get-photo-missing');
    expect(await service.getPhoto('nope')).toBeUndefined();
  });
});

describe('saveObservation', () => {
  test('throws when no session is open, and writes nothing', async () => {
    const db = await openDatabase('capture-service-save-no-session');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });

    await expect(
      service.saveObservation({ reading: READING, heading: null, note: '', photos: [] }),
    ).rejects.toThrow(/no open session/);
    expect(await listObservationsForSession(db, 'anything')).toEqual([]);
  });

  test('throws when reading is null', async () => {
    const service = await makeService('capture-service-save-no-reading');
    await service.startSession('Ashton Keynes');
    await expect(
      service.saveObservation({ reading: null, heading: null, note: '', photos: [] }),
    ).rejects.toThrow(/no position fix yet/);
  });

  test('saves an observation with no photos: photos is empty, no photo record written', async () => {
    const db = await openDatabase('capture-service-save-no-photo');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    await service.startSession('Ashton Keynes');

    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [],
    });

    expect(obs.photos).toEqual([]);
    expect(await getPhoto(db, obs.id)).toBeUndefined();
  });

  test('saves an observation with a photo: the photo id is fresh (not the observation id), blob round-trips', async () => {
    const db = await openDatabase('capture-service-save-with-photo');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    await service.startSession('Ashton Keynes');
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });

    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [{ blob }],
    });

    expect(obs.photos).toHaveLength(1);
    expect(obs.photos[0].id).not.toBe(obs.id);
    const stored = await getPhoto(db, obs.photos[0].id);
    expect(stored.contentType).toBe('image/jpeg');
    expect(await stored.blob.text()).toBe('fake jpeg bytes');
  });

  test('saves several photos with fresh ids and per-photo reference pairing', async () => {
    const jpeg = (text) => new Blob([text], { type: 'image/jpeg' });
    const service = await makeService('capture-service-save-multi-photo');
    await service.startSession('2026-08-21', {
      reference: {
        filename: 'ref.zip',
        hash: 'a'.repeat(64),
        sessionId: 'ref-sess-1',
        sessionName: 'Ref',
        startedAt: '2025-04-12T09:00:00.000Z',
        stationCount: 1,
        photoCount: 1,
      },
      referenceBuffer: new Uint8Array([0x50, 0x4b, 3, 4]).buffer,
    });

    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [{ blob: jpeg('a'), referencePhoto: 'r1.jpg' }, { blob: jpeg('b') }],
      station: { referenceObservationId: 'ref-1' },
    });

    expect(obs.photos).toHaveLength(2);
    expect(obs.photos[0].id).not.toBe(obs.id);
    expect(obs.photos[0].referencePhoto).toBe('r1.jpg');
    expect(obs.photos[1].referencePhoto).toBeNull();
    expect(await service.getPhoto(obs.photos[1].id)).toBeDefined();
  });

  test('a voice note save carries its measured duration onto the record', async () => {
    // The recorder measures durationMs at stop; keeping it on the observation
    // is what lets a list row say 0:12 without loading the blob.
    const service = await makeService('capture-service-save-audio-duration');
    await service.startSession('Ashton Keynes');

    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [],
      audio: { blob: new Blob(['opus bytes'], { type: 'audio/webm' }), durationMs: 12_400 },
    });

    expect(obs.audioId).toBe(obs.id);
    expect(obs.audioDurationMs).toBe(12_400);
  });

  test('position-only (no heading): headingDeg and headingAccuracyDeg are null, save succeeds', async () => {
    const service = await makeService('capture-service-save-no-heading');
    await service.startSession('Ashton Keynes');

    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [],
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
      photos: [],
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
      photos: [],
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
      photos: [],
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
      photos: [],
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
      photos: [],
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
      photos: [],
    });
    const second = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [],
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
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
    expect(await service.countObservations(session.id)).toBe(1);
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
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
      photos: [],
    });
    const second = await service.saveObservation({
      reading: READING,
      heading: null,
      note: 'b',
      photos: [],
    });

    const listed = await service.listObservations(session.id);
    expect(listed.map((o) => o.id).sort()).toEqual([first.id, second.id].sort());
  });

  test('does not return observations from a different session', async () => {
    const db = await openDatabase('capture-service-list-other-session');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    const sessionA = await service.startSession('Site A');
    await service.saveObservation({ reading: READING, heading: null, note: '', photos: [] });
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
      await service.saveObservation({ reading: READING, heading: null, note: 'x', photos: [] });
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
      photos: [{ blob }],
    });

    await service.deleteObservation(obs.id);

    expect(await listObservationsForSession(db, session.id)).toEqual([]);
    expect(await getPhoto(db, obs.photos[0].id)).toBeUndefined();
  });

  test('removes an observation with no photo cleanly', async () => {
    const db = await openDatabase('capture-service-delete-no-photo');
    const service = createCaptureService({ db, newId: fakeIdGenerator(), nowIso: () => FIXED_NOW });
    const session = await service.startSession('Ashton Keynes');
    const obs = await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      photos: [],
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
      photos: [{ blob }],
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
      photos: [],
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

    await service.appendTraceVertex(draft.id, {
      seq: 0,
      lat: 51.5,
      lon: -0.14,
      accuracyM: 5,
      fixAt: 't0',
    });
    await service.appendTraceVertex(draft.id, {
      seq: 1,
      lat: 51.501,
      lon: -0.14,
      accuracyM: 7,
      fixAt: 't1',
    });

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
    await service.appendTraceVertex(draft.id, {
      seq: 0,
      lat: 51.5,
      lon: -0.14,
      accuracyM: 5,
      fixAt: 't0',
    });

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
    await service.appendTraceVertex(draft.id, {
      seq: 0,
      lat: 51.5,
      lon: -0.14,
      accuracyM: 5,
      fixAt: 't0',
    });

    await service.saveObservation({
      reading: READING,
      heading: null,
      note: '',
      trace: { ...TRACE, draftId: draft.id },
    });

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

describe('revisit sessions', () => {
  const REFERENCE = {
    filename: 'long-barrow-2025-04-12.zip',
    hash: 'a'.repeat(64),
    sessionId: 'ref-sess-1',
    sessionName: 'Long Barrow south',
    startedAt: '2025-04-12T09:00:00.000Z',
    stationCount: 2,
    photoCount: 1,
  };
  const BUFFER = new Uint8Array([0x50, 0x4b, 3, 4]).buffer;

  test('startSession with a reference opens a revisit session and stores the bytes with it', async () => {
    const service = await makeService('capture-service-revisit-start');

    const session = await service.startSession('2026-08-21', {
      reference: REFERENCE,
      referenceBuffer: BUFFER,
    });

    expect(session.sessionType).toBe('revisit');
    expect(session.reference).toEqual(REFERENCE);
    const stored = await service.getReferenceRecord(session.id);
    expect(stored.arrayBuffer.byteLength).toBe(4);
    expect(stored.filename).toBe('long-barrow-2025-04-12.zip');
  });

  test('a reference without its bytes is refused — the record must never exist without them', async () => {
    const service = await makeService('capture-service-revisit-no-buffer');

    await expect(service.startSession('2026-08-21', { reference: REFERENCE })).rejects.toThrow(
      /referenceBuffer/,
    );
    expect(await service.getOpenSession()).toBeNull();
  });

  test('plain startSession still opens an ordinary survey', async () => {
    const service = await makeService('capture-service-revisit-plain');

    const session = await service.startSession('Ashton Keynes');

    expect(session.sessionType).toBe('survey');
    expect(session.reference).toBeNull();
  });

  test('discarding an empty revisit removes the reference bytes too', async () => {
    const service = await makeService('capture-service-revisit-discard');
    const session = await service.startSession('2026-08-21', {
      reference: REFERENCE,
      referenceBuffer: BUFFER,
    });

    const { discarded } = await service.endSession();

    expect(discarded).toBe(true);
    expect(await service.getReferenceRecord(session.id)).toBeUndefined();
  });

  test('saveObservation carries the station pairing onto the record', async () => {
    const service = await makeService('capture-service-revisit-save');
    await service.startSession('2026-08-21', { reference: REFERENCE, referenceBuffer: BUFFER });

    const observation = await service.saveObservation({
      reading: READING,
      heading: null,
      note: 'stile still standing',
      photos: [{ blob: new Blob(['jpeg'], { type: 'image/jpeg' }), referencePhoto: 'ref-4.jpg' }],
      station: { referenceObservationId: 'ref-4' },
    });

    expect(observation.referenceObservationId).toBe('ref-4');
    expect(observation.photos[0].referencePhoto).toBe('ref-4.jpg');
  });

  test('without a station, a save in a revisit is simply a new observation', async () => {
    const service = await makeService('capture-service-revisit-save-new');
    await service.startSession('2026-08-21', { reference: REFERENCE, referenceBuffer: BUFFER });

    const observation = await service.saveObservation({
      reading: READING,
      heading: null,
      note: 'fallen ash',
      photos: [],
    });

    expect(observation.referenceObservationId).toBeNull();
  });

  test('station claims write, list and clear against the open session', async () => {
    const service = await makeService('capture-service-revisit-claims');
    const session = await service.startSession('2026-08-21', {
      reference: REFERENCE,
      referenceBuffer: BUFFER,
    });

    await service.setStationState('ref-2', 'skipped');
    await service.setStationState('ref-3', 'noAccess', 'field flooded');

    const states = await service.listStationStates(session.id);
    expect(states).toEqual([
      {
        sessionId: session.id,
        refObsId: 'ref-2',
        state: 'skipped',
        reason: null,
        updatedAt: FIXED_NOW,
      },
      {
        sessionId: session.id,
        refObsId: 'ref-3',
        state: 'noAccess',
        reason: 'field flooded',
        updatedAt: FIXED_NOW,
      },
    ]);

    await service.clearStationState('ref-2');

    expect((await service.listStationStates(session.id)).map((r) => r.refObsId)).toEqual(['ref-3']);
  });

  test('a station claim with no open session is refused', async () => {
    const service = await makeService('capture-service-revisit-claims-closed');

    await expect(service.setStationState('ref-2', 'skipped')).rejects.toThrow(/no open session/);
  });
});
