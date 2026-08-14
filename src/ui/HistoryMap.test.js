// Deliberate coverage stopping point: this happy-dom tier proves the
// component's wiring against a fake adapter, and the browser tier's
// "opening viewport fitted to session data" tests (mapAdapter.browser.test.js)
// prove the fit against real MapLibre in both engines. No e2e — provisioning
// a region plus a full session for one more assertion would re-test what
// those two tiers already pin down; the on-device checklist covers the rest.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { html } from 'htm/preact';
import { HistoryMap } from './HistoryMap.js';
import { observationBounds } from '../map/viewport.js';

const OBSERVATIONS = [
  { id: 'obs-1', lat: 51.5, lon: -0.14, exported: true },
  { id: 'obs-2', lat: 51.6, lon: -0.2, exported: false },
];

function fakeAdapter() {
  return {
    ready: Promise.resolve(),
    setObservations: vi.fn(),
    setNightMode: vi.fn(),
    destroy: vi.fn(),
  };
}

function props(overrides = {}) {
  return {
    activeRegionId: 'south',
    statusKnown: true,
    createMap: vi.fn().mockResolvedValue(fakeAdapter()),
    observations: OBSERVATIONS,
    night: false,
    ...overrides,
  };
}

function renderMap(overrides = {}) {
  const p = props(overrides);
  const result = render(html`<${HistoryMap} ...${p} />`);
  const rerender = (next = {}) => result.rerender(html`<${HistoryMap} ...${{ ...p, ...next }} />`);
  return { ...result, ...p, rerender };
}

describe('HistoryMap — when there is nothing to show', () => {
  test('renders nothing while the stored regions are still unknown', () => {
    const { createMap, container } = renderMap({ statusKnown: false, activeRegionId: null });

    expect(container.querySelector('.history-map')).toBeNull();
    expect(createMap).not.toHaveBeenCalled();
  });

  test('renders nothing — no panel, no placeholder — without an active region', () => {
    // Getting a basemap is the capture page's job; history offers no region
    // UI, so an empty frame here would be a question with no answer.
    const { createMap, container } = renderMap({ activeRegionId: null });

    expect(container.querySelector('.history-map')).toBeNull();
    expect(createMap).not.toHaveBeenCalled();
  });

  test('renders nothing for a session with no observations — there is nothing to fit to', () => {
    const { createMap, container } = renderMap({ observations: [] });

    expect(container.querySelector('.history-map')).toBeNull();
    expect(createMap).not.toHaveBeenCalled();
  });
});

describe('HistoryMap — showing a past session', () => {
  test("builds the map once, fitted to the session's observations", async () => {
    const { createMap } = renderMap();

    await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
    const call = createMap.mock.calls[0][0];
    expect(call.container).toBeInstanceOf(HTMLElement);
    expect(call.fit).toEqual(observationBounds(OBSERVATIONS));
  });

  test('hands the decorated observations to the adapter, and again when they change', async () => {
    const adapter = fakeAdapter();
    const { rerender } = renderMap({ createMap: vi.fn().mockResolvedValue(adapter) });

    await waitFor(() => expect(adapter.setObservations).toHaveBeenCalledWith(OBSERVATIONS));

    const next = [...OBSERVATIONS, { id: 'obs-3', lat: 51.7, lon: -0.3, exported: false }];
    rerender({ observations: next });

    await waitFor(() => expect(adapter.setObservations).toHaveBeenCalledWith(next));
  });

  test('applies night mode, and re-applies it on toggle', async () => {
    const adapter = fakeAdapter();
    const { rerender } = renderMap({ createMap: vi.fn().mockResolvedValue(adapter) });

    await waitFor(() => expect(adapter.setNightMode).toHaveBeenCalledWith(false));

    rerender({ night: true });

    await waitFor(() => expect(adapter.setNightMode).toHaveBeenCalledWith(true));
  });

  test('tears the map down on unmount', async () => {
    const adapter = fakeAdapter();
    const { unmount, createMap } = renderMap({ createMap: vi.fn().mockResolvedValue(adapter) });
    await waitFor(() => expect(createMap).toHaveBeenCalled());
    await waitFor(() => expect(adapter.setObservations).toHaveBeenCalled());

    unmount();

    expect(adapter.destroy).toHaveBeenCalled();
  });

  test('renders no controls at all — the view is read-only pan and zoom', async () => {
    const { createMap } = renderMap();
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  test('a map that fails to open reports in the panel, never a throw', async () => {
    renderMap({ createMap: vi.fn().mockRejectedValue(new Error('no archive stored')) });

    await waitFor(() => expect(screen.getByText(/no archive stored/)).toBeInTheDocument());
  });
});
