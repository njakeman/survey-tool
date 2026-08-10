import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import {
  putBasemap,
  getBasemap,
  deleteBasemap,
  listDownloadedIds,
  deleteLegacyBasemap,
} from './basemapStore.js';

function makeRecord(overrides = {}) {
  return {
    id: 'north-wiltshire',
    arrayBuffer: new TextEncoder().encode('fake pmtiles bytes').buffer,
    etag: '"abc123"',
    sizeBytes: 18,
    downloadedAt: '2026-08-10T10:00:00.000Z',
    ...overrides,
  };
}

describe('basemapStore', () => {
  test('round-trips an archive record by id with its ArrayBuffer intact', async () => {
    const db = await openDatabase('basemap-store-roundtrip');

    await putBasemap(db, makeRecord());
    const record = await getBasemap(db, 'north-wiltshire');

    expect(record.etag).toBe('"abc123"');
    expect(record.sizeBytes).toBe(18);
    expect(record.downloadedAt).toBe('2026-08-10T10:00:00.000Z');
    expect(record.arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(record.arrayBuffer)).toBe('fake pmtiles bytes');
    db.close();
  });

  test('getBasemap returns undefined for a region never downloaded', async () => {
    const db = await openDatabase('basemap-store-empty');
    expect(await getBasemap(db, 'cotswolds')).toBeUndefined();
    db.close();
  });

  test('holds several regions at once — downloading one must not evict another', async () => {
    const db = await openDatabase('basemap-store-many');

    await putBasemap(db, makeRecord({ id: 'north-wiltshire' }));
    await putBasemap(db, makeRecord({ id: 'cotswolds' }));

    expect(await db.count('basemap')).toBe(2);
    expect(await getBasemap(db, 'north-wiltshire')).toBeTruthy();
    expect(await getBasemap(db, 'cotswolds')).toBeTruthy();
    db.close();
  });

  test('re-downloading a region replaces that region only', async () => {
    const db = await openDatabase('basemap-store-replace');
    await putBasemap(db, makeRecord({ id: 'north-wiltshire', etag: '"old"' }));
    await putBasemap(db, makeRecord({ id: 'cotswolds', etag: '"cotswolds"' }));

    await putBasemap(db, makeRecord({ id: 'north-wiltshire', etag: '"new"' }));

    expect(await db.count('basemap')).toBe(2);
    expect((await getBasemap(db, 'north-wiltshire')).etag).toBe('"new"');
    expect((await getBasemap(db, 'cotswolds')).etag).toBe('"cotswolds"');
    db.close();
  });

  test('requires an id — an archive with nowhere to belong is a bug, not a default', async () => {
    const db = await openDatabase('basemap-store-no-id');
    const withoutId = { ...makeRecord() };
    delete withoutId.id;

    await expect(putBasemap(db, withoutId)).rejects.toThrow(/id/i);
    db.close();
  });

  test('deleteBasemap removes one region and leaves the others', async () => {
    const db = await openDatabase('basemap-store-delete');
    await putBasemap(db, makeRecord({ id: 'north-wiltshire' }));
    await putBasemap(db, makeRecord({ id: 'cotswolds' }));

    await deleteBasemap(db, 'north-wiltshire');

    expect(await getBasemap(db, 'north-wiltshire')).toBeUndefined();
    expect(await getBasemap(db, 'cotswolds')).toBeTruthy();
    await expect(deleteBasemap(db, 'nope')).resolves.not.toThrow();
    db.close();
  });

  test('rejects a record whose bytes are not an ArrayBuffer, enforcing the no-Blob rule', async () => {
    const db = await openDatabase('basemap-store-no-blob');

    await expect(putBasemap(db, makeRecord({ arrayBuffer: new Blob(['bytes']) }))).rejects.toThrow(
      /ArrayBuffer/,
    );
    db.close();
  });
});

describe('listDownloadedIds', () => {
  test('lists which regions are held, reading keys only', async () => {
    // Deliberately keys, not records: every value in this store is a
    // multi-megabyte buffer, so a getAll() here would pull the entire
    // offline map collection into memory just to render a list.
    const db = await openDatabase('basemap-store-list');
    await putBasemap(db, makeRecord({ id: 'north-wiltshire' }));
    await putBasemap(db, makeRecord({ id: 'cotswolds' }));

    expect((await listDownloadedIds(db)).sort()).toEqual(['cotswolds', 'north-wiltshire']);
    db.close();
  });

  test('is empty on a device that has downloaded nothing', async () => {
    const db = await openDatabase('basemap-store-list-empty');
    expect(await listDownloadedIds(db)).toEqual([]);
    db.close();
  });
});

describe('deleteLegacyBasemap', () => {
  test('removes the single-archive record from before regions had ids', async () => {
    // Phase 4 stored one archive under the fixed id 'basemap'. Left behind,
    // it matches no region in the manifest and would sit on the device
    // forever as an invisible hundred megabytes.
    const db = await openDatabase('basemap-store-legacy');
    await putBasemap(db, makeRecord({ id: 'basemap' }));
    await putBasemap(db, makeRecord({ id: 'north-wiltshire' }));

    await deleteLegacyBasemap(db);

    expect(await getBasemap(db, 'basemap')).toBeUndefined();
    expect(await getBasemap(db, 'north-wiltshire')).toBeTruthy();
    db.close();
  });

  test('is a no-op when there is nothing legacy to clean up', async () => {
    const db = await openDatabase('basemap-store-legacy-absent');
    await expect(deleteLegacyBasemap(db)).resolves.not.toThrow();
    db.close();
  });
});
