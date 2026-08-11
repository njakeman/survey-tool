import { createSession, closeSession } from '../domain/session.js';
import { readZip } from './zipReader.js';
import { parseSessionExport } from './parseSessionExport.js';

// Writes a parsed export into IndexedDB as a COPY: every id — session,
// observations, photos — is freshly minted, so importing can never collide
// with or overwrite anything already on the device, and importing the same
// zip twice simply yields two copies. That is the chosen trade: import never
// blocks and never destroys; duplicates are visible and deletable.
//
// Two invariants beyond that:
// - The imported session always arrives CLOSED, even if it was exported
//   mid-session: a second "open" session would fight the device's own live
//   one for the capture page. It is an archive copy, not a continuation.
// - lastExportedAt is null: *this device* has not exported it, whatever the
//   device it came from did.

function mintRecords(parsed, newId) {
  const sessionId = newId();

  const open = createSession({
    id: sessionId,
    name: parsed.session.name,
    startedAt: parsed.session.startedAt,
  });
  const lastRecorded = parsed.observations
    .map((obs) => obs.recordedAt)
    .sort()
    .at(-1);
  const session = {
    ...closeSession(open, parsed.session.endedAt ?? lastRecorded ?? parsed.session.startedAt),
    lastExportedAt: null,
  };

  const photos = [];
  const observations = parsed.observations.map((obs) => {
    const id = newId();
    if (obs.photoId) {
      const source = parsed.photos.find((photo) => photo.photoId === obs.photoId);
      // Keeps the photoId-is-the-observation-id convention the rest of the
      // app writes with.
      photos.push({ id, data: source.data, contentType: source.contentType });
    }
    return { ...obs, id, sessionId, photoId: obs.photoId ? id : null };
  });

  return { session, observations, photos };
}

// A Uint8Array's .buffer can be larger than the view (or offset into it);
// only ever store exactly the bytes.
function toArrayBuffer(data) {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) return data.buffer;
  return data.slice().buffer;
}

export async function writeImportedSession(db, parsed, { newId }) {
  const { session, observations, photos } = mintRecords(parsed, newId);

  // One transaction: a kill mid-import must leave nothing — not a session
  // with no observations, not an observation claiming an unwritten photo.
  // Everything is plain records and ArrayBuffers before it opens (awaiting
  // anything else inside a live transaction lets it auto-commit early).
  const photoRecords = photos.map((photo) => ({
    id: photo.id,
    arrayBuffer: toArrayBuffer(photo.data),
    contentType: photo.contentType,
  }));

  const stores = photoRecords.length
    ? ['sessions', 'observations', 'photos']
    : ['sessions', 'observations'];
  const tx = db.transaction(stores, 'readwrite');
  tx.objectStore('sessions').put(session);
  for (const observation of observations) tx.objectStore('observations').put(observation);
  for (const record of photoRecords) tx.objectStore('photos').put(record);
  await tx.done;

  return {
    sessionId: session.id,
    name: session.name,
    observationCount: observations.length,
    photoCount: photoRecords.length,
  };
}

// The whole flow behind the Import button: bytes (plus the filename for
// nothing but error messages) → summary. Zip or bare .geojson, told apart by
// the bytes — every zip starts "PK", and iOS is not above renaming things.
export async function importSessionExport(db, { buffer, filename = 'file' }, { newId }) {
  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;

  let entries;
  if (isZip) {
    entries = await readZip(buffer);
  } else {
    // Assume GeoJSON text; parseSessionExport rejects it by name if not.
    entries = [{ name: 'session.geojson', data: bytes }];
  }

  try {
    const parsed = parseSessionExport(entries);
    return await writeImportedSession(db, parsed, { newId });
  } catch (error) {
    throw new Error(`${error.message} (${filename})`, { cause: error });
  }
}
