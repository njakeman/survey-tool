import {
  getFeatureLayer,
  putFeatureLayer,
  deleteFeatureLayer,
  listStoredIds,
} from '../storage/featureLayerStore.js';
import { getSetting, putSetting } from '../storage/settingsStore.js';

// Owns the GIS feature layers: which ones are published, which are on the
// device, which are switched on, and fetching them. Browser dependencies
// injected exactly as basemapService does, so the whole flow is node-testable
// against real Responses.
//
// Deliberately simpler than basemapService in two ways. There is no progress
// reporting — these are kilobytes, and a progress track for a 400 kB fetch is
// furniture. And enabling is not the same act as fetching: `enable` fetches
// only when the data is not already held, so switching a layer back on works
// with no network, which is the state the app is designed for.

const ENABLED_KEY = 'enabledFeatureLayerIds';

// Each fetched layer's manifest entry, kept in `settings` beside the enabled
// list. Same reasoning as basemapRegionMeta: losing the manifest must cost
// the *list of what exists*, never the name, style or bounds of a layer the
// surveyor already has. Without it an offline layer would draw in default
// blue under a bare id.
const META_KEY = 'featureLayerMeta';

// A 404 page served with status 200, a redirect to an HTML shell, a wrong
// URL — all of which parse as *something*. Catching it here means the failure
// lands on the Enable tap, with a message, rather than at render time on a
// phone with no console.
function parseCollection(text, id) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Could not add ${id}: the file is not valid JSON`);
  }
  if (parsed?.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
    throw new Error(`Could not add ${id}: the file is not a GeoJSON FeatureCollection`);
  }
  return parsed;
}

export function createFeatureLayerService({ db, fetchFn, manifestUrl, baseUrl, nowIso }) {
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

  async function readMeta() {
    try {
      return (await getSetting(db, META_KEY)) ?? {};
    } catch {
      return {};
    }
  }

  async function getEnabledIds() {
    try {
      return (await getSetting(db, ENABLED_KEY)) ?? [];
    } catch {
      return [];
    }
  }

  async function setEnabledIds(ids) {
    await putSetting(db, ENABLED_KEY, ids);
  }

  async function listAvailable() {
    const [manifest, storedIds, meta, enabledIds] = await Promise.all([
      readManifest(),
      listStoredIds(db).catch(() => []),
      readMeta(),
      getEnabledIds(),
    ]);
    const stored = new Set(storedIds);
    const enabled = new Set(enabledIds);

    if (!manifest) {
      return {
        manifestAvailable: false,
        layers: storedIds.map((id) => ({
          id,
          name: id,
          url: null,
          sizeBytes: null,
          featureCount: null,
          bounds: null,
          geometryTypes: [],
          style: {},
          // Whatever was recorded when this layer was fetched, overriding the
          // bare-id fallback above.
          ...(meta[id] ?? {}),
          stored: true,
          enabled: enabled.has(id),
        })),
      };
    }

    return {
      manifestAvailable: true,
      layers: manifest.map((entry) => ({
        ...entry,
        stored: stored.has(entry.id),
        enabled: enabled.has(entry.id),
      })),
    };
  }

  // Fetches only when the layer is not already held, so re-enabling works
  // offline. Nothing is marked enabled unless the data is safely stored.
  async function enable(id) {
    const held = await getFeatureLayer(db, id).catch(() => undefined);

    if (!held) {
      const manifest = await readManifest();
      const entry = manifest?.find((layer) => layer.id === id);
      if (!entry) {
        throw new Error(`Could not add the layer: no layer called ${id} is published`);
      }

      const response = await fetchFn(new URL(entry.url, baseUrl).href);
      if (!response.ok) {
        throw new Error(`Could not add ${entry.name} (HTTP ${response.status})`);
      }
      const text = await response.text();
      parseCollection(text, entry.name);

      await putFeatureLayer(db, {
        id,
        geojson: text,
        etag: response.headers.get('etag'),
        sizeBytes: new TextEncoder().encode(text).length,
        fetchedAt: nowIso(),
      });

      // Recorded now, while the manifest is in hand.
      const meta = await readMeta();
      await putSetting(db, META_KEY, {
        ...meta,
        [id]: {
          name: entry.name,
          bounds: entry.bounds ?? null,
          featureCount: entry.featureCount ?? null,
          geometryTypes: entry.geometryTypes ?? [],
          style: entry.style ?? {},
        },
      });
    }

    const enabledIds = await getEnabledIds();
    if (!enabledIds.includes(id)) await setEnabledIds([...enabledIds, id]);
  }

  // Switching off, not deleting: the data stays so it can come back with no
  // network. `remove` is the one that reclaims the space.
  async function disable(id) {
    await setEnabledIds((await getEnabledIds()).filter((enabledId) => enabledId !== id));
  }

  async function remove(id) {
    await deleteFeatureLayer(db, id);
    await disable(id);
    const meta = await readMeta();
    delete meta[id];
    await putSetting(db, META_KEY, meta);
  }

  // What the map draws. Reads IndexedDB only — never the network — because
  // this runs on every launch, offline included.
  async function loadEnabled() {
    const [enabledIds, meta] = await Promise.all([getEnabledIds(), readMeta()]);

    const loaded = await Promise.all(
      enabledIds.map(async (id) => {
        try {
          const record = await getFeatureLayer(db, id);
          if (!record) return null;
          return {
            id,
            name: meta[id]?.name ?? id,
            style: meta[id]?.style ?? {},
            geojson: JSON.parse(record.geojson),
          };
        } catch {
          // One unreadable or unparseable record must not take every other
          // overlay off the map with it.
          return null;
        }
      }),
    );
    return loaded.filter(Boolean);
  }

  return { listAvailable, enable, disable, remove, loadEnabled, getEnabledIds };
}
