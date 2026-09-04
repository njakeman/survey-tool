import {
  createSession,
  closeSession,
  reopenSession as reopenSessionRecord,
  findOpenSession,
  countUnexported,
  hasChangedSinceExport,
} from '../domain/session.js';
import { createObservation } from '../domain/observation.js';
import {
  getSession,
  putSession,
  listSessions as listSessionsFromStore,
} from '../storage/sessionStore.js';
import {
  listObservationsForSession,
  countObservationsForSession,
  updateObservationNote,
} from '../storage/observationStore.js';
import { saveObservationWithPhoto } from '../storage/captureWrite.js';
import {
  addObservationPhoto,
  replaceObservationPhoto,
  deleteObservationPhoto,
} from '../storage/photoWrite.js';
import { getAudio as getAudioFromStore } from '../storage/audioStore.js';
import { getPhoto as getPhotoFromStore } from '../storage/photoStore.js';
import { deleteObservationWithPhoto } from '../storage/captureDelete.js';
import { deleteSessionWithData } from '../storage/sessionDelete.js';
import {
  appendTraceVertex as appendVertexToStore,
  deleteTraceDraft,
  listTraceDrafts,
  listTraceVertices,
  putTraceDraft,
} from '../storage/traceDraftStore.js';
import {
  putSessionWithReference,
  getReference,
  putStationState,
  deleteStationState,
  listStationStates as listStationStatesFromStore,
} from '../storage/revisitStore.js';

