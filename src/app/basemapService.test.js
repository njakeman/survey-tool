import 'fake-indexeddb/auto';
import { describe, expect, test, vi } from 'vitest';
import { openDatabase } from '../storage/db.js';
import { getBasemap, putBasemap } from '../storage/basemapStore.js';
import { createBasemapService, isUpdateAvailable } from './basemapService.js';

const MANIFEST_URL = 'https://example.test/survey-tool/basemaps/manifest.json';
const FIXED_NOW = '2026-08-10T10:00:00.000Z';

const NORTH_WILTSHIRE = {
  id: 'north-wiltshire',
  name: 'North Wiltshire',
  url: 'basemaps/north-wiltshire.pmtiles',
  sizeBytes: 24_000_000,
  bounds: [-2.2, 51.4, -1.6, 51.8],
  minZoom: 0,
  maxZoom: 15,
};
const COTSWOLDS = {
  id: 'cotswolds',
  name: 'Cotswolds',
  url: 'basemaps/cotswolds.pmtiles',
  sizeBytes: 18_000_000,
  bounds: [-2.4, 51.6, -1.6, 52.1],
  minZoom: 0,
  maxZoom: 15,
};

function bytes(text) {
  return new TextEncoder().encode(text);
}

// A real Response over a controlled stream: exercises the actual
// getReader()/chunk loop rather than a hand-rolled stand-in.
function streamingResponse(chunks, { contentLength, status = 200, etag } = {}) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const headers = {};
  if (contentLength !== undefined) headers['content-length'] = String(contentLength);
  if (etag !== undefined) headers.etag = etag;
  return new Response(body, { status, headers });
}

function manifestResponse(entries) {
  return new Response(JSON.stringify(entries), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// Routes by URL so a test can serve the manifest and the archives together.
function routingFetch(routes) {
  return vi.fn((url) => {
    const handler = routes[url] ?? routes[Object.keys(routes).find((key) => url.endsWith(key))];
    if (!handler) return Promise.reject(new TypeError(`Failed to fetch: ${url}`));
    return Promise.resolve(typeof handler === 'function' ? handler() : handler);
  });
}

async function makeService(dbName, { fetchFn } = {}) {
  const db = await openDatabase(dbName);
  return {
    db,
    service: createBasemapService({
      db,
      fetchFn: fetchFn ?? vi.fn(),
      manifestUrl: MANIFEST_URL,
      baseUrl: 'https://example.test/survey-tool/',
      nowIso: () => FIXED_NOW,
    }),
  };
}

describe('basemapService.listAvailable', () => {
  test('lists the published regions, marking which are already on the device', async () => {
    const fetchFn = routingFetch({
      [MANIFEST_URL]: () => manifestResponse([NORTH_WILTSHIRE, COTSWOLDS]),
    });
    const { db, service } = await makeService('service-list', { fetchFn });
    await putBasemap(db, { id: 'cotswolds', arrayBuffer: bytes('x').buffer, sizeBytes: 1 });

    const { regions, manifestAvailable } = await service.listAvailable();

    expect(manifestAvailable).toBe(true);
    expect(regions.map((r) => [r.id, r.downloaded])).toEqual([
      ['north-wiltshire', false],
      ['cotswolds', true],
    ]);
    expect(regions[0].name).toBe('North Wiltshire');
    expect(regions[0].bounds).toEqual([-2.2, 51.4, -1.6, 51.8]);
  });

  test('keeps a downloaded region usable when the manifest cannot be reached', async () => {
    // Losing the manifest must not hide maps the surveyor already has. It
    // must also not lose their names or bounds: bounds are what the
    // position-based suggestion needs, and offline is exactly when it counts.
    const fetchFn = routingFetch({
      [MANIFEST_URL]: () => manifestResponse([NORTH_WILTSHIRE]),
      'north-wiltshire.pmtiles': () => streamingResponse([bytes('archive')]),
    });
    const { service } = await makeService('service-list-offline', { fetchFn });
    await service.download('north-wiltshire');

    // Now the network is gone entirely.
    fetchFn.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const { regions, manifestAvailable } = await service.listAvailable();

    expect(manifestAvailable).toBe(false);
    expect(regions).toEqual([
      expect.objectContaining({
        id: 'north-wiltshire',
        name: 'North Wiltshire',
        bounds: [-2.2, 51.4, -1.6, 51.8],
        downloaded: true,
      }),
    ]);
  });

  test('falls back to bare ids for an archive stored before its metadata was known', async () => {
    const fetchFn = routingFetch({});
    const { db, service } = await makeService('service-list-no-meta', { fetchFn });
    await putBasemap(db, { id: 'cotswolds', arrayBuffer: bytes('x').buffer, sizeBytes: 1 });

    const { regions } = await service.listAvailable();

    expect(regions).toEqual([
      expect.objectContaining({ id: 'cotswolds', name: 'cotswolds', downloaded: true }),
    ]);
  });

  test('forgets a region’s metadata when it is removed', async () => {
    const fetchFn = routingFetch({
      [MANIFEST_URL]: () => manifestResponse([NORTH_WILTSHIRE]),
      'north-wiltshire.pmtiles': () => streamingResponse([bytes('archive')]),
    });
    const { service } = await makeService('service-forget-meta', { fetchFn });
    await service.download('north-wiltshire');
    await service.remove('north-wiltshire');

    fetchFn.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));

    expect((await service.listAvailable()).regions).toEqual([]);
  });

  test('reports an empty list rather than throwing when there is nothing at all', async () => {
    const { service } = await makeService('service-list-empty', { fetchFn: routingFetch({}) });

    await expect(service.listAvailable()).resolves.toEqual({
      regions: [],
      manifestAvailable: false,
    });
  });

  test('a malformed manifest is treated as unavailable, not as zero regions', async () => {
    const fetchFn = routingFetch({
      [MANIFEST_URL]: () => new Response('not json', { status: 200 }),
    });
    const { service } = await makeService('service-list-malformed', { fetchFn });

    expect((await service.listAvailable()).manifestAvailable).toBe(false);
  });
});

