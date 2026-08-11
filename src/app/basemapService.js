import {
  getBasemap,
  putBasemap,
  deleteBasemap,
  listDownloadedIds,
} from '../storage/basemapStore.js';
import { getSetting, putSetting } from '../storage/settingsStore.js';

// Owns the offline basemap regions: which ones exist, which are on the
// device, fetching them, and which is selected. Browser dependencies are
// injected (same as captureService/offlineStatus) so the whole download loop
// is node-testable against a real Response over a controlled stream.
//
// The published list comes from a generated manifest (scripts/
// build-basemap-manifest.mjs) rather than being hardcoded, so adding a region
// is a matter of dropping in a file and redeploying. The manifest is precached
// by the service worker, so it normally resolves offline too — but losing it
// must never hide archives the surveyor already has, hence the fallback.
//
// That fallback earned its keep: the manifest was described as precached for
// a whole phase before it actually was. The injectManifest glob carried no
// `json`, so every offline launch took the fallback path and nobody noticed,
// because the fallback is correct. Fixed in vite.config.js — the comment is
// left here because "the fallback is never exercised" would be the wrong
// lesson to draw from it.

const SELECTED_KEY = 'selectedBasemapId';

// Each downloaded region's manifest entry, kept next to the selection rather
// than on the archive record: the archive records hold multi-megabyte
// buffers, and this has to be readable to render a list. Without it, losing
// the manifest would cost the region's name and — worse — its bounds, which
// is what the position-based suggestion needs, offline being exactly when
// that matters.
const REGION_META_KEY = 'basemapRegionMeta';

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

export function createBasemapService({ db, fetchFn, manifestUrl, baseUrl, nowIso }) {
  async function readManifest() {
    try {
      const response = await fetchFn(manifestUrl);
      if (!response.ok) return null;
      const entries = await response.json();
      return Array.isArray(entries) ? entries : null;
    } catch {
      // Offline, or a manifest that isn't valid JSON. Either way the caller
      // falls back to what's already on the device.
      return null;
    }
  }

  async function readRegionMeta() {
    try {
      return (await getSetting(db, REGION_META_KEY)) ?? {};
    } catch {
      return {};
    }
  }

  async function listAvailable() {
    const [manifest, downloadedIds, meta] = await Promise.all([
      readManifest(),
      listDownloadedIds(db).catch(() => []),
      readRegionMeta(),
    ]);
    const downloaded = new Set(downloadedIds);

    if (!manifest) {
      return {
        manifestAvailable: false,
        regions: downloadedIds.map((id) => ({
          id,
          name: id,
          url: null,
          sizeBytes: null,
          bounds: null,
          minZoom: null,
          maxZoom: null,
          // Whatever was recorded when this region was downloaded — name and
          // bounds included — overriding the bare-id fallback above.
          ...(meta[id] ?? {}),
          downloaded: true,
        })),
      };
    }

    return {
      manifestAvailable: true,
      regions: manifest.map((entry) => ({
        ...entry,
        bounds: entry.bounds ?? null,
        downloaded: downloaded.has(entry.id),
      })),
    };
  }

  async function download(id, onProgress) {
    const manifest = await readManifest();
    const entry = manifest?.find((region) => region.id === id);
    if (!entry) {
      throw new Error(`Could not download the offline map: no region called ${id} is published`);
    }

    const response = await fetchFn(new URL(entry.url, baseUrl).href);
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
      id,
      arrayBuffer: archive.buffer,
      etag: response.headers.get('etag'),
      sizeBytes: receivedBytes,
      downloadedAt: nowIso(),
    });

    // Recorded now, while the manifest is in hand, so this region stays
    // named and bounded even if the list can't be fetched again.
    const meta = await readRegionMeta();
    await putSetting(db, REGION_META_KEY, {
      ...meta,
      [id]: {
        name: entry.name,
        bounds: entry.bounds ?? null,
        sizeBytes: entry.sizeBytes ?? receivedBytes,
        minZoom: entry.minZoom ?? null,
        maxZoom: entry.maxZoom ?? null,
        // Without these, an offline raster region would be styled as vector:
        // a blank map with the archive sitting right there.
        tileType: entry.tileType ?? 'vector',
        tileSize: entry.tileSize ?? null,
      },
    });
  }

  async function loadArchive(id) {
    try {
      return (await getBasemap(db, id))?.arrayBuffer ?? null;
    } catch {
      return null;
    }
  }

  async function getSelectedId() {
    try {
      return (await getSetting(db, SELECTED_KEY)) ?? null;
    } catch {
      return null;
    }
  }

  function select(id) {
    return putSetting(db, SELECTED_KEY, id);
  }

  async function remove(id) {
    await deleteBasemap(db, id);
    const meta = await readRegionMeta();
    delete meta[id];
    await putSetting(db, REGION_META_KEY, meta);
    // A selection pointing at a region that is no longer there would leave
    // the map trying to open an archive that does not exist.
    if ((await getSelectedId()) === id) await select(null);
  }

  return { listAvailable, download, loadArchive, getSelectedId, select, remove };
}
