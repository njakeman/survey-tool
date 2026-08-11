import { afterEach, describe, expect, test, vi } from 'vitest';
import fixtureUrl from '../../e2e/fixtures/test-basemap.pmtiles?url';
import northFixtureUrl from '../../e2e/fixtures/test-basemap-north.pmtiles?url';
import rasterFixtureUrl from '../../e2e/fixtures/test-basemap-raster.pmtiles?url';
import { createMapAdapter, registeredArchiveCount } from './mapAdapter.js';

// Real MapLibre + real WebGL + the real pmtiles protocol, reading the real
// fixture archive through our ArrayBufferSource. This is the only test that
// can catch the integration failures the unit tiers structurally cannot:
// the separately-bundled MapLibre worker failing to resolve (which breaks
// only in a production bundle), a style the renderer rejects, or the pmtiles
// protocol never being registered. All three would ship green otherwise.

const containers = [];
const adapters = [];

// Covers the whole of the vector fixture's coverage (-1..0.5, 51..52), so it
// is under the viewport centre wherever the archive header puts the map.
const PARCELS = {
  id: 'parcels',
  name: 'Field parcels',
  style: { colour: '#1c5f9e', lineWidth: 2, fillOpacity: 0.3, titleProperty: 'ref' },
  geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { ref: 'SU1408 3921', area_ha: 4.2 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-1, 51],
              [0.5, 51],
              [0.5, 52],
              [-1, 52],
              [-1, 51],
            ],
          ],
        },
      },
    ],
  },
};

function mountContainer() {
  const container = document.createElement('div');
  container.style.width = '400px';
  container.style.height = '300px';
  document.body.append(container);
  containers.push(container);
  return container;
}

async function loadFixtureBuffer(url = fixtureUrl) {
  const response = await fetch(url);
  return response.arrayBuffer();
}

async function createAdapter(overrides = {}) {
  const adapter = await createMapAdapter({
    container: mountContainer(),
    archiveBuffer: await loadFixtureBuffer(),
    glyphsUrl: '/fonts/{fontstack}/{range}.pbf',
    ...overrides,
  });
  adapters.push(adapter);
  return adapter;
}

afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.destroy();
  for (const container of containers.splice(0)) container.remove();
});

