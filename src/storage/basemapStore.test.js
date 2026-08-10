import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import { putBasemap, getBasemap, deleteBasemap } from './basemapStore.js';

function makeRecord(overrides = {}) {
  return {
    id: 'basemap',
    arrayBuffer: new TextEncoder().encode('fake pmtiles bytes').buffer,
    etag: '"abc123"',
    sizeBytes: 18,
    downloadedAt: '2026-08-10T10:00:00.000Z',
    ...overrides,
  };
}

describe('basemapStore', () => {
  test('round-trips the archive record with its ArrayBuffer intact', async () => {
    const db = await openDatabase('basemap-store-roundtrip');

    await putBasemap(db, makeRecord());
    const record = await getBasemap(db);

    expect(record.etag).toBe('"abc123"');
    expect(record.sizeBytes).toBe(18);
    expect(record.downloadedAt).toBe('2026-08-10T10:00:00.000Z');
    expect(record.arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(record.arrayBuffer)).toBe('fake pmtiles bytes');
    db.close();
  });

  test('getBasemap returns undefined when no archive has been stored', async () => {
    const db = await openDatabase('basemap-store-empty');
    expect(await getBasemap(db)).toBeUndefined();
    db.close();
  });

  test('putBasemap replaces the previous archive rather than accumulating', async () => {
    const db = await openDatabase('basemap-store-replace');

    await putBasemap(db, makeRecord({ etag: '"old"' }));
    await putBasemap(db, makeRecord({ etag: '"new"' }));

    expect((await getBasemap(db)).etag).toBe('"new"');
    expect(await db.count('basemap')).toBe(1);
    db.close();
  });

  test('deleteBasemap removes the archive and is a no-op when absent', async () => {
    const db = await openDatabase('basemap-store-delete');

    await putBasemap(db, makeRecord());
    await deleteBasemap(db);
    expect(await getBasemap(db)).toBeUndefined();

    await expect(deleteBasemap(db)).resolves.not.toThrow();
    db.close();
  });

  test('rejects a record whose bytes are not an ArrayBuffer, enforcing the no-Blob rule', async () => {
    const db = await openDatabase('basemap-store-no-blob');
    const blob = new Blob(['bytes']);

    await expect(putBasemap(db, makeRecord({ arrayBuffer: blob }))).rejects.toThrow(/ArrayBuffer/);
    db.close();
  });
});
