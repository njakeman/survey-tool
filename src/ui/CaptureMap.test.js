import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { html } from 'htm/preact';
import { CaptureMap, CROSSHAIR_Y_FRACTION } from './CaptureMap.js';

const POSITION = { lat: 51.5, lon: -0.14, accuracyM: 8 };
const SUGGESTION = { id: 'north', name: 'North Wiltshire' };

function fakeAdapter() {
  return {
    ready: Promise.resolve(),
    setPosition: vi.fn(),
    setObservations: vi.fn(),
    setFeatureLayers: vi.fn(),
    setPickedPoint: vi.fn(),
    setHighlight: vi.fn(),
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

  test('echoes the selected feature to the map, and clears it on deselection', async () => {
    const adapter = fakeAdapter();
    const createMap = vi.fn().mockResolvedValue(adapter);
    const selected = { layerId: 'parcels', featureId: 'P-42', geometry: { type: 'Point' } };
    const { rerender } = renderMap({ createMap, selectedFeature: selected });

    await waitFor(() => expect(adapter.setHighlight).toHaveBeenCalledWith(selected));

    rerender({ selectedFeature: null });

    await waitFor(() => expect(adapter.setHighlight).toHaveBeenCalledWith(null));
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

describe('CaptureMap — a renderer that misbehaves', () => {
  // main.js's window.onerror handler puts the fatal-error banner over the
  // whole page. An in-progress observation — note and photo — lives only in
  // CapturePage's state until Save, so losing the page to a map problem is
  // the wrong trade. This is the net that was missing when "Style is not done
  // loading" reached a phone.

  test('a throw from setPosition is shown in the map panel, not raised to the page', async () => {
    const adapter = fakeAdapter();
    adapter.setPosition = vi.fn(() => {
      throw new Error('Style is not done loading.');
    });
    const createMap = vi.fn().mockResolvedValue(adapter);
    const { rerender } = renderMap({ createMap });
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    rerender({ position: POSITION });

    expect(await screen.findByRole('alert')).toHaveTextContent(/Style is not done loading/);
  });

  test('a throw from setFeatureLayers is contained the same way', async () => {
    const adapter = fakeAdapter();
    adapter.setFeatureLayers = vi.fn(() => {
      throw new Error('layer went wrong');
    });
    const createMap = vi.fn().mockResolvedValue(adapter);
    const { rerender } = renderMap({ createMap });
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    rerender({ featureLayers: [{ id: 'parcels', name: 'Parcels', style: {}, geojson: {} }] });

    expect(await screen.findByRole('alert')).toHaveTextContent(/layer went wrong/);
  });

  test('the map panel itself survives — the canvas is still there to recover into', async () => {
    const adapter = fakeAdapter();
    adapter.setObservations = vi.fn(() => {
      throw new Error('boom');
    });
    const createMap = vi.fn().mockResolvedValue(adapter);
    const { rerender, container } = renderMap({ createMap });
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    rerender({ observations: [{ id: 'obs-1', lat: 51.5, lon: -0.14 }] });

    await screen.findByRole('alert');
    expect(container.querySelector('.capture-map-canvas')).toBeTruthy();
  });
});

describe('CaptureMap — marking a point you cannot walk to', () => {
  const CENTRE = { lat: 51.6, lon: -0.2 };

  function pickingAdapter() {
    const adapter = fakeAdapter();
    adapter.getPointAtFraction = vi.fn(() => CENTRE);
    adapter.getZoom = vi.fn(() => 17);
    adapter.setPickedPoint = vi.fn();
    adapter.onMove = vi.fn(() => () => {});
    return adapter;
  }

  async function enterPicking(overrides = {}) {
    const adapter = pickingAdapter();
    const createMap = vi.fn().mockResolvedValue(adapter);
    const rendered = renderMap({ createMap, ...overrides });
    await waitFor(() => expect(createMap).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /mark a distant point/i }));
    // Spread last: renderMap returns its props, and one of them could
    // otherwise shadow the adapter under test.
    return { ...rendered, adapter };
  }

  test('offers the control only once there is a map to mark on', () => {
    renderMap({ activeRegionId: null });

    expect(screen.queryByRole('button', { name: /mark a distant point/i })).not.toBeInTheDocument();
  });

  test('entering picking shows the crosshair and the confirm controls', async () => {
    const { container } = await enterPicking();

    expect(container.querySelector('.capture-map-crosshair')).toBeTruthy();
    expect(screen.getByRole('button', { name: /use this point/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  test('reads out the crosshair position, so it can be checked before committing', async () => {
    await enterPicking({ gridRef: () => 'SU 14082 39216', position: POSITION });

    expect(await screen.findByText(/SU 14082 39216/)).toBeInTheDocument();
  });

  test('says how far away the point is, which is the sanity check on a distant mark', async () => {
    // The surveyor knows roughly how far away the thing they are looking at
    // is. A reading of 12 km when they meant 300 m is the mistake this catches.
    await enterPicking({ position: POSITION });

    expect(await screen.findByText(/\d+(\.\d+)? (m|km) [NESW]/)).toBeInTheDocument();
  });

  test('falls back to coordinates where there is no grid reference', async () => {
    // Outside Great Britain, or before the shift grid has loaded. A blank
    // readout would give the surveyor nothing to check before committing.
    await enterPicking({ gridRef: () => null, position: null });

    expect(await screen.findByText(/51\.60000, -0\.20000/)).toBeInTheDocument();
  });

  test('confirming hands back the point with an accuracy from the zoom', async () => {
    const onPickPoint = vi.fn();
    await enterPicking({ onPickPoint });

    fireEvent.click(screen.getByRole('button', { name: /use this point/i }));

    expect(onPickPoint).toHaveBeenCalledWith(
      expect.objectContaining({ lat: CENTRE.lat, lon: CENTRE.lon, accuracyM: expect.any(Number) }),
    );
    // z17 over the UK is around a metre per pixel, so a few metres — not the
    // surveyor's own fix accuracy, and never zero.
    const { accuracyM } = onPickPoint.mock.calls[0][0];
    expect(accuracyM).toBeGreaterThan(0);
    expect(accuracyM).toBeLessThan(30);
  });

  test('confirming leaves picking mode', async () => {
    await enterPicking({ onPickPoint: vi.fn() });

    fireEvent.click(screen.getByRole('button', { name: /use this point/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /use this point/i })).not.toBeInTheDocument(),
    );
  });

  test('cancelling marks nothing', async () => {
    const onPickPoint = vi.fn();
    await enterPicking({ onPickPoint });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onPickPoint).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /use this point/i })).not.toBeInTheDocument();
  });

  test('suspends follow mode, or the next fix would drag the map off the target', async () => {
    // The bug this prevents has no workaround from the surveyor's side: they
    // line the crosshair up, a GPS tick lands a second later, and the map
    // jumps back to them.
    const { adapter, rerender } = await enterPicking({ position: null });
    adapter.centreOn.mockClear();

    rerender({ position: POSITION });

    await waitFor(() => expect(adapter.setPosition).toHaveBeenCalledWith(POSITION));
    expect(adapter.centreOn).not.toHaveBeenCalled();
  });

  test('ignores feature taps while picking, since the two intents are different', async () => {
    const onFeatureTap = vi.fn();
    let tap;
    const adapter = pickingAdapter();
    const createMap = vi.fn((options) => {
      tap = options.onFeatureTap;
      return Promise.resolve(adapter);
    });
    renderMap({ createMap, onFeatureTap });
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    tap({ layerId: 'parcels' });
    expect(onFeatureTap).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /mark a distant point/i }));
    tap({ layerId: 'parcels' });

    expect(onFeatureTap).toHaveBeenCalledTimes(1);
  });

  test('aims and records at the same place, from one shared constant', async () => {
    // The trap this exists for: raise the crosshair in CSS, leave the pick
    // reading the map centre, and the app saves a point ~45 m north of where
    // the surveyor aimed — at z17 a pixel is about 0.9 m — with nothing on
    // screen to show it. Asserting both against the same exported constant in
    // one test means neither can be changed on its own.
    const { adapter, container } = await enterPicking();

    const crosshair = container.querySelector('.capture-map-crosshair');
    expect(crosshair.getAttribute('style')).toContain(`${CROSSHAIR_Y_FRACTION * 100}%`);
    expect(adapter.getPointAtFraction).toHaveBeenCalledWith({ y: CROSSHAIR_Y_FRACTION });
  });

  test('the crosshair is not at the middle, which is what the panel covers', async () => {
    // Guards the value itself, not just that the two agree: 0.5 would put the
    // reticle back behind the confirm panel and both assertions above would
    // still pass.
    expect(CROSSHAIR_Y_FRACTION).toBeLessThan(0.5);
    expect(CROSSHAIR_Y_FRACTION).toBeGreaterThan(0);
  });

  test('draws the mark the page hands back, and clears it when it goes', async () => {
    // The mark comes from the pickedPoint prop, not from the confirm tap:
    // CapturePage owns it, so it survives a note being typed and a photo
    // being taken. Driving it any other way here would test a path the app
    // does not use.
    const { adapter, rerender } = await enterPicking({ onPickPoint: vi.fn() });

    rerender({ pickedPoint: CENTRE });
    await waitFor(() => expect(adapter.setPickedPoint).toHaveBeenCalledWith(CENTRE));

    rerender({ pickedPoint: null });
    await waitFor(() => expect(adapter.setPickedPoint).toHaveBeenLastCalledWith(null));
  });
});
