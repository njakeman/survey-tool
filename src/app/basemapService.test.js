import 'fake-indexeddb/auto';
import { describe, expect, test, vi } from 'vitest';
import { openDatabase } from '../storage/db.js';
import { getBasemap, putBasemap } from '../storage/basemapStore.js';
import { createBasemapService, isUpdateAvailable } from './basemapService.js';

const ARCHIVE_URL = 'https://example.test/survey-tool/basemap.pmtiles';
const FIXED_NOW = '2026-08-10T10:00:00.000Z';

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

async function makeService(dbName, { fetchFn } = {}) {
  const db = await openDatabase(dbName);
  return {
    db,
    service: createBasemapService({
      db,
      fetchFn: fetchFn ?? vi.fn(),
      archiveUrl: ARCHIVE_URL,
      nowIso: () => FIXED_NOW,
    }),
  };
}

describe('basemapService.status', () => {
  test('reports absent on a device that has never downloaded the archive', async () => {
    const { service } = await makeService('basemap-service-absent');
    expect(await service.status()).toEqual({
      state: 'absent',
      sizeBytes: null,
      downloadedAt: null,
      etag: null,
    });
  });

  test('reports present with the stored metadata after a download', async () => {
    const { db, service } = await makeService('basemap-service-present');
    await putBasemap(db, {
      arrayBuffer: bytes('archive').buffer,
      etag: '"v1"',
      sizeBytes: 7,
      downloadedAt: FIXED_NOW,
    });

    expect(await service.status()).toEqual({
      state: 'present',
      sizeBytes: 7,
      downloadedAt: FIXED_NOW,
      etag: '"v1"',
    });
  });

  test('reports unknown - never absent - when the read itself fails', async () => {
    // Conflating "cannot tell" with "not downloaded" is what produced the
    // false offline warnings this codebase already fixed once; a failed read
    // must not make the UI offer a redundant multi-megabyte download.
    const service = createBasemapService({
      db: {
        get: () => Promise.reject(new Error('SecurityError')),
      },
      fetchFn: vi.fn(),
      archiveUrl: ARCHIVE_URL,
      nowIso: () => FIXED_NOW,
    });

    expect((await service.status()).state).toBe('unknown');
  });
});

describe('basemapService.download', () => {
  test('stores the fetched bytes and returns the resulting status', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        streamingResponse([bytes('pmtiles '), bytes('bytes')], { contentLength: 13, etag: '"v1"' }),
      );
    const { db, service } = await makeService('basemap-service-download', { fetchFn });

    const result = await service.download();

    expect(fetchFn).toHaveBeenCalledWith(ARCHIVE_URL);
    const record = await getBasemap(db);
    expect(new TextDecoder().decode(record.arrayBuffer)).toBe('pmtiles bytes');
    expect(record.etag).toBe('"v1"');
    expect(record.sizeBytes).toBe(13);
    expect(record.downloadedAt).toBe(FIXED_NOW);
    expect(result.state).toBe('present');
  });

  test('reports progress as chunks arrive, with the total from Content-Length', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        streamingResponse([bytes('aaaa'), bytes('bbbb'), bytes('cc')], { contentLength: 10 }),
      );
    const { service } = await makeService('basemap-service-progress', { fetchFn });
    const progress = [];

    await service.download((update) => progress.push(update));

    expect(progress).toEqual([
      { receivedBytes: 4, totalBytes: 10 },
      { receivedBytes: 8, totalBytes: 10 },
      { receivedBytes: 10, totalBytes: 10 },
    ]);
  });

  test('reports an unknown total as null rather than 0 when Content-Length is missing', async () => {
    const fetchFn = vi.fn().mockResolvedValue(streamingResponse([bytes('abcd')]));
    const { service } = await makeService('basemap-service-no-length', { fetchFn });
    const progress = [];

    await service.download((update) => progress.push(update));

    expect(progress).toEqual([{ receivedBytes: 4, totalBytes: null }]);
  });

  test('a failed request throws and leaves any existing archive untouched', async () => {
    const fetchFn = vi.fn().mockResolvedValue(streamingResponse([], { status: 404 }));
    const { db, service } = await makeService('basemap-service-http-error', { fetchFn });
    await putBasemap(db, {
      arrayBuffer: bytes('old archive').buffer,
      etag: '"old"',
      sizeBytes: 11,
      downloadedAt: FIXED_NOW,
    });

    await expect(service.download()).rejects.toThrow(/404/);

    expect((await getBasemap(db)).etag).toBe('"old"');
  });

  test('replaces the previous archive rather than accumulating records', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(streamingResponse([bytes('one')], { etag: '"v1"' }))
      .mockResolvedValueOnce(streamingResponse([bytes('two')], { etag: '"v2"' }));
    const { db, service } = await makeService('basemap-service-replace', { fetchFn });

    await service.download();
    await service.download();

    expect(await db.count('basemap')).toBe(1);
    expect((await getBasemap(db)).etag).toBe('"v2"');
  });
});

describe('basemapService.checkRemote', () => {
  test('returns the published size and etag from a HEAD request', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { headers: { 'content-length': '4096', etag: '"v2"' } }),
      );
    const { service } = await makeService('basemap-service-head', { fetchFn });

    expect(await service.checkRemote()).toEqual({ sizeBytes: 4096, etag: '"v2"' });
    expect(fetchFn).toHaveBeenCalledWith(ARCHIVE_URL, { method: 'HEAD' });
  });

  test('returns null instead of rejecting when offline, so a background check cannot trip the fatal banner', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { service } = await makeService('basemap-service-head-offline', { fetchFn });

    await expect(service.checkRemote()).resolves.toBeNull();
  });

  test('returns null on a non-OK response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const { service } = await makeService('basemap-service-head-500', { fetchFn });

    expect(await service.checkRemote()).toBeNull();
  });
});

describe('basemapService.loadArchive', () => {
  test('returns the stored ArrayBuffer for the map adapter', async () => {
    const { db, service } = await makeService('basemap-service-load');
    await putBasemap(db, {
      arrayBuffer: bytes('archive').buffer,
      etag: '"v1"',
      sizeBytes: 7,
      downloadedAt: FIXED_NOW,
    });

    const buffer = await service.loadArchive();

    expect(new TextDecoder().decode(buffer)).toBe('archive');
  });

  test('returns null when nothing is stored', async () => {
    const { service } = await makeService('basemap-service-load-empty');
    expect(await service.loadArchive()).toBeNull();
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
