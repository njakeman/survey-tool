import 'fake-indexeddb/auto';
import { describe, expect, test, vi } from 'vitest';
import { openDatabase } from '../storage/db.js';
import { getFeatureLayer } from '../storage/featureLayerStore.js';
import { getSetting } from '../storage/settingsStore.js';
import { createFeatureLayerService } from './featureLayerService.js';

const MANIFEST_URL = 'https://example.test/survey-tool/feature-layers/manifest.json';
const BASE_URL = 'https://example.test/survey-tool/';
const FIXED_NOW = '2026-08-11T10:00:00.000Z';

const PARCELS_GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-1.92, 51.56] },
      properties: { ref: 'SU1408' },
    },
  ],
});

const PARCELS = {
  id: 'parcels',
  name: 'Field parcels',
  url: 'feature-layers/parcels.geojson',
  sizeBytes: PARCELS_GEOJSON.length,
  featureCount: 1,
  bounds: [-1.92, 51.56, -1.92, 51.56],
  geometryTypes: ['Point'],
  style: { colour: '#1c5f9e', lineWidth: 2 },
};
const DESIGNATIONS = {
  id: 'designations',
  name: 'Designations',
  url: 'feature-layers/designations.geojson',
  sizeBytes: 400,
  featureCount: 12,
  bounds: [-2.0, 51.5, -1.8, 51.7],
  geometryTypes: ['Polygon'],
  style: { colour: '#7d2208' },
};

function jsonResponse(value, { etag } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (etag) headers.etag = etag;
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status: 200,
    headers,
  });
}

function routingFetch(routes) {
  return vi.fn((url) => {
    const handler = routes[url] ?? routes[Object.keys(routes).find((key) => url.endsWith(key))];
    if (!handler) return Promise.reject(new TypeError(`Failed to fetch: ${url}`));
    return Promise.resolve(typeof handler === 'function' ? handler() : handler);
  });
}

async function makeService(name, routes) {
  const db = await openDatabase(name);
  const service = createFeatureLayerService({
    db,
    fetchFn: routingFetch(routes),
    manifestUrl: MANIFEST_URL,
    baseUrl: BASE_URL,
    nowIso: () => FIXED_NOW,
  });
  return { db, service };
}

describe('listAvailable', () => {
  test('marks which published layers are on the device and which are enabled', async () => {
    const { db, service } = await makeService('fls-list', {
      'manifest.json': () => jsonResponse([PARCELS, DESIGNATIONS]),
      'parcels.geojson': () => jsonResponse(PARCELS_GEOJSON),
    });

    await service.enable('parcels');
    const { manifestAvailable, layers } = await service.listAvailable();

    expect(manifestAvailable).toBe(true);
    expect(layers.map((layer) => [layer.id, layer.stored, layer.enabled])).toEqual([
      ['parcels', true, true],
      ['designations', false, false],
    ]);
    db.close();
  });

  test('falls back to what is on the device when the manifest cannot be fetched', async () => {
    // Offline is exactly when this matters: losing the list must never hide a
    // layer the surveyor already fetched.
    const { db, service } = await makeService('fls-list-offline', {
      'manifest.json': () => jsonResponse([PARCELS]),
      'parcels.geojson': () => jsonResponse(PARCELS_GEOJSON),
    });
    await service.enable('parcels');

    const offline = createFeatureLayerService({
      db,
      fetchFn: vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
      manifestUrl: MANIFEST_URL,
      baseUrl: BASE_URL,
      nowIso: () => FIXED_NOW,
    });
    const { manifestAvailable, layers } = await offline.listAvailable();

    expect(manifestAvailable).toBe(false);
    // Name and style survive, because they were recorded at fetch time —
    // without them an offline layer would draw in default blue under a bare id.
    expect(layers).toHaveLength(1);
    expect(layers[0].name).toBe('Field parcels');
    expect(layers[0].style.colour).toBe('#1c5f9e');
    expect(layers[0].enabled).toBe(true);
    db.close();
  });
});

