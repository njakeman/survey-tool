import { createSession, closeSession, findOpenSession } from '../domain/session.js';
import { createObservation } from '../domain/observation.js';
import { putSession, listSessions as listSessionsFromStore } from '../storage/sessionStore.js';
import {
  listObservationsForSession,
  countObservationsForSession,
} from '../storage/observationStore.js';
import { saveObservationWithPhoto } from '../storage/captureWrite.js';
import { getAudio as getAudioFromStore } from '../storage/audioStore.js';
import { deleteObservationWithPhoto } from '../storage/captureDelete.js';

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
  async function saveObservation({
    reading,
    heading,
    note,
    photo,
    audio = null,
    feature = null,
    pickedPoint = null,
  }) {
    const session = await getOpenSession();
    if (!session) throw new Error('saveObservation: no open session');
    if (!reading) throw new Error('saveObservation: no position fix yet');

    const id = newId();
    const observation = createObservation({
      id,
      sessionId: session.id,
      recordedAt: nowIso(),
      fixAt: reading.fixAt,
      lat: pickedPoint ? pickedPoint.lat : reading.lat,
      lon: pickedPoint ? pickedPoint.lon : reading.lon,
      gpsAccuracyM: pickedPoint ? pickedPoint.accuracyM : reading.accuracyM,
      // Altitude belongs to the fix, and a point on a map has none. Carrying
      // the surveyor's own altitude across would assert the far side of the
      // valley is at the height they are standing at.
      altitudeM: pickedPoint ? null : reading.altitudeM,
      altitudeAccuracyM: pickedPoint ? null : reading.altitudeAccuracyM,
      headingDeg: heading?.headingDeg ?? null,
      headingAccuracyDeg: heading?.headingAccuracyDeg ?? null,
      note: (note ?? '').trim(),
      photoId: photo ? id : null,
      audioId: audio ? id : null,
      // Both or neither — createObservation rejects half a link. A feature
      // with no id of its own (legal GeoJSON) therefore links to nothing,
      // which is honest: there would be nothing to join back to.
      featureLayerId: feature?.featureId ? feature.layerId : null,
      featureId: feature?.featureId ?? null,
      featureLabel: feature?.featureId ? (feature.title ?? null) : null,
      positionSource: pickedPoint ? 'map' : 'gps',
    });

    await saveObservationWithPhoto(db, {
      observation,
      photo: photo ? { id, blob: photo.blob, contentType: photo.blob.type } : null,
      audio: audio ? { id, blob: audio.blob, contentType: audio.blob.type } : null,
    });
    return observation;
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
    saveObservation,
    countObservations,
    listObservations,
    deleteObservation,
    getAudio,
  };
}
