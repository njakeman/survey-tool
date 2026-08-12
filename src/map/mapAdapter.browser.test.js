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

  test('one finger pans — cooperative gestures are off, drag pan is on', async () => {
    // Two-finger pan proved unwieldy in the field, and the accidental
    // second-finger touch pinch-zoomed the *interface* instead. The map now
    // takes the standard gestures: one finger pans, pinch zooms.
    const adapter = await createAdapter();
    await adapter.ready;

    expect(adapter.isSingleFingerPanEnabled()).toBe(true);
  });

  test('accepts position and observation updates without erroring', async () => {
    const onError = vi.fn();
    const adapter = await createAdapter({ onError });
    await adapter.ready;

    adapter.setPosition({ lat: 51.5, lon: -0.14, accuracyM: 8 });
    adapter.setObservations([
      { id: 'obs-1', lat: 51.5, lon: -0.14, exported: false },
      { id: 'obs-2', lat: 51.51, lon: -0.15, exported: true },
    ]);

    // A missing source or malformed expression surfaces as a maplibre error
    // event rather than a throw, so assert on the reporter, not just absence
    // of an exception.
    expect(onError).not.toHaveBeenCalled();
    expect(await adapter.getSourceFeatureCount('observations')).toBe(2);
  });

  test('attribution starts collapsed to its toggle, expanding only on tap', async () => {
    // MapLibre's compact attribution deliberately opens itself on load
    // (_updateCompact adds maplibregl-compact-show). On a phone-sized map
    // that pill covers the bottom corner of the ground the surveyor is
    // reading, so the adapter collapses it after load. The toggle must keep
    // working — collapsed by default, not removed.
    const adapter = await createAdapter();
    await adapter.ready;

    const attrib = adapter.container.querySelector('.maplibregl-ctrl-attrib');
    expect(attrib).toBeTruthy();
    expect(attrib.classList.contains('maplibregl-compact')).toBe(true);
    expect(attrib.classList.contains('maplibregl-compact-show')).toBe(false);

    attrib.querySelector('.maplibregl-ctrl-attrib-button').click();

    expect(attrib.classList.contains('maplibregl-compact-show')).toBe(true);
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
      { id: 'obs-1', lat: 51.5, lon: -0.14, exported: false },
      { id: 'obs-2', lat: 51.51, lon: -0.15, exported: true },
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
  });

  test('the selection highlight sits above the feature layers and below the markers', async () => {
    // Above the layer it highlights, or the layer's own fill covers it;
    // below the fix and the markers, which nothing may ever cover.
    const adapter = await createAdapter();
    await adapter.ready;

    adapter.setFeatureLayers([PARCELS]);
    adapter.setHighlight({ geometry: PARCELS.geojson.features[0].geometry });
    const order = adapter.getLayerOrder();

    const lastFeatureLayer = Math.max(
      ...order.map((id, index) => (id.startsWith('feature-layer-') ? index : -1)),
    );
    expect(await adapter.getSourceFeatureCount('feature-highlight')).toBe(1);
    expect(order.indexOf('feature-highlight-fill')).toBeGreaterThan(lastFeatureLayer);
    expect(order.indexOf('feature-highlight-line')).toBeLessThan(
      order.indexOf('position-accuracy'),
    );
  });

  test('clearing the selection empties the highlight, and setting it pre-load is not dropped', async () => {
    const adapter = await createAdapter();
    adapter.setHighlight({ geometry: { type: 'Point', coordinates: [-0.14, 50.86] } });

    await adapter.ready;
    expect(await adapter.getSourceFeatureCount('feature-highlight')).toBe(1);

    adapter.setHighlight(null);
    expect(await adapter.getSourceFeatureCount('feature-highlight')).toBe(0);
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

  test('unprojects the middle of the canvas to the map centre', async () => {
    const adapter = await createAdapter();
    await adapter.ready;

    const middle = adapter.getPointAtFraction({ x: 0.5, y: 0.5 });

    // The fixture archive covers -1..0.5, 51..52, and the map opens on the
    // header's centre — so this is a real reading, not a default.
    expect(middle.lat).toBeGreaterThan(51);
    expect(middle.lat).toBeLessThan(52);
    expect(middle.lon).toBeGreaterThan(-1);
    expect(middle.lon).toBeLessThan(0.5);
  });

  test('a fraction above the middle is further north, which is the whole safety property', async () => {
    // The crosshair sits a third of the way down the map, not at its centre,
    // because the confirm panel covers the bottom. If the recorded point did
    // not move up with it, the app would silently save somewhere ~45 m north
    // of where the surveyor aimed — at z17 a pixel is about 0.9 m — with
    // nothing on screen to suggest anything was wrong. This is the test that
    // catches the reticle and the point drifting apart.
    const adapter = await createAdapter();
    await adapter.ready;

    const middle = adapter.getPointAtFraction({ x: 0.5, y: 0.5 });
    const raised = adapter.getPointAtFraction({ x: 0.5, y: 0.33 });

    expect(raised.lat).toBeGreaterThan(middle.lat);
    // Straight up the screen: longitude is unchanged.
    expect(raised.lon).toBeCloseTo(middle.lon, 9);
  });

  test('defaults to the middle when asked for nothing in particular', async () => {
    const adapter = await createAdapter();
    await adapter.ready;

    expect(adapter.getPointAtFraction({})).toEqual(adapter.getPointAtFraction({ x: 0.5, y: 0.5 }));
  });

  test('the centre follows the map, which is the whole picking interaction', async () => {
    const adapter = await createAdapter();
    await adapter.ready;
    const before = adapter.getPointAtFraction({ x: 0.5, y: 0.5 });

    // Latitude only, and a small step. maxBounds clamps panning to the
    // archive's coverage, and the fixture is 1.5° wide against a 400px
    // viewport — so east-west is pinned outright and a longitude assertion
    // here would be testing the clamp, not the unprojection.
    const target = { lat: before.lat + 0.05, lon: before.lon };
    adapter.centreOn(target);
    await adapter.whenIdle();

    const after = adapter.getPointAtFraction({ x: 0.5, y: 0.5 });
    expect(after.lat).toBeCloseTo(target.lat, 3);
    expect(after.lat).not.toBeCloseTo(before.lat, 3);
  });

  test('reports the zoom, which is what makes a picked point an honest accuracy', async () => {
    const adapter = await createAdapter();
    await adapter.ready;

    expect(adapter.getZoom()).toBeGreaterThan(0);
  });

  test('a marked point draws above the saved markers; the live fix is a DOM marker over everything', async () => {
    // The fix used to be the top canvas layer; it is now the locator DOM
    // marker, which sits above the whole canvas by construction — so the
    // ordering left to assert is the mark over the saved observations.
    const adapter = await createAdapter();
    await adapter.ready;

    adapter.setPickedPoint({ lat: 51.5, lon: -0.14 });
    const order = adapter.getLayerOrder();

    expect(order).toContain('picked-point');
    expect(order.indexOf('picked-point')).toBeGreaterThan(order.indexOf('observations-markers'));
    expect(order).not.toContain('position-dot');
  });

  test('the first fix raises the locator marker, and clearing the fix removes it', async () => {
    const adapter = await createAdapter();
    await adapter.ready;
    expect(adapter.hasLocator()).toBe(false);

    adapter.setPosition({ lat: 51.5, lon: -0.14, accuracyM: 8 });
    expect(adapter.hasLocator()).toBe(true);
    expect(adapter.container.querySelector('.locator #locator-fix')).not.toBeNull();

    // No compass reading yet: the beam is absent entirely, the honest
    // representation of not knowing.
    adapter.setLocator({ heading: null, stale: false });
    expect(adapter.container.querySelector('#locator-beam').style.display).toBe('none');

    adapter.setLocator({ heading: { headingDeg: 90, headingAccuracyDeg: 10 }, stale: true });
    const beam = adapter.container.querySelector('#locator-beam');
    expect(beam.style.display).not.toBe('none');
    expect(beam.style.transform).toContain('rotate(90deg)');
    expect(adapter.container.querySelector('.locator').dataset.stale).toBe('true');

    adapter.setPosition(null);
    expect(adapter.hasLocator()).toBe(false);
  });

  test('clearing the marked point removes it', async () => {
    const adapter = await createAdapter();
    await adapter.ready;
    adapter.setPickedPoint({ lat: 51.5, lon: -0.14 });
    expect(await adapter.getSourceFeatureCount('picked')).toBe(1);

    adapter.setPickedPoint(null);

    expect(await adapter.getSourceFeatureCount('picked')).toBe(0);
  });

  test('a marked point set before the style loads is applied, not thrown away', async () => {
    const onError = vi.fn();
    const adapter = await createAdapter({ onError });

    adapter.setPickedPoint({ lat: 51.5, lon: -0.14 });

    await adapter.ready;
    expect(await adapter.getSourceFeatureCount('picked')).toBe(1);
    expect(onError).not.toHaveBeenCalled();
  });

  test('destroy tears the map down and empties its container', async () => {
    const adapter = await createAdapter();
    await adapter.ready;

    adapter.destroy();

    expect(adapter.container.querySelector('canvas')).toBeNull();
    adapters.length = 0; // already destroyed
  });
});