describe('basemapService.download', () => {
  test('resolves the region URL against the manifest and stores it under that id', async () => {
    const fetchFn = routingFetch({
      [MANIFEST_URL]: () => manifestResponse([NORTH_WILTSHIRE, COTSWOLDS]),
      'north-wiltshire.pmtiles': () =>
        streamingResponse([bytes('pmtiles '), bytes('bytes')], { contentLength: 13, etag: '"v1"' }),
    });
    const { db, service } = await makeService('service-download', { fetchFn });

    await service.download('north-wiltshire');

    const record = await getBasemap(db, 'north-wiltshire');
    expect(new TextDecoder().decode(record.arrayBuffer)).toBe('pmtiles bytes');
    expect(record.etag).toBe('"v1"');
    expect(record.sizeBytes).toBe(13);
    expect(record.downloadedAt).toBe(FIXED_NOW);
  });

  test('downloading one region leaves another already on the device alone', async () => {
    const fetchFn = routingFetch({
      [MANIFEST_URL]: () => manifestResponse([NORTH_WILTSHIRE, COTSWOLDS]),
      'north-wiltshire.pmtiles': () => streamingResponse([bytes('new')], { etag: '"v1"' }),
    });
    const { db, service } = await makeService('service-download-keeps', { fetchFn });
    await putBasemap(db, { id: 'cotswolds', arrayBuffer: bytes('kept').buffer, sizeBytes: 4 });

    await service.download('north-wiltshire');

    expect(new TextDecoder().decode((await getBasemap(db, 'cotswolds')).arrayBuffer)).toBe('kept');
  });

  test('reports progress as chunks arrive', async () => {
    const fetchFn = routingFetch({
      [MANIFEST_URL]: () => manifestResponse([NORTH_WILTSHIRE]),
      'north-wiltshire.pmtiles': () =>
        streamingResponse([bytes('aaaa'), bytes('bbbb'), bytes('cc')], { contentLength: 10 }),
    });
    const { service } = await makeService('service-download-progress', { fetchFn });
    const progress = [];

    await service.download('north-wiltshire', (update) => progress.push(update));

    expect(progress).toEqual([
      { receivedBytes: 4, totalBytes: 10 },
      { receivedBytes: 8, totalBytes: 10 },
      { receivedBytes: 10, totalBytes: 10 },
    ]);
  });

  test('reports an unknown total as null rather than 0', async () => {
    const fetchFn = routingFetch({
      [MANIFEST_URL]: () => manifestResponse([NORTH_WILTSHIRE]),
      'north-wiltshire.pmtiles': () => streamingResponse([bytes('abcd')]),
    });
    const { service } = await makeService('service-download-nolength', { fetchFn });
    const progress = [];

    await service.download('north-wiltshire', (update) => progress.push(update));

    expect(progress).toEqual([{ receivedBytes: 4, totalBytes: null }]);
  });

  test('a failed request throws and stores nothing', async () => {
    const fetchFn = routingFetch({
      [MANIFEST_URL]: () => manifestResponse([NORTH_WILTSHIRE]),
      'north-wiltshire.pmtiles': () => streamingResponse([], { status: 404 }),
    });
    const { db, service } = await makeService('service-download-404', { fetchFn });

    await expect(service.download('north-wiltshire')).rejects.toThrow(/404/);

    expect(await getBasemap(db, 'north-wiltshire')).toBeUndefined();
  });

  test('refuses a region the manifest does not list', async () => {
    const fetchFn = routingFetch({ [MANIFEST_URL]: () => manifestResponse([NORTH_WILTSHIRE]) });
    const { service } = await makeService('service-download-unknown', { fetchFn });

    await expect(service.download('atlantis')).rejects.toThrow(/atlantis/);
  });
});

