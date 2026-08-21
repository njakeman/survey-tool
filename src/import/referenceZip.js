// The two ends of a reference zip's life. loadReferenceFile runs at pick
// time, on its own tap, before any session exists: identity (name + SHA-256
// of the picked bytes) plus the parsed stations, shaped for the session-
// start screen and for createSession's reference. openReference runs on a
// stored buffer at session open, and is how photos are read — one entry at
// a time, never the whole archive inflated.
//
// Pure import-layer module: the UI may import it directly (the rule that
// keeps ui/ off storage/ and captureService does not cover pure
// import/domain/geo modules — CapturePage already imports domain/session).

import { listZipEntries, readZipEntry } from './zipReader.js';
import { parseReferenceExport } from './parseReferenceExport.js';
import { sha256Hex } from './hashBytes.js';

const PHOTO_ENTRY = /^photos\/.+\.jpg$/i;

export async function openReference(buffer) {
  const entries = listZipEntries(buffer);
  const geojsonEntry = entries.find((entry) => entry.name === 'session.geojson');
  if (!geojsonEntry) {
    throw new Error(
      'Could not load reference: no session.geojson inside — is this a session export?',
    );
  }

  const { session, stations } = parseReferenceExport(
    await readZipEntry(buffer, geojsonEntry),
    entries.map((entry) => entry.name),
  );

  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
  return {
    session,
    stations,
    photoCount: entries.filter((entry) => PHOTO_ENTRY.test(entry.name)).length,
    async readPhoto(entryName) {
      const entry = entryByName.get(entryName);
      if (!entry) throw new Error(`Reference photo ${entryName} is not in the archive`);
      return readZipEntry(buffer, entry);
    },
  };
}

export async function loadReferenceFile(file) {
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const opened = await openReference(buffer);

  return {
    buffer,
    stations: opened.stations,
    // Exactly the shape createSession stores as session.reference — kept in
    // one place so the session record and this loader can never drift.
    reference: {
      filename: file.name,
      hash,
      sessionId: opened.session.id,
      sessionName: opened.session.name,
      startedAt: opened.session.startedAt,
      stationCount: opened.stations.length,
      photoCount: opened.photoCount,
    },
  };
}