describe('enable', () => {
  test('fetches the GeoJSON once, stores it, and marks the layer enabled', async () => {
    const { db, service } = await makeService('fls-enable', {
      'manifest.json': () => jsonResponse([PARCELS]),
      'parcels.geojson': () => jsonResponse(PARCELS_GEOJSON, { etag: '"v1"' }),
    });

    await service.enable('parcels');

    const record = await getFeatureLayer(db, 'parcels');
    expect(JSON.parse(record.geojson).features).toHaveLength(1);
    expect(record.etag).toBe('"v1"');
    expect(record.fetchedAt).toBe(FIXED_NOW);
    expect(await service.getEnabledIds()).toEqual(['parcels']);
    db.close();
  });

  test('does not refetch a layer already on the device', async () => {
    // Enabling is also how a layer comes back after being switched off. That
    // must work offline, so it cannot depend on the network.
    const fetchFn = routingFetch({
      'manifest.json': () => jsonResponse([PARCELS]),
      'parcels.geojson': () => jsonResponse(PARCELS_GEOJSON),
    });
    const db = await openDatabase('fls-enable-cached');
    const service = createFeatureLayerService({
      db,
      fetchFn,
      manifestUrl: MANIFEST_URL,
      baseUrl: BASE_URL,
      nowIso: () => FIXED_NOW,
    });

    await service.enable('parcels');
    const afterFirst = fetchFn.mock.calls.length;
    await service.disable('parcels');
    await service.enable('parcels');

    expect(fetchFn.mock.calls.length).toBe(afterFirst);
    db.close();
  });

  test('rejects a layer that is not published and leaves nothing enabled', async () => {
    const { db, service } = await makeService('fls-enable-unknown', {
      'manifest.json': () => jsonResponse([PARCELS]),
    });

    await expect(service.enable('nope')).rejects.toThrow(/nope/);
    expect(await service.getEnabledIds()).toEqual([]);
    db.close();
  });

  test('rejects a payload that is not a FeatureCollection rather than storing it', async () => {
    // A 404 page served as 200, or a wrong URL. Storing it means a layer that
    // fails at render time, on the phone, with no console to read.
    const { db, service } = await makeService('fls-enable-garbage', {
      'manifest.json': () => jsonResponse([PARCELS]),
      'parcels.geojson': () => jsonResponse({ type: 'Feature' }),
    });

    await expect(service.enable('parcels')).rejects.toThrow(/FeatureCollection/);
    expect(await getFeatureLayer(db, 'parcels')).toBeUndefined();
    expect(await service.getEnabledIds()).toEqual([]);
    db.close();
  });

  test('reports an HTTP failure rather than storing an error page', async () => {
    const { db, service } = await makeService('fls-enable-404', {
      'manifest.json': () => jsonResponse([PARCELS]),
      'parcels.geojson': () => new Response('not found', { status: 404 }),
    });

    await expect(service.enable('parcels')).rejects.toThrow(/404/);
    db.close();
  });
});

describe('disable and remove', () => {
  test('disable keeps the data on the device, so re-enabling works offline', async () => {
    const { db, service } = await makeService('fls-disable', {
      'manifest.json': () => jsonResponse([PARCELS]),
      'parcels.geojson': () => jsonResponse(PARCELS_GEOJSON),
    });
    await service.enable('parcels');

    await service.disable('parcels');

    expect(await service.getEnabledIds()).toEqual([]);
    expect(await getFeatureLayer(db, 'parcels')).toBeTruthy();
    db.close();
  });

  test('remove deletes the data, the enabled flag and the recorded metadata together', async () => {
    const { db, service } = await makeService('fls-remove', {
      'manifest.json': () => jsonResponse([PARCELS]),
      'parcels.geojson': () => jsonResponse(PARCELS_GEOJSON),
    });
    await service.enable('parcels');

    await service.remove('parcels');

    expect(await getFeatureLayer(db, 'parcels')).toBeUndefined();
    expect(await service.getEnabledIds()).toEqual([]);
    expect(await getSetting(db, 'featureLayerMeta')).toEqual({});
    db.close();
  });
});

describe('loadEnabled', () => {
  test('returns each enabled layer as its entry plus parsed GeoJSON, ready for the map', async () => {
    const { db, service } = await makeService('fls-load', {
      'manifest.json': () => jsonResponse([PARCELS, DESIGNATIONS]),
      'parcels.geojson': () => jsonResponse(PARCELS_GEOJSON),
    });
    await service.enable('parcels');

    const loaded = await service.loadEnabled();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('parcels');
    expect(loaded[0].style.colour).toBe('#1c5f9e');
    expect(loaded[0].geojson.features[0].properties.ref).toBe('SU1408');
    db.close();
  });

  test('skips an enabled layer whose data has gone missing rather than failing them all', async () => {
    // One unreadable record must not take the whole map's overlays down.
    const { db, service } = await makeService('fls-load-missing', {
      'manifest.json': () => jsonResponse([PARCELS, DESIGNATIONS]),
      'parcels.geojson': () => jsonResponse(PARCELS_GEOJSON),
      'designations.geojson': () => jsonResponse(PARCELS_GEOJSON),
    });
    await service.enable('parcels');
    await service.enable('designations');
    await db.delete('featureLayers', 'parcels');

    const loaded = await service.loadEnabled();

    expect(loaded.map((layer) => layer.id)).toEqual(['designations']);
    db.close();
  });

  test('loads from IndexedDB alone, with no manifest fetch — this is the offline path', async () => {
    const db = await openDatabase('fls-load-offline');
    const priming = createFeatureLayerService({
      db,
      fetchFn: routingFetch({
        'manifest.json': () => jsonResponse([PARCELS]),
        'parcels.geojson': () => jsonResponse(PARCELS_GEOJSON),
      }),
      manifestUrl: MANIFEST_URL,
      baseUrl: BASE_URL,
      nowIso: () => FIXED_NOW,
    });
    await priming.enable('parcels');

    const fetchFn = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const offline = createFeatureLayerService({
      db,
      fetchFn,
      manifestUrl: MANIFEST_URL,
      baseUrl: BASE_URL,
      nowIso: () => FIXED_NOW,
    });

    const loaded = await offline.loadEnabled();

    expect(loaded.map((layer) => layer.id)).toEqual(['parcels']);
    expect(loaded[0].name).toBe('Field parcels');
    expect(fetchFn).not.toHaveBeenCalled();
    db.close();
  });
});
