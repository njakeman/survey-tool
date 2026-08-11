import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { html } from 'htm/preact';
import { CaptureMap } from './CaptureMap.js';

const POSITION = { lat: 51.5, lon: -0.14, accuracyM: 8 };
const SUGGESTION = { id: 'north', name: 'North Wiltshire' };

function fakeAdapter() {
  return {
    ready: Promise.resolve(),
    setPosition: vi.fn(),
    setObservations: vi.fn(),
    setFeatureLayers: vi.fn(),
    centreOn: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  };
}

function props(overrides = {}) {
  return {
    activeRegionId: 'south',
    statusKnown: true,
    suggestion: null,
    createMap: vi.fn().mockResolvedValue(fakeAdapter()),
    onSwitchRegion: vi.fn(),
    onDismissSuggestion: vi.fn(),
    onOpenPicker: vi.fn(),
    position: null,
    observations: [],
    visible: true,
    ...overrides,
  };
}

function renderMap(overrides = {}) {
  const p = props(overrides);
  const result = render(html`<${CaptureMap} ...${p} />`);
  const rerender = (next = {}) => result.rerender(html`<${CaptureMap} ...${{ ...p, ...next }} />`);
  return { ...result, ...p, rerender };
}

describe('CaptureMap — no map to show', () => {
  test('renders nothing at all while the stored regions are still unknown', () => {
    // Same tri-state discipline as the offline banner: "cannot tell yet" must
    // not be shown as "you have no map".
    const { createMap, container } = renderMap({ statusKnown: false, activeRegionId: null });

    expect(container.querySelector('.capture-map-canvas')).toBeNull();
    expect(screen.queryByRole('button', { name: /choose a region/i })).not.toBeInTheDocument();
    expect(createMap).not.toHaveBeenCalled();
  });

  test('offers the picker when no region is active', () => {
    const { createMap, onOpenPicker } = renderMap({ activeRegionId: null });

    fireEvent.click(screen.getByRole('button', { name: /choose a region/i }));

    expect(onOpenPicker).toHaveBeenCalled();
    expect(createMap).not.toHaveBeenCalled();
  });
});