// Orchestration seam between the UI and storage. Stateless — every call
// re-reads IndexedDB rather than caching the open session, which is what
// makes it correct after a force-quit and relaunch; the data volume here
// makes that cost irrelevant.
export function createCaptureService({ db, newId, nowIso }) {
  async function getOpenSession() {
    const sessions = await listSessionsFromStore(db);
    return findOpenSession(sessions);
  }

  function listSessions() {
    return listSessionsFromStore(db);
  }

  // A reference (loadReferenceFile's metadata + the picked zip's bytes)
  // makes this a revisit session. The session record and the bytes land in
  // one transaction — a revisit can never exist without its reference — and
  // createSession enforces the type/reference pairing.
  async function startSession(name, { reference = null, referenceBuffer = null } = {}) {
    const existing = await getOpenSession();
    if (existing) throw new Error('startSession: a session is already open');
    const session = createSession({
      id: newId(),
      name,
      startedAt: nowIso(),
      sessionType: reference ? 'revisit' : 'survey',
      reference,
    });
    if (reference) {
      if (!referenceBuffer) {
        throw new Error('startSession: a revisit needs the reference bytes (referenceBuffer)');
      }
      await putSessionWithReference(db, {
        session,
        referenceRecord: {
          sessionId: session.id,
          arrayBuffer: referenceBuffer,
          filename: reference.filename,
          hash: reference.hash,
        },
      });
    } else {
      await putSession(db, session);
    }
    return session;
  }

  // Ends the open session — or discards it: a session with nothing recorded
  // is a mistaken start, not a record, so it is deleted rather than closed
  // (user decision, 2026-08-14). deleteSessionWithData is one transaction
  // over every store a session can reach, so an abandoned trace draft goes
  // with it. Returns { session, discarded } — the closed record, or the
  // pre-delete snapshot when discarded.
  async function endSession() {
    const session = await getOpenSession();
    if (!session) throw new Error('endSession: no open session');
    const count = await countObservationsForSession(db, session.id);
    if (count === 0) {
      await deleteSessionWithData(db, session.id);
      return { session, discarded: true };
    }
    const closed = closeSession(session, nowIso());
    await putSession(db, closed);
    return { session: closed, discarded: false };
  }

  // Load a past (or imported) session back into the capture interface so it
  // can be added to. Refuses while any session is open, and must: saves find
  // their session via findOpenSession, which silently prefers the newest of
  // two open sessions — an unguarded reopen would not error, it would just
  // stop the surveyor's live session receiving observations.
  async function reopenSession(sessionId) {
    const existing = await getOpenSession();
    if (existing) throw new Error('reopenSession: a session is already open');
    const session = await getSession(db, sessionId);
    if (!session) throw new Error(`reopenSession: no session with id ${sessionId}`);
    const reopened = reopenSessionRecord(session);
    await putSession(db, reopened);
    return reopened;
  }

  // Downscaling does not happen here — each photo arrives already downscaled
  // (the UI downscales at capture time), so this save is instantaneous.
  // photos: [{ blob, referencePhoto? }] — contentType is read from each
  // blob itself, since canvas.toBlob() already sets it correctly. Every
  // photo id is minted fresh here (never the observation's id), so one
  // observation can hold many.
  // `feature` is the map feature the surveyor tapped Record here on, or null
  // — { layerId, featureId, title } as featureQuery.js describes it.
  //
  // `pickedPoint` is a location the surveyor placed under the map crosshair
  // because they could see the thing but not reach it — { lat, lon,
  // accuracyM }. When present it replaces the fix's coordinates, but the fix
  // itself is still required and still supplies fixAt and the heading: the
  // observation was made from somewhere, at a time, and that is worth keeping.
  // `audio` is a recorded voice note — { blob } like a photo, stored in the
  // same transaction under the observation's id.
  // `trace` is a finished walk from trace/recording.js's finishTrace —
  // { draftId, geometry, representative, gpsAccuracyM, fixAt }. It replaces
  // the fix entirely: lat/lon are the representative point, gpsAccuracyM the
  // worst vertex, fixAt when the walk began, and neither the surveyor's
  // altitude nor their heading belongs to a line they walked the length of.
  // A trace can even save without a live fix (relaunch recovery): the
  // vertices already carry every position and timestamp that matters.
  async function saveObservation({
    reading,
    heading,
    note,
    photos = [],
    audio = null,
    feature = null,
    pickedPoint = null,
    trace = null,
    // The revisit pairing: { referenceObservationId }. Null for an ordinary
    // save — and for a revisit's "record something new instead", which is
    // exactly an observation with no counterpart. Per-photo pairing rides
    // photos[i].referencePhoto instead of living here.
    station = null,
  }) {
    const session = await getOpenSession();
    if (!session) throw new Error('saveObservation: no open session');
    if (!reading && !trace) throw new Error('saveObservation: no position fix yet');

    const id = newId();
    // Fresh id per photo, minted before createObservation so the same id
    // links the domain record's photos[] entry to the storage write below.
    const photoEntries = photos.map((photo) => ({
      id: newId(),
      referencePhoto: photo.referencePhoto ?? null,
      // The lens, read off the original file at capture (photo/exif.js);
      // null for a direct capture, which WebKit strips.
      focalLength35mm: photo.focalLength35mm ?? null,
      focalLengthMm: photo.focalLengthMm ?? null,
      lensModel: photo.lensModel ?? null,
    }));
    const observation = createObservation({
      id,
      sessionId: session.id,
      recordedAt: nowIso(),
      fixAt: trace ? trace.fixAt : reading.fixAt,
      lat: trace ? trace.representative.lat : pickedPoint ? pickedPoint.lat : reading.lat,
      lon: trace ? trace.representative.lon : pickedPoint ? pickedPoint.lon : reading.lon,
      gpsAccuracyM: trace
        ? trace.gpsAccuracyM
        : pickedPoint
          ? pickedPoint.accuracyM
          : reading.accuracyM,
      // Altitude belongs to the fix, and a point on a map has none. Carrying
      // the surveyor's own altitude across would assert the far side of the
      // valley is at the height they are standing at.
      altitudeM: pickedPoint || trace ? null : reading.altitudeM,
      altitudeAccuracyM: pickedPoint || trace ? null : reading.altitudeAccuracyM,
      headingDeg: trace ? null : (heading?.headingDeg ?? null),
      headingAccuracyDeg: trace ? null : (heading?.headingAccuracyDeg ?? null),
      note: (note ?? '').trim(),
      photos: photoEntries,
      audioId: audio ? id : null,
      // Both or neither — createObservation rejects half a link. A feature
      // with no id of its own (legal GeoJSON) therefore links to nothing,
      // which is honest: there would be nothing to join back to.
      featureLayerId: feature?.featureId ? feature.layerId : null,
      featureId: feature?.featureId ?? null,
      featureLabel: feature?.featureId ? (feature.title ?? null) : null,
      positionSource: trace ? 'trace' : pickedPoint ? 'map' : 'gps',
      geometry: trace ? trace.geometry : null,
      // Which segments of the walk were inferred rather than measured —
      // finishTrace's gaps ride into the record and on into the export.
      traceGaps: trace ? (trace.gaps ?? null) : null,
      // Measured by the recorder at stop — the one thing that lets a list
      // row say 0:12 without loading the blob.
      audioDurationMs: audio?.durationMs ?? null,
      referenceObservationId: station?.referenceObservationId ?? null,
    });

    await saveObservationWithPhoto(db, {
      observation,
      photos: photos.map((photo, index) => ({
        id: photoEntries[index].id,
        blob: photo.blob,
        contentType: photo.blob.type,
      })),
      audio: audio ? { id, blob: audio.blob, contentType: audio.blob.type } : null,
      traceDraftId: trace ? trace.draftId : null,
    });
    return observation;
  }

  // A revisit station claim: 'skipped' or 'noAccess', with an optional
  // reason. One claim per station (composite key overwrites); clearing it
  // is the Undo — done/to-do are derived from observations, never written.
  async function setStationState(refObsId, state, reason = null) {
    const session = await getOpenSession();
    if (!session) throw new Error('setStationState: no open session');
    await putStationState(db, {
      sessionId: session.id,
      refObsId,
      state,
      reason,
      updatedAt: nowIso(),
    });
  }

  async function clearStationState(refObsId) {
    const session = await getOpenSession();
    if (!session) throw new Error('clearStationState: no open session');
    await deleteStationState(db, session.id, refObsId);
  }

  function listStationStates(sessionId) {
    return listStationStatesFromStore(db, sessionId);
  }

  function getReferenceRecord(sessionId) {
    return getReference(db, sessionId);
  }

  // The in-progress trace draft. One at a time in practice; getTraceDraft
  // returns whichever exists, with its vertices in walked order, so a
  // relaunch can offer resume/finish/discard. Stateless like everything
  // else here — the draft lives in IndexedDB, not in this closure.
  async function startTraceDraft({ mode }) {
    const session = await getOpenSession();
    if (!session) throw new Error('startTraceDraft: no open session');
    const draft = { id: newId(), sessionId: session.id, mode, startedAt: nowIso() };
    await putTraceDraft(db, draft);
    return draft;
  }

  function appendTraceVertex(draftId, vertex) {
    return appendVertexToStore(db, draftId, vertex);
  }

  async function getTraceDraft() {
    const drafts = await listTraceDrafts(db);
    if (drafts.length === 0) return null;
    const draft = drafts[0];
    const vertices = await listTraceVertices(db, draft.id);
    return { draft, vertices };
  }

  function discardTraceDraft(draftId) {
    return deleteTraceDraft(db, draftId);
  }

  function countObservations(sessionId) {
    return countObservationsForSession(db, sessionId);
  }

  function listObservations(sessionId) {
    return listObservationsForSession(db, sessionId);
  }

  // Delete a past session and everything it holds — one transaction
  // (sessionDelete.js). Refuses the currently open session: history never
  // lists it, but the service must not trust the UI, and deleting live
  // capture out from under the mounted CapturePage is the one unrecoverable
  // case. Deleting a past session while a different one is open is fine.
  async function deleteSession(sessionId) {
    const open = await getOpenSession();
    if (open && open.id === sessionId) {
      throw new Error('deleteSession: the session is open — end it first');
    }
    await deleteSessionWithData(db, sessionId);
  }

  // The bulk clean-up: delete every closed session whose every observation
  // has been exported — the exact fully-exported predicate the badge uses,
  // so nothing the surveyor sees as "not yet exported" can ever be purged.
  // One transaction per session rather than one over the batch: each delete
  // stays atomic without holding a write lock across the lot.
  async function deleteExportedSessions() {
    const sessions = await listSessionsFromStore(db);
    let deletedCount = 0;
    for (const session of sessions) {
      if (session.status !== 'closed' || !session.lastExportedAt) continue;
      // An edit after the export makes that export stale — the zip on
      // someone's laptop no longer matches this data, so it must not purge
      // as "fully exported" until re-exported.
      if (hasChangedSinceExport(session)) continue;
      const count = await countObservationsForSession(db, session.id);
      if (countUnexported(session, count) !== 0) continue;
      await deleteSessionWithData(db, session.id);
      deletedCount += 1;
    }
    return { deletedCount };
  }

  // Amend a saved observation's note. Trimmed here so an edit and a save can
  // never disagree about whitespace. The nowIso stamp marks the record (and
  // its session) changed, so an export made before the edit reads stale.
  function updateNote(id, note) {
    return updateObservationNote(db, id, (note ?? '').trim(), nowIso());
  }

  // The post-save photo edits (design pass 4, widened for multi-photo): add
  // appends a new photo under a fresh id; replace writes a NEW record under
  // a fresh id in the same slot — repointing the id is what busts a row's
  // cached object URL — and deletes the old one; delete drops one photo's
  // slot and record outright. All three stamp the change marks in the same
  // transaction (photoWrite.js). The service stays permissive like
  // updateNote: read-only surfaces simply aren't handed the callbacks
  // (absence-is-the-flag, as with onEditNote).
  // `photo` is { blob, referencePhoto? }: framing a reference photo against
  // an observation already on disk pairs the appended slot the same way a
  // framed save does. photoWrite refuses the pairing if the observation
  // names no station — the domain's both-halves rule.
  function addPhoto(observationId, photo) {
    return addObservationPhoto(db, {
      observationId,
      photo: {
        id: newId(),
        blob: photo.blob,
        referencePhoto: photo.referencePhoto ?? null,
        ...lensOf(photo),
      },
      changedAt: nowIso(),
    });
  }

  function replacePhoto(observationId, photoId, photo) {
    return replaceObservationPhoto(db, {
      observationId,
      photoId,
      photo: { id: newId(), blob: photo.blob, ...lensOf(photo) },
      changedAt: nowIso(),
    });
  }

  // The lens the shot was taken on, as photo/exif.js read it off the
  // original file; every field present, null when unknown, so the slot
  // always carries the same three keys.
  function lensOf(photo) {
    return {
      focalLength35mm: photo.focalLength35mm ?? null,
      focalLengthMm: photo.focalLengthMm ?? null,
      lensModel: photo.lensModel ?? null,
    };
  }

  function deletePhoto(observationId, photoId) {
    return deleteObservationPhoto(db, { observationId, photoId, changedAt: nowIso() });
  }

  // Undo-last-save support. Idempotent: deleting an id that's already gone
  // (or never existed) is a no-op, not an error — the UI doesn't need to
  // track exactly what state it's in before offering Undo. One transaction
  // (captureDelete.js), so a kill mid-delete can't orphan the photo.
  function deleteObservation(id) {
    return deleteObservationWithPhoto(db, id);
  }

  // A saved voice note, as { blob, contentType } — undefined when absent.
  // Read on demand by the observation list's play control, never eagerly:
  // listing a session must not deserialise every recording in it.
  function getAudio(id) {
    return getAudioFromStore(db, id);
  }

  // A saved photo, as { blob, contentType } — undefined when absent. Same
  // read-on-demand rule as getAudio: the list's thumbnail asks for one photo
  // on a tap, never for every photo in a session.
  function getPhoto(id) {
    return getPhotoFromStore(db, id);
  }

  return {
    getOpenSession,
    listSessions,
    startSession,
    endSession,
    reopenSession,
    saveObservation,
    setStationState,
    clearStationState,
    listStationStates,
    getReferenceRecord,
    startTraceDraft,
    appendTraceVertex,
    getTraceDraft,
    discardTraceDraft,
    countObservations,
    listObservations,
    updateNote,
    addPhoto,
    replacePhoto,
    deletePhoto,
    deleteObservation,
    deleteSession,
    deleteExportedSessions,
    getAudio,
    getPhoto,
  };
}
