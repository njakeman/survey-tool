import {
  createSession,
  closeSession,
  reopenSession as reopenSessionRecord,
  findOpenSession,
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
} from '../storage/observationStore.js';
import { saveObservationWithPhoto } from '../storage/captureWrite.js';
import { getAudio as getAudioFromStore } from '../storage/audioStore.js';
import { deleteObservationWithPhoto } from '../storage/captureDelete.js';
import {
  appendTraceVertex as appendVertexToStore,
  deleteTraceDraft,
  listTraceDrafts,
  listTraceVertices,
  putTraceDraft,
} from '../storage/traceDraftStore.js';

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

  async function startSession(name) {
    const existing = await getOpenSession();
    if (existing) throw new Error('startSession: a session is already open');
    const session = createSession({ id: newId(), name, startedAt: nowIso() });
    await putSession(db, session);
    return session;
  }

  async function endSession() {
    const session = await getOpenSession();
    if (!session) throw new Error('endSession: no open session');
    const closed = closeSession(session, nowIso());
    await putSession(db, closed);
    return closed;
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

  // Downscaling does not happen here — the photo arrives already downscaled
  // (the UI downscales at capture time), so this save is instantaneous.
  // photo: { blob } | null — contentType is read from the blob itself,
  // since canvas.toBlob() already sets it correctly.
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
    photo,
    audio = null,
    feature = null,
    pickedPoint = null,
    trace = null,
  }) {
    const session = await getOpenSession();
    if (!session) throw new Error('saveObservation: no open session');
    if (!reading && !trace) throw new Error('saveObservation: no position fix yet');

    const id = newId();
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
      photoId: photo ? id : null,
      audioId: audio ? id : null,
      // Both or neither — createObservation rejects half a link. A feature
      // with no id of its own (legal GeoJSON) therefore links to nothing,
      // which is honest: there would be nothing to join back to.
      featureLayerId: feature?.featureId ? feature.layerId : null,
      featureId: feature?.featureId ?? null,
      featureLabel: feature?.featureId ? (feature.title ?? null) : null,
      positionSource: trace ? 'trace' : pickedPoint ? 'map' : 'gps',
      geometry: trace ? trace.geometry : null,
    });

    await saveObservationWithPhoto(db, {
      observation,
      photo: photo ? { id, blob: photo.blob, contentType: photo.blob.type } : null,
      audio: audio ? { id, blob: audio.blob, contentType: audio.blob.type } : null,
      traceDraftId: trace ? trace.draftId : null,
    });
    return observation;
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

  return {
    getOpenSession,
    listSessions,
    startSession,
    endSession,
    reopenSession,
    saveObservation,
    startTraceDraft,
    appendTraceVertex,
    getTraceDraft,
    discardTraceDraft,
    countObservations,
    listObservations,
    deleteObservation,
    getAudio,
  };
}