describe('an online imagery region whose server is unreachable', () => {
  // The constraint the whole feature hangs on: an external imagery source
  // that cannot be reached must never stop the map loading or functioning.
  // The tile template points at a path this origin will 404, which is
  // exactly what airplane mode looks like to MapLibre.
  const UNREACHABLE_IMAGERY = {
    id: 'online-imagery',
    name: 'Aerial imagery (online)',
    online: true,
    tiles: `${location.origin}/no-such-imagery/{z}/{y}/{x}`,
    tileSize: 256,
    maxzoom: 19,
    attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    centre: { lat: 54.5, lon: -2.5 },
  };

  async function createOnlineAdapter(overrides = {}) {
    const adapter = await createMapAdapter({
      container: mountContainer(),
      online: UNREACHABLE_IMAGERY,
      glyphsUrl: '/fonts/{fontstack}/{range}.pbf',
      ...overrides,
    });
    adapters.push(adapter);
    return adapter;
  }

  test('still fires load and renders a canvas — failed tiles are events, not a failed map', async () => {
    const adapter = await createOnlineAdapter({ onError: () => {} });
    await adapter.ready;

    expect(adapter.container.dataset.mapLoaded).toBe('true');
    expect(adapter.container.querySelector('canvas')).toBeTruthy();
  });

  test('overlays and feature layers still work over the missing imagery', async () => {
    const adapter = await createOnlineAdapter({ onError: () => {} });
    await adapter.ready;

    adapter.setPosition({ lat: 51.5, lon: -0.25, accuracyM: 8 });
    adapter.setObservations([{ id: 'obs-1', lat: 51.5, lon: -0.25, exported: false }]);
    adapter.setFeatureLayers([PARCELS]);

    expect(await adapter.getSourceFeatureCount('position')).toBe(1);
    expect(await adapter.getSourceFeatureCount('observations')).toBe(1);
    expect(adapter.hasSource('feature-layer-parcels')).toBe(true);

    // The ordering guarantee holds here too: the surveyor's data below the
    // live fix, whatever the basemap is doing.
    const order = adapter.getLayerOrder();
    const lastFeatureLayer = Math.max(
      ...order.map((id, index) => (id.startsWith('feature-layer-') ? index : -1)),
    );
    expect(lastFeatureLayer).toBeGreaterThan(-1);
    expect(lastFeatureLayer).toBeLessThan(order.indexOf('position-accuracy'));
  });

  test('clamps nothing: world imagery has no maxBounds and no zoom floor', async () => {
    const adapter = await createOnlineAdapter({ onError: () => {} });
    await adapter.ready;

    expect(adapter.getMaxBounds()).toBeNull();
  });

  test('registers no archive in the pmtiles protocol, so destroy releases nothing', async () => {
    const before = registeredArchiveCount();

    const adapter = await createOnlineAdapter({ onError: () => {} });
    await adapter.ready;

    expect(adapter.getArchiveKey()).toBe(null);
    expect(registeredArchiveCount()).toBe(before);

    adapter.destroy();
    expect(registeredArchiveCount()).toBe(before);
    adapters.length = 0; // already destroyed
  });
});