describe('mapAdapter against real MapLibre', () => {
  test('loads the archive and renders a canvas, reporting no style or resource errors', async () => {
    const onError = vi.fn();

    const adapter = await createAdapter({ onError });
    await adapter.ready;

    expect(adapter.container.querySelector('canvas')).toBeTruthy();
    expect(adapter.container.dataset.mapLoaded).toBe('true');
    expect(onError).not.toHaveBeenCalled();
  });

  test('clamps panning to the archive coverage, so the surveyor cannot wander off the map', async () => {
    const adapter = await createAdapter();
    await adapter.ready;

    const bounds = adapter.getMaxBounds();

    expect(bounds).toBeTruthy();
    expect(bounds.getWest()).toBeCloseTo(-1, 1);
    expect(bounds.getEast()).toBeCloseTo(0.5, 1);
    expect(bounds.getSouth()).toBeCloseTo(51, 1);
    expect(bounds.getNorth()).toBeCloseTo(52, 1);
  });

  test('rotation is disabled — a survey map that spins under a gloved hand is useless', async () => {
    const adapter = await createAdapter();
    await adapter.ready;

    expect(adapter.isRotationEnabled()).toBe(false);
  });

  test('accepts position and observation updates without erroring', async () => {
    const onError = vi.fn();
    const adapter = await createAdapter({ onError });
    await adapter.ready;

    adapter.setPosition({ lat: 51.5, lon: -0.14, accuracyM: 8 });
    adapter.setObservations([
      { id: 'obs-1', lat: 51.5, lon: -0.14, synced: false },
      { id: 'obs-2', lat: 51.51, lon: -0.15, synced: true },
    ]);

    // A missing source or malformed expression surfaces as a maplibre error
    // event rather than a throw, so assert on the reporter, not just absence
    // of an exception.
    expect(onError).not.toHaveBeenCalled();
    expect(await adapter.getSourceFeatureCount('observations')).toBe(2);
  });

  test('clearing the position empties the layer rather than leaving a stale dot', async () => {
    const adapter = await createAdapter();
    await adapter.ready;
    adapter.setPosition({ lat: 51.5, lon: -0.14, accuracyM: 8 });
    expect(await adapter.getSourceFeatureCount('position')).toBe(1);

    adapter.setPosition(null);

    expect(await adapter.getSourceFeatureCount('position')).toBe(0);
  });

  test('two regions can be open at once without serving each other tiles', async () => {
    // The single shared protocol registry keyed every archive as 'basemap',
    // so a second region silently replaced the first — a live map would go
    // on rendering under the wrong archive's data. Each adapter now owns its
    // own protocol scheme, so the two cannot see each other.
    const onError = vi.fn();
    const south = await createAdapter({ onError });
    const north = await createAdapter({
      onError,
      archiveBuffer: await loadFixtureBuffer(northFixtureUrl),
    });
    await Promise.all([south.ready, north.ready]);

    expect(south.getArchiveKey()).not.toBe(north.getArchiveKey());
    // Each map keeps its own archive's coverage, which is how we know it is
    // still reading the archive it was built with.
    expect(south.getMaxBounds().getSouth()).toBeCloseTo(51, 1);
    expect(north.getMaxBounds().getSouth()).toBeCloseTo(53, 1);
    expect(onError).not.toHaveBeenCalled();
  });

  test('switching region releases the outgoing archive and reads the new one', async () => {
    // The memory half of the collision fix: pmtiles' Protocol has no remove
    // API, so without an explicit release every region ever opened stays
    // pinned — tens of megabytes each, on a phone.
    const onError = vi.fn();
    const before = registeredArchiveCount();

    const south = await createAdapter({ onError });
    await south.ready;
    expect(registeredArchiveCount()).toBe(before + 1);

    south.destroy();
    adapters.length = 0;
    expect(registeredArchiveCount()).toBe(before);

    const north = await createAdapter({
      onError,
      archiveBuffer: await loadFixtureBuffer(northFixtureUrl),
    });
    await north.ready;

    expect(north.getMaxBounds().getSouth()).toBeCloseTo(53, 1);
    expect(north.container.dataset.mapLoaded).toBe('true');
    expect(onError).not.toHaveBeenCalled();
  });

  test('renders a raster archive as well as a vector one', async () => {
    // The user's first real archive was JPEG raster, so this is not a
    // hypothetical. It also proves the pmtiles protocol serves a MapLibre
    // raster source, which no unit test can establish.
    const onError = vi.fn();

    const adapter = await createAdapter({
      onError,
      archiveBuffer: await loadFixtureBuffer(rasterFixtureUrl),
      tileType: 'raster',
      tileSize: 256,
    });
    await adapter.ready;

    expect(adapter.container.querySelector('canvas')).toBeTruthy();
    expect(adapter.container.dataset.mapLoaded).toBe('true');
    expect(onError).not.toHaveBeenCalled();
  });

  test('a fix arriving before the style has loaded is applied, not thrown', async () => {
    // The real failure, seen on a phone: "Error: Style is not done loading."
    // on the fatal-error banner over a working app. createMapAdapter resolves
    // as soon as the archive header is read, which is well before MapLibre's
    // load event — and a ~1Hz GPS watch lands a fix in that window routinely.
    // setPaintProperty throws there; getSource()?.setData() silently does
    // nothing, which is the quieter half of the same bug.
    const onError = vi.fn();
    const adapter = await createAdapter({ onError });

    // Deliberately not awaiting adapter.ready.
    expect(() => adapter.setPosition({ lat: 51.5, lon: -0.14, accuracyM: 8 })).not.toThrow();

    await adapter.ready;
    expect(await adapter.getSourceFeatureCount('position')).toBe(1);
    expect(onError).not.toHaveBeenCalled();
  });

  test('observations arriving before the style has loaded are not silently dropped', async () => {
    // Quieter than the throw and worse to diagnose: an open session's saved
    // observations are handed over once, on the same early tick, and the
    // effect does not run again until the array changes. Lost here, they are
    // missing from the map until the next save.
    const adapter = await createAdapter();

    adapter.setObservations([
      { id: 'obs-1', lat: 51.5, lon: -0.14, synced: false },
      { id: 'obs-2', lat: 51.51, lon: -0.15, synced: true },
    ]);

    await adapter.ready;
    expect(await adapter.getSourceFeatureCount('observations')).toBe(2);
  });

  test('a cleared fix set before load stays cleared, rather than being replayed', async () => {
    const adapter = await createAdapter();

    adapter.setPosition({ lat: 51.5, lon: -0.14, accuracyM: 8 });
    adapter.setPosition(null);

    await adapter.ready;
    expect(await adapter.getSourceFeatureCount('position')).toBe(0);
  });

  test('feature layers draw above the basemap and below the fix and the markers', async () => {
    // The ordering guarantee. A parcel boundary painted over the position dot
    // hides the one thing on the map that must never be hidden, and no unit
    // test can see the composed layer stack.
    const adapter = await createAdapter();
    await adapter.ready;

    adapter.setFeatureLayers([PARCELS]);
    const order = adapter.getLayerOrder();

    const lastFeatureLayer = Math.max(
      ...order.map((id, index) => (id.startsWith('feature-layer-') ? index : -1)),
    );
    expect(lastFeatureLayer).toBeGreaterThan(-1);
    expect(lastFeatureLayer).toBeLessThan(order.indexOf('position-accuracy'));
    expect(lastFeatureLayer).toBeLessThan(order.indexOf('observations-markers'));
    expect(lastFeatureLayer).toBeLessThan(order.indexOf('position-dot'));
  });

  test('a real MapLibre style accepts the generated layers, filters and all', async () => {
    // featureLayerStyle.js is node-tested against its own output. Only the
    // renderer can say whether the expressions in it are actually valid.
    const onError = vi.fn();
    const adapter = await createAdapter({ onError });
    await adapter.ready;

    adapter.setFeatureLayers([{ ...PARCELS, style: { ...PARCELS.style, labelProperty: 'ref' } }]);
    await adapter.whenIdle();

    expect(onError).not.toHaveBeenCalled();
  });

  test('switching a layer off removes its layers and its source', async () => {
    const adapter = await createAdapter();
    await adapter.ready;
    adapter.setFeatureLayers([PARCELS]);

    adapter.setFeatureLayers([]);

    expect(adapter.getLayerOrder().some((id) => id.startsWith('feature-layer-'))).toBe(false);
    // The source too — leaving it behind means addSource throws the next time
    // the same layer is switched back on.
    expect(adapter.hasSource('feature-layer-parcels')).toBe(false);
  });

  test('re-enabling a layer after switching it off works, rather than throwing on a stale source', async () => {
    const onError = vi.fn();
    const adapter = await createAdapter({ onError });
    await adapter.ready;

    adapter.setFeatureLayers([PARCELS]);
    adapter.setFeatureLayers([]);
    adapter.setFeatureLayers([PARCELS]);
    await adapter.whenIdle();

    expect(adapter.hasSource('feature-layer-parcels')).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  test('layers set before the style finishes loading are applied, not dropped', async () => {
    // CaptureMap can hand over the enabled layers the instant the adapter
    // resolves, which is before MapLibre's load event. Dropping them there
    // means an empty map until something else happens to re-set them.
    const adapter = await createAdapter();
    adapter.setFeatureLayers([PARCELS]);

    await adapter.ready;

    expect(adapter.getLayerOrder().some((id) => id.startsWith('feature-layer-'))).toBe(true);
  });

  test('a tap over a feature reports it, with a tolerance a gloved thumb can hit', async () => {
    const adapter = await createAdapter();
    await adapter.ready;
    adapter.setFeatureLayers([PARCELS]);
    await adapter.whenIdle();

    // Deliberately off-centre by more than a pixel: a bare point target is
    // unusable through a glove, so the query is a box.
    const result = adapter.queryFeatureAt({ x: 204, y: 154 });

    expect(result).toBeTruthy();
    expect(result.layerId).toBe('parcels');
    expect(result.title).toBe('SU1408 3921');
  });

  test('a tap over nothing reports nothing, which is what dismisses the sheet', async () => {
    const adapter = await createAdapter();
    await adapter.ready;
    adapter.setFeatureLayers([]);
    await adapter.whenIdle();

    expect(adapter.queryFeatureAt({ x: 200, y: 150 })).toBeNull();
  });

  test('destroy tears the map down and empties its container', async () => {
    const adapter = await createAdapter();
    await adapter.ready;

    adapter.destroy();

    expect(adapter.container.querySelector('canvas')).toBeNull();
    adapters.length = 0; // already destroyed
  });
});
