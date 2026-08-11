import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { FileHandleSource, describeArchive, regionNameFromFilename } from './manifest.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('../../e2e/fixtures/test-basemap.pmtiles', import.meta.url),
);

describe('regionNameFromFilename', () => {
  test('turns a slug filename into a readable region name', () => {
    expect(regionNameFromFilename('north-wiltshire.pmtiles')).toBe('North Wiltshire');
  });

  test('handles a single word and underscores', () => {
    expect(regionNameFromFilename('cotswolds.pmtiles')).toBe('Cotswolds');
    expect(regionNameFromFilename('isle_of_wight.pmtiles')).toBe('Isle Of Wight');
  });
});

describe('FileHandleSource', () => {
  test('reads only the requested window, never the whole archive', async () => {
    // A real extract is tens of megabytes and there may be several. Reading
    // headers must cost kilobytes, so the manifest script cannot use the
    // whole-file ArrayBufferSource the app uses.
    const handle = await open(FIXTURE_PATH);
    try {
      const source = new FileHandleSource(handle, 'fixture');

      const { data } = await source.getBytes(0, 7);

      expect(new TextDecoder().decode(data)).toBe('PMTiles');
      expect(source.getKey()).toBe('fixture');
    } finally {
      await handle.close();
    }
  });

  test('clamps a read that runs past the end of the file', async () => {
    const handle = await open(FIXTURE_PATH);
    try {
      const source = new FileHandleSource(handle, 'fixture');
      const { size } = await handle.stat();

      const { data } = await source.getBytes(size - 4, 100);

      expect(data.byteLength).toBe(4);
    } finally {
      await handle.close();
    }
  });
});

const RASTER_FIXTURE_PATH = fileURLToPath(
  new URL('../../e2e/fixtures/test-basemap-raster.pmtiles', import.meta.url),
);

describe('describeArchive', () => {
  test('reads a manifest entry straight out of the archive header', async () => {
    const entry = await describeArchive(FIXTURE_PATH, 'basemaps');

    expect(entry).toEqual({
      id: 'test-basemap',
      name: 'Test Basemap',
      url: 'basemaps/test-basemap.pmtiles',
      sizeBytes: expect.any(Number),
      bounds: [-1, 51, 0.5, 52],
      minZoom: 0,
      maxZoom: 0,
      tileType: 'vector',
      tileSize: null,
    });
    expect(entry.sizeBytes).toBeGreaterThan(0);
  });

  test('describes a raster archive too, rather than refusing it', async () => {
    // Refusing non-vector archives took a deploy down: the generator runs as
    // a prebuild step, so one raster file broke the whole build.
    const entry = await describeArchive(RASTER_FIXTURE_PATH, 'basemaps');

    expect(entry.tileType).toBe('raster');
    expect(entry.bounds).toEqual([-1, 51, 0.5, 52]);
  });

  test('detects the raster tile size from the image bytes', async () => {
    // Nothing in the PMTiles header records it, and assuming 512 when tiles
    // are 256 renders the imagery at the wrong scale.
    const entry = await describeArchive(RASTER_FIXTURE_PATH, 'basemaps');

    expect(entry.tileSize).toBe(256);
  });

  test('rejects a file that is not a PMTiles archive at all', async () => {
    await expect(
      describeArchive(fileURLToPath(new URL('./manifest.js', import.meta.url))),
    ).rejects.toThrow();
  });
});
