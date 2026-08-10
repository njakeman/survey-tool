import { afterEach, describe, expect, test, vi } from 'vitest';
import fixtureUrl from '../../e2e/fixtures/test-basemap.pmtiles?url';
import { createMapAdapter } from './mapAdapter.js';

// Real MapLibre + real WebGL + the real pmtiles protocol, reading the real
// fixture archive through our ArrayBufferSource. This is the only test that
// can catch the integration failures the unit tiers structurally cannot:
// the separately-bundled MapLibre worker failing to resolve (which breaks
// only in a production bundle), a style the renderer rejects, or the pmtiles
// protocol never being registered. All three would ship green otherwise.

const containers = [];
const adapters = [];

function mountContainer() {
  const container = document.createElement('div');
  container.style.width = '400px';
  container.style.height = '300px';
  document.body.append(container);
  containers.push(container);
  return container;
}

async function loadFixtureBuffer() {
  const response = await fetch(fixtureUrl);
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

  test('destroy tears the map down and empties its container', async () => {
    const adapter = await createAdapter();
    await adapter.ready;

    adapter.destroy();

    expect(adapter.container.querySelector('canvas')).toBeNull();
    adapters.length = 0; // already destroyed
  });
});