describe('basemapService selection', () => {
  test('remembers the selected region across a relaunch', async () => {
    const { db, service } = await makeService('service-select');

    await service.select('cotswolds');

    // A fresh service over the same database is what a relaunch looks like.
    const relaunched = createBasemapService({
      db,
      fetchFn: vi.fn(),
      manifestUrl: MANIFEST_URL,
      baseUrl: 'https://example.test/survey-tool/',
      nowIso: () => FIXED_NOW,
    });
    expect(await relaunched.getSelectedId()).toBe('cotswolds');
  });

  test('reports no selection on a fresh device', async () => {
    const { service } = await makeService('service-select-none');
    expect(await service.getSelectedId()).toBeNull();
  });
});

describe('basemapService.loadArchive and remove', () => {
  test('loads the stored bytes for a region', async () => {
    const { db, service } = await makeService('service-load');
    await putBasemap(db, { id: 'cotswolds', arrayBuffer: bytes('archive').buffer, sizeBytes: 7 });

    expect(new TextDecoder().decode(await service.loadArchive('cotswolds'))).toBe('archive');
  });

  test('returns null for a region not on the device', async () => {
    const { service } = await makeService('service-load-missing');
    expect(await service.loadArchive('cotswolds')).toBeNull();
  });

  test('removing a region clears its selection too, rather than pointing at nothing', async () => {
    const { db, service } = await makeService('service-remove');
    await putBasemap(db, { id: 'cotswolds', arrayBuffer: bytes('x').buffer, sizeBytes: 1 });
    await service.select('cotswolds');

    await service.remove('cotswolds');

    expect(await getBasemap(db, 'cotswolds')).toBeUndefined();
    expect(await service.getSelectedId()).toBeNull();
  });

  test('removing a region that is not selected leaves the selection alone', async () => {
    const { db, service } = await makeService('service-remove-other');
    await putBasemap(db, { id: 'cotswolds', arrayBuffer: bytes('x').buffer, sizeBytes: 1 });
    await putBasemap(db, { id: 'north-wiltshire', arrayBuffer: bytes('y').buffer, sizeBytes: 1 });
    await service.select('cotswolds');

    await service.remove('north-wiltshire');

    expect(await service.getSelectedId()).toBe('cotswolds');
  });
});

describe('isUpdateAvailable', () => {
  const stored = { etag: '"v1"', sizeBytes: 100 };

  test('true when the published etag differs from the stored one', () => {
    expect(isUpdateAvailable(stored, { etag: '"v2"', sizeBytes: 100 })).toBe(true);
  });

  test('false when the etags match, even if sizes somehow differ', () => {
    expect(isUpdateAvailable(stored, { etag: '"v1"', sizeBytes: 999 })).toBe(false);
  });

  test('falls back to size when neither side publishes an etag', () => {
    expect(isUpdateAvailable({ etag: null, sizeBytes: 100 }, { etag: null, sizeBytes: 200 })).toBe(
      true,
    );
    expect(isUpdateAvailable({ etag: null, sizeBytes: 100 }, { etag: null, sizeBytes: 100 })).toBe(
      false,
    );
  });

  test('claims nothing without a stored archive or without a remote signal', () => {
    expect(isUpdateAvailable(null, { etag: '"v2"', sizeBytes: 1 })).toBe(false);
    expect(isUpdateAvailable(stored, null)).toBe(false);
  });
});
