import { getBasemap, putBasemap, deleteBasemap } from '../storage/basemapStore.js';

// Owns the offline basemap archive: is one on this device, fetching it, and
// noticing when the deployed one has changed. Browser dependencies are
// injected (same as captureService/offlineStatus) so the whole download loop
// is node-testable against a real Response over a controlled stream.
//
// Tri-state status is deliberate. A failed read reports 'unknown', never
// 'absent' — conflating "cannot tell" with "not downloaded" is what produced
// the false offline warnings this codebase already fixed once, and here it
// would nag the surveyor to re-download tens of megabytes they already have.

const ABSENT = { state: 'absent', sizeBytes: null, downloadedAt: null, etag: null };
const UNKNOWN = { state: 'unknown', sizeBytes: null, downloadedAt: null, etag: null };

function toStatus(record) {
  if (!record) return ABSENT;
  return {
    state: 'present',
    sizeBytes: record.sizeBytes ?? null,
    downloadedAt: record.downloadedAt ?? null,
    etag: record.etag ?? null,
  };
}

function headerNumber(response, name) {
  const raw = response.headers.get(name);
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// No stored archive is "absent", not "update available"; no remote signal
// means no claim either way — never nag on a guess.
export function isUpdateAvailable(stored, remote) {
  if (!stored || !remote) return false;
  if (stored.etag && remote.etag) return stored.etag !== remote.etag;
  if (stored.sizeBytes && remote.sizeBytes) return stored.sizeBytes !== remote.sizeBytes;
  return false;
}

export function createBasemapService({ db, fetchFn, archiveUrl, nowIso }) {
  async function readRecord() {
    return getBasemap(db);
  }

  async function status() {
    try {
      return toStatus(await readRecord());
    } catch {
      return UNKNOWN;
    }
  }

  async function loadArchive() {
    try {
      return (await readRecord())?.arrayBuffer ?? null;
    } catch {
      return null;
    }
  }

  async function download(onProgress) {
    const response = await fetchFn(archiveUrl);
    if (!response.ok) {
      throw new Error(`Could not download the offline map (HTTP ${response.status})`);
    }

    const totalBytes = headerNumber(response, 'content-length');
    const reader = response.body.getReader();
    const chunks = [];
    let receivedBytes = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.byteLength;
      onProgress?.({ receivedBytes, totalBytes });
    }

    const archive = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      archive.set(chunk, offset);
      offset += chunk.byteLength;
    }

    await putBasemap(db, {
      arrayBuffer: archive.buffer,
      etag: response.headers.get('etag'),
      sizeBytes: receivedBytes,
      downloadedAt: nowIso(),
    });

    return status();
  }

  // A background check must never reject: main.js maps unhandledrejection
  // onto the fatal-error banner, and being offline is the normal case here.
  async function checkRemote() {
    try {
      const response = await fetchFn(archiveUrl, { method: 'HEAD' });
      if (!response.ok) return null;
      return {
        sizeBytes: headerNumber(response, 'content-length'),
        etag: response.headers.get('etag'),
      };
    } catch {
      return null;
    }
  }

  function remove() {
    return deleteBasemap(db);
  }

  return { status, loadArchive, download, checkRemote, remove };
}