describe('CaptureMap — showing a region', () => {
  test('builds the map once for the active region', async () => {
    const { createMap, rerender } = renderMap();
    await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));

    rerender({ position: POSITION });

    await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
  });

  test('switching region tears the old map down and builds the new one', async () => {
    const south = fakeAdapter();
    const north = fakeAdapter();
    const createMap = vi.fn().mockResolvedValueOnce(south).mockResolvedValueOnce(north);
    const { rerender } = renderMap({ createMap });
    await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));

    rerender({ activeRegionId: 'north' });

    await waitFor(() => expect(createMap).toHaveBeenCalledTimes(2));
    expect(south.destroy).toHaveBeenCalled();
  });

  test('the replacement map is given the current fix and observations', async () => {
    // adapterReady has to reset on rebuild, or the new map comes up blank
    // while the old one had everything.
    const south = fakeAdapter();
    const north = fakeAdapter();
    const createMap = vi.fn().mockResolvedValueOnce(south).mockResolvedValueOnce(north);
    const observations = [{ id: 'obs-1', lat: 51.5, lon: -0.14, synced: false }];
    const { rerender } = renderMap({ createMap, position: POSITION, observations });
    await waitFor(() => expect(south.setPosition).toHaveBeenCalledWith(POSITION));

    rerender({ activeRegionId: 'north' });

    await waitFor(() => expect(north.setPosition).toHaveBeenCalledWith(POSITION));
    await waitFor(() => expect(north.setObservations).toHaveBeenCalledWith(observations));
  });

  test('offers a way back to the picker', async () => {
    const { onOpenPicker, createMap } = renderMap();
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /change map/i }));

    expect(onOpenPicker).toHaveBeenCalled();
  });

  test('resizes when the capture view becomes visible again', async () => {
    const adapter = fakeAdapter();
    const createMap = vi.fn().mockResolvedValue(adapter);
    const { rerender } = renderMap({ createMap, visible: false });
    await waitFor(() => expect(createMap).toHaveBeenCalled());
    adapter.resize.mockClear();

    rerender({ visible: true });

    await waitFor(() => expect(adapter.resize).toHaveBeenCalled());
  });

  test('hands the enabled feature layers to the adapter, and again when they change', async () => {
    const adapter = fakeAdapter();
    const createMap = vi.fn().mockResolvedValue(adapter);
    const parcels = [{ id: 'parcels', name: 'Field parcels', style: {}, geojson: {} }];
    const { rerender } = renderMap({ createMap, featureLayers: parcels });

    await waitFor(() => expect(adapter.setFeatureLayers).toHaveBeenCalledWith(parcels));

    const both = [...parcels, { id: 'hedges', name: 'Hedges', style: {}, geojson: {} }];
    rerender({ featureLayers: both });

    await waitFor(() => expect(adapter.setFeatureLayers).toHaveBeenCalledWith(both));
  });

  test('relays a tap through the latest handler, not the one the map was built with', async () => {
    // The map is built once per region but the handler is a new closure every
    // render. Captured at construction it would go stale immediately — and
    // silently, because it would still be a perfectly callable function.
    const adapter = fakeAdapter();
    let tapHandler;
    const createMap = vi.fn((options) => {
      tapHandler = options.onFeatureTap;
      return Promise.resolve(adapter);
    });
    const stale = vi.fn();
    const { rerender } = renderMap({ createMap, onFeatureTap: stale });
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    const current = vi.fn();
    rerender({ onFeatureTap: current });
    tapHandler({ layerId: 'parcels' });

    expect(current).toHaveBeenCalledWith({ layerId: 'parcels' });
    expect(stale).not.toHaveBeenCalled();
  });

  test('tears the map down on unmount', async () => {
    const adapter = fakeAdapter();
    const createMap = vi.fn().mockResolvedValue(adapter);
    const { unmount } = renderMap({ createMap });
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    unmount();

    await waitFor(() => expect(adapter.destroy).toHaveBeenCalled());
  });

  test('a map that fails to open reports it, and switching region clears the message', async () => {
    const createMap = vi
      .fn()
      .mockRejectedValueOnce(new Error('archive unreadable'))
      .mockResolvedValueOnce(fakeAdapter());
    const { rerender } = renderMap({ createMap });
    await screen.findByText(/archive unreadable/);

    rerender({ activeRegionId: 'north' });

    await waitFor(() => expect(screen.queryByText(/archive unreadable/)).not.toBeInTheDocument());
  });
});

describe('CaptureMap — region suggestion', () => {
  test('offers the region covering the fix, naming it', async () => {
    const { createMap } = renderMap({ suggestion: SUGGESTION });
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    expect(screen.getByText(/North Wiltshire/)).toBeInTheDocument();
  });

  test('does not switch on its own — only the confirming tap switches', async () => {
    // The whole point of the offer: a surveyor mid-observation must never
    // have the map change under them.
    const { createMap, onSwitchRegion } = renderMap({ suggestion: SUGGESTION });
    await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));

    expect(onSwitchRegion).not.toHaveBeenCalled();
    expect(createMap).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /^switch/i }));

    expect(onSwitchRegion).toHaveBeenCalledWith('north');
  });

  test('Not now dismisses the offer and leaves the map alone', async () => {
    const { onDismissSuggestion, onSwitchRegion } = renderMap({ suggestion: SUGGESTION });

    fireEvent.click(await screen.findByRole('button', { name: /not now/i }));

    expect(onDismissSuggestion).toHaveBeenCalledWith('north');
    expect(onSwitchRegion).not.toHaveBeenCalled();
  });

  test('no banner when there is nothing to suggest', async () => {
    const { createMap } = renderMap({ suggestion: null });
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /^switch/i })).not.toBeInTheDocument();
  });
});
