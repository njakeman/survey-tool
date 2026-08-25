import { getSession } from '../storage/sessionStore.js';
import { listObservationsForSession } from '../storage/observationStore.js';
import { getPhoto } from '../storage/photoStore.js';
import { getAudio } from '../storage/audioStore.js';
import { getReference, listStationStates } from '../storage/revisitStore.js';
import { sessionToFeatureCollection } from '../domain/geojson.js';
import { isRevisit } from '../domain/session.js';
import { deriveStations, stationsForExport } from '../domain/revisit.js';
import { audioExtension } from '../domain/audio.js';
import { canonicalStringify } from '../domain/canonical-json.js';
import { openReference } from '../import/referenceZip.js';

// Assembles the data for a session export — GeoJSON text + photo Blobs, as
// {name, input} entries ready for a zip step (client-zip's own entry shape,
// kept separate from the actual zipping so this half stays node-testable
// with fake-indexeddb, no browser deps).
function slugify(name) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'session';
}

export async function buildSessionExport(db, { sessionId, appVersion, gridRef }) {
  const session = await getSession(db, sessionId);
  if (!session) {
    throw new Error(`buildSessionExport: no session with id ${sessionId}`);
  }

  const observations = await listObservationsForSession(db, sessionId);
  // A metadata-only zip is nothing to share — and the stamp it would earn
  // (lastExportCount: 0) made countUnexported read the session as fully
  // Exported, purge-eligible included. Both UI surfaces disable Export at
  // zero; this is the seam that guarantees it. Import stays permissive for
  // pre-fix zero-feature files.
  if (observations.length === 0) {
    throw new Error('Nothing to export — the session has no observations');
  }

  // Photos are resolved before the GeoJSON is serialised so the two can't
  // disagree: an unbacked entry (record missing) is dropped from `photos`
  // rather than failing the export — the zip must never claim a file it
  // doesn't contain.
  // Fetched together rather than one round trip at a time: a long session's
  // photos were read strictly sequentially before the zip could even start,
  // with the surveyor waiting. Order is preserved by mapping, which matters
  // for the zip's contents but never for the fetching.
  const photoRefs = observations.flatMap((obs) => obs.photos ?? []);
  const photoRecords = await Promise.all(photoRefs.map((entry) => getPhoto(db, entry.id)));

  const photoEntries = [];
  // One set across the whole session, not per observation: photo ids are
  // ULIDs (domain/id.js) and so globally unique — two observations sharing
  // one would emit the same zip entry twice.
  const presentPhotoIds = new Set();
  photoRefs.forEach((entry, index) => {
    const record = photoRecords[index];
    if (!record) return;
    presentPhotoIds.add(entry.id);
    photoEntries.push({ name: `photos/${entry.id}.jpg`, input: record.blob });
  });

  // Voice notes, by the photo rules: resolved before serialisation, orphan
  // claims nulled, the zip never claiming a file it doesn't contain. The
  // filename extension comes from each recording's stored contentType.
  const withAudio = observations.filter((obs) => obs.audioId);
  const audioRecords = await Promise.all(withAudio.map((obs) => getAudio(db, obs.audioId)));

  const audioEntries = [];
  const audioFilenames = new Map();
  withAudio.forEach((obs, index) => {
    const record = audioRecords[index];
    if (!record) return;
    const filename = `${obs.audioId}.${audioExtension(record.contentType)}`;
    audioFilenames.set(obs.audioId, filename);
    audioEntries.push({ name: `audio/${filename}`, input: record.blob });
  });

  const exportObservations = observations.map((obs) => ({
    ...obs,
    photos: (obs.photos ?? []).filter((entry) => presentPhotoIds.has(entry.id)),
    audioId: obs.audioId && !audioFilenames.has(obs.audioId) ? null : (obs.audioId ?? null),
  }));

  // A revisit carries every reference station with its end state
  // (survey_revisit). The full list needs the reference zip re-opened; if
  // eviction took the bytes, the export still builds — the stations it can
  // no longer enumerate are honestly absent rather than guessed at, and the
  // claims + pairings it does hold still travel.
  let revisitStations;
  if (isRevisit(session)) {
    const stateRecords = await listStationStates(db, sessionId);
    let refStations = null;
    const referenceRecord = await getReference(db, sessionId);
    if (referenceRecord) {
      try {
        refStations = (await openReference(referenceRecord.arrayBuffer)).stations;
      } catch {
        refStations = null;
      }
    }
    if (!refStations) {
      const knownIds = new Set([
        ...stateRecords.map((record) => record.refObsId),
        ...exportObservations.map((obs) => obs.referenceObservationId).filter(Boolean),
      ]);
      refStations = [...knownIds].map((id) => ({ id, note: '' }));
    }
    revisitStations = stationsForExport(
      deriveStations(refStations, exportObservations, stateRecords),
    );
  }

  const geojsonText = canonicalStringify(
    sessionToFeatureCollection(session, exportObservations, {
      appVersion,
      gridRef,
      audioFilename: (audioId) => audioFilenames.get(audioId) ?? null,
      revisitStations,
    }),
  );

  const entries = [
    { name: 'session.geojson', input: geojsonText },
    ...photoEntries,
    ...audioEntries,
  ];

  const dateStr = session.startedAt.slice(0, 10); // YYYY-MM-DD
  const filename = `${slugify(session.name)}-${dateStr}.zip`;

  // observationCount rides along so the caller can record what the export
  // carried (sessionStore.markSessionExported) without re-counting.
  return { filename, entries, observationCount: observations.length };
}
