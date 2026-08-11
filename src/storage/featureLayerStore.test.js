import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import {
  putFeatureLayer,
  getFeatureLayer,
  deleteFeatureLayer,
  listStoredIds,
} from './featureLayerStore.js';

const COLLECTION = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-1.92, 51.56] },
      properties: { ref: 'SU1408' },
    },
  ],
});

function makeRecord(overrides = {}) {
  return {
    id: 'parcels',
    geojson: COLLECTION,
    etag: '"abc123"',
    sizeBytes: COLLECTION.length,
    fetchedAt: '2026-08-11T10:00:00.000Z',
    ...overrides,
  };
}

describe('featureLayerStore', () => {
  test('round-trips a layer record by id, with its GeoJSON parseable on the way out', async () => {
    const db = await openDatabase('feature-layer-roundtrip');

    await putFeatureLayer(db, makeRecord());
    const record = await getFeatureLayer(db, 'parcels');

    expect(record.etag).toBe('"abc123"');
    expect(record.fetchedAt).toBe('2026-08-11T10:00:00.000Z');
    expect(JSON.parse(record.geojson).features[0].properties.ref).toBe('SU1408');
    db.close();
  });

  test('stores the GeoJSON as a string, not a parsed object', async () => {
    // Structured-cloning a deeply nested FeatureCollection on every read
    // costs more than one JSON.parse, and the string is the smaller record.
    const db = await openDatabase('feature-layer-string');

    await putFeatureLayer(db, makeRecord());

    expect(typeof (await getFeatureLayer(db, 'parcels')).geojson).toBe('string');
    db.close();
  });

  test('getFeatureLayer returns undefined for a layer never fetched', async () => {
    const db = await openDatabase('feature-layer-absent');
    expect(await getFeatureLayer(db, 'designations')).toBeUndefined();
    db.close();
  });

  test('holds several layers at once — fetching one must not evict another', async () => {
    const db = await openDatabase('feature-layer-many');

    await putFeatureLayer(db, makeRecord({ id: 'parcels' }));
    await putFeatureLayer(db, makeRecord({ id: 'designations' }));

    expect(await db.count('featureLayers')).toBe(2);
    db.close();
  });

  test('re-fetching a layer replaces that layer only', async () => {
    const db = await openDatabase('feature-layer-replace');
    await putFeatureLayer(db, makeRecord({ id: 'parcels', etag: '"old"' }));
    await putFeatureLayer(db, makeRecord({ id: 'designations', etag: '"designations"' }));

    await putFeatureLayer(db, makeRecord({ id: 'parcels', etag: '"new"' }));

    expect(await db.count('featureLayers')).toBe(2);
    expect((await getFeatureLayer(db, 'parcels')).etag).toBe('"new"');
    expect((await getFeatureLayer(db, 'designations')).etag).toBe('"designations"');
    db.close();
  });

  test('requires an id', async () => {
    const db = await openDatabase('feature-layer-no-id');
    const withoutId = { ...makeRecord() };
    delete withoutId.id;

    await expect(putFeatureLayer(db, withoutId)).rejects.toThrow(/id/i);
    db.close();
  });

  test('rejects a record whose GeoJSON is not a string, so a Blob can never get in', async () => {
    // Same app-wide rule as photos and archives: WebKit rejects
    // Blob-in-IndexedDB in ephemeral sessions. A string sidesteps it and
    // catches an accidentally-passed parsed object at the same time.
    const db = await openDatabase('feature-layer-no-blob');

    await expect(
      putFeatureLayer(db, makeRecord({ geojson: new Blob([COLLECTION]) })),
    ).rejects.toThrow(/string/i);
    await expect(
      putFeatureLayer(db, makeRecord({ geojson: JSON.parse(COLLECTION) })),
    ).rejects.toThrow(/string/i);
    db.close();
  });

  test('deleteFeatureLayer removes one layer and leaves the others', async () => {
    const db = await openDatabase('feature-layer-delete');
    await putFeatureLayer(db, makeRecord({ id: 'parcels' }));
    await putFeatureLayer(db, makeRecord({ id: 'designations' }));

    await deleteFeatureLayer(db, 'parcels');

    expect(await getFeatureLayer(db, 'parcels')).toBeUndefined();
    expect(await getFeatureLayer(db, 'designations')).toBeTruthy();
    await expect(deleteFeatureLayer(db, 'nope')).resolves.not.toThrow();
    db.close();
  });
});

describe('listStoredIds', () => {
  test('lists which layers are held, reading keys only', async () => {
    // Smaller values than the basemap store, but the same reasoning: a list
    // of ids has no business deserialising every feature of every layer.
    const db = await openDatabase('feature-layer-list');
    await putFeatureLayer(db, makeRecord({ id: 'parcels' }));
    await putFeatureLayer(db, makeRecord({ id: 'designations' }));

    expect((await listStoredIds(db)).sort()).toEqual(['designations', 'parcels']);
    db.close();
  });

  test('is empty on a device that has fetched nothing', async () => {
    const db = await openDatabase('feature-layer-list-empty');
    expect(await listStoredIds(db)).toEqual([]);
    db.close();
  });
});