describe('an online basemap defined by a remote style URL', () => {
  // The OpenFreeMap shape: the whole style is fetched from the provider,
  // not built locally. The style here is served from a data: URL so the
  // happy path is deterministic, with its tile fetches pointing at a path
  // this origin will 404 — reachable style, unreachable tiles.
  const PROVIDER_STYLE = {
    version: 8,
    glyphs: '/fonts/{fontstack}/{range}.pbf',
    sources: {
      openmaptiles: {
        type: 'vector',
        tiles: [`${location.origin}/no-such-planet/{z}/{x}/{y}.pbf`],
      },
    },
    layers: [
      { id: 'ofm-background', type: 'background', paint: { 'background-color': '#dcd8ce' } },
    ],
  };

  function styleRegion(overrides = {}) {
    return {
      id: 'online-light',
      name: 'Light (online)',
      online: true,
      styleUrl: `data:application/json,${encodeURIComponent(JSON.stringify(PROVIDER_STYLE))}`,
      attribution: '<a href="https://openfreemap.org">OpenFreeMap</a>',
      featureFontStack: 'Noto Sans Regular',
      centre: { lat: 54.5, lon: -2.5 },
      ...overrides,
    };
  }

  const LABELLED = { ...PARCELS, style: { ...PARCELS.style, labelProperty: 'ref' } };

  async function createStyleAdapter(overrides = {}, region = styleRegion()) {
    const adapter = await createMapAdapter({
      container: mountContainer(),
      online: region,
      glyphsUrl: '/fonts/{fontstack}/{range}.pbf',
      ...overrides,
    });
    adapters.push(adapter);
    return adapter;
  }

  test('renders the provider style, not a locally built one', async () => {
    const adapter = await createStyleAdapter({ onError: () => {} });
    await adapter.ready;

    expect(adapter.container.dataset.mapLoaded).toBe('true');
    expect(adapter.getLayerOrder()).toContain('ofm-background');
    expect(adapter.hasSource('openmaptiles')).toBe(true);
  });

  test('feature-layer labels ask for the fontstack the provider glyph server has', async () => {
    // Their glyph endpoint has no 'noto-sans-regular'; without the override
    // the label text silently fails to render.
    const adapter = await createStyleAdapter({ onError: () => {} });
    await adapter.ready;

    adapter.setFeatureLayers([LABELLED]);

    expect(adapter.getLayerLayoutProperty('feature-layer-parcels-label', 'text-font')).toEqual([
      'Noto Sans Regular',
    ]);
  });

  test('an unreachable style server degrades to the blank fallback, never a dead map', async () => {
    // The failure Esri's tile template cannot have: with a remote *style*, a
    // failed fetch at construction would mean load never fires and every
    // queued setter — the fix marker included — is lost. The adapter fetches
    // the style itself and falls back to a local blank ground instead.
    const adapter = await createStyleAdapter(
      { onError: () => {} },
      styleRegion({ styleUrl: `${location.origin}/no-such-style` }),
    );
    await adapter.ready;

    expect(adapter.container.dataset.mapLoaded).toBe('true');

    adapter.setPosition({ lat: 51.5, lon: -0.25, accuracyM: 8 });
    adapter.setObservations([{ id: 'obs-1', lat: 51.5, lon: -0.25, exported: false }]);
    adapter.setFeatureLayers([LABELLED]);

    expect(await adapter.getSourceFeatureCount('position')).toBe(1);
    expect(await adapter.getSourceFeatureCount('observations')).toBe(1);
    // The fallback's glyphs are our vendored ones, so labels keep the
    // vendored stack — the override belongs to the provider style only.
    expect(adapter.getLayerLayoutProperty('feature-layer-parcels-label', 'text-font')).toEqual([
      'noto-sans-regular',
    ]);
  });

  test('registers no archive in the pmtiles protocol, so destroy releases nothing', async () => {
    const before = registeredArchiveCount();

    const adapter = await createStyleAdapter({ onError: () => {} });
    await adapter.ready;

    expect(adapter.getArchiveKey()).toBe(null);
    expect(registeredArchiveCount()).toBe(before);
  });
});

describe('trace layers against real MapLibre', () => {
  const TRACED = {
    id: 'obs-t',
    lat: 51.5,
    lon: -0.5,
    exported: false,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-0.5, 51.5],
        [-0.4, 51.6],
      ],
    },
  };
  const POINT = { id: 'obs-p', lat: 51.5, lon: -0.5, exported: true };

  test('saved traces draw above the highlight and below the fix and markers', async () => {
    // The ordering guarantee, extended: a walked boundary must never cover
    // the live fix or the marker dots, and only this tier can see the
    // composed layer stack.
    const adapter = await createAdapter();
    await adapter.ready;

    const order = adapter.getLayerOrder();
    for (const id of [
      'trace-fill',
      'trace-line-exported-casing',
      'trace-line-exported',
      'trace-line-pending-casing',
      'trace-line-pending',
      'active-trace-line-casing',
      'active-trace-line',
    ]) {
      expect(order.indexOf(id)).toBeGreaterThan(order.indexOf('feature-highlight-line'));
      expect(order.indexOf(id)).toBeLessThan(order.indexOf('position-accuracy'));
    }

    // Each casing directly beneath its own line — anything between them
    // would draw inside the casing's halo.
    for (const line of ['trace-line-exported', 'trace-line-pending', 'active-trace-line']) {
      expect(order.indexOf(`${line}-casing`)).toBe(order.indexOf(line) - 1);
    }
  });

  test('setObservations feeds the markers and the shapes from one call', async () => {
    const adapter = await createAdapter();
    await adapter.ready;

    adapter.setObservations([TRACED, POINT]);

    // Every observation gets a marker at its representative point; only the
    // traced one appears in the shapes source.
    expect(await adapter.getSourceFeatureCount('observations')).toBe(2);
    expect(await adapter.getSourceFeatureCount('observation-shapes')).toBe(1);
  });

  test('an active trace set before load is replayed, and clearing empties it', async () => {
    const adapter = await createAdapter();
    adapter.setActiveTrace([
      [-0.5, 51.5],
      [-0.4, 51.6],
    ]);

    await adapter.ready;
    expect(await adapter.getSourceFeatureCount('active-trace')).toBe(1);

    adapter.setActiveTrace(null);
    expect(await adapter.getSourceFeatureCount('active-trace')).toBe(0);
  });
});
