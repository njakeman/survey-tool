import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { html } from 'htm/preact';
import { CaptureMap } from './CaptureMap.js';

const PRESENT = { state: 'present', sizeBytes: 24_000_000, downloadedAt: 'x', etag: '"v1"' };
const ABSENT = { state: 'absent', sizeBytes: null, downloadedAt: null, etag: null };
const UNKNOWN = { state: 'unknown', sizeBytes: null, downloadedAt: null, etag: null };

const POSITION = { lat: 51.5, lon: -0.14, accuracyM: 8 };

function fakeAdapter() {
  return {
    ready: Promise.resolve(),
    setPosition: vi.fn(),
    setObservations: vi.fn(),
    centreOn: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  };
}

function renderMap({
  basemap = PRESENT,
  adapter = fakeAdapter(),
  createMap,
  downloadBasemap = vi.fn().mockResolvedValue(undefined),
  position = null,
  observations = [],
  visible = true,
  online = true,
  remoteSizeBytes = null,
} = {}) {
  const create = createMap ?? vi.fn().mockResolvedValue(adapter);
  const result = render(
    html`<${CaptureMap}
      basemap=${basemap}
      createMap=${create}
      downloadBasemap=${downloadBasemap}
      position=${position}
      observations=${observations}
      visible=${visible}
      online=${online}
      remoteSizeBytes=${remoteSizeBytes}
    />`,
  );
  return { ...result, adapter, createMap: create, downloadBasemap };
}

describe('CaptureMap — archive absent', () => {
  test('offers the download with its size when online', async () => {
    renderMap({ basemap: ABSENT, remoteSizeBytes: 24_000_000 });

    const button = await screen.findByRole('button', { name: /download offline map/i });
    expect(button).toBeInTheDocument();
    expect(screen.getByText(/24 MB/)).toBeInTheDocument();
  });

  test('offers the download without a size when the size is unknown', async () => {
    renderMap({ basemap: ABSENT, remoteSizeBytes: null });

    expect(
      await screen.findByRole('button', { name: /download offline map/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\bMB\b/)).not.toBeInTheDocument();
  });

  test('explains rather than offering an impossible download when offline', async () => {
    renderMap({ basemap: ABSENT, online: false });

    expect(await screen.findByText(/connect to download/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download offline map/i })).not.toBeInTheDocument();
  });

  test('never builds a map without an archive', () => {
    const { createMap } = renderMap({ basemap: ABSENT });
    expect(createMap).not.toHaveBeenCalled();
  });
});

describe('CaptureMap — archive status unknown', () => {
  test('says nothing and offers nothing: unknown is not absent', async () => {
    // A failed read must not nag the surveyor to re-download tens of
    // megabytes they may well already have.
    const { createMap } = renderMap({ basemap: UNKNOWN });

    expect(screen.queryByRole('button', { name: /download offline map/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/connect to download/i)).not.toBeInTheDocument();
    expect(createMap).not.toHaveBeenCalled();
  });
});

describe('CaptureMap — downloading', () => {
  test('shows progress while the archive downloads', async () => {
    const downloadBasemap = vi.fn((onProgress) => {
      onProgress({ receivedBytes: 12_000_000, totalBytes: 24_000_000 });
      return new Promise(() => {}); // stays in flight
    });
    renderMap({ basemap: ABSENT, downloadBasemap, remoteSizeBytes: 24_000_000 });

    fireEvent.click(await screen.findByRole('button', { name: /download offline map/i }));

    expect(await screen.findByText(/50%/)).toBeInTheDocument();
  });

  test('reports progress without a percentage when the total is unknown', async () => {
    const downloadBasemap = vi.fn((onProgress) => {
      onProgress({ receivedBytes: 3_000_000, totalBytes: null });
      return new Promise(() => {});
    });
    renderMap({ basemap: ABSENT, downloadBasemap });

    fireEvent.click(await screen.findByRole('button', { name: /download offline map/i }));

    expect(await screen.findByText(/3 MB/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  test('a failed download shows an error and lets the surveyor retry', async () => {
    const downloadBasemap = vi.fn().mockRejectedValue(new Error('connection lost'));
    renderMap({ basemap: ABSENT, downloadBasemap });

    fireEvent.click(await screen.findByRole('button', { name: /download offline map/i }));

    expect(await screen.findByText(/connection lost/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('CaptureMap — archive present', () => {
  test('builds the map exactly once', async () => {
    const { createMap, rerender } = renderMap();
    await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));

    rerender(
      html`<${CaptureMap}
        basemap=${PRESENT}
        createMap=${createMap}
        downloadBasemap=${vi.fn()}
        position=${POSITION}
        observations=${[]}
        visible=${true}
        online=${true}
      />`,
    );

    await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
  });

  test('pushes the current fix to the map and centres on it', async () => {
    const adapter = fakeAdapter();
    const { rerender, createMap, downloadBasemap } = renderMap({ adapter });
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    rerender(
      html`<${CaptureMap}
        basemap=${PRESENT}
        createMap=${createMap}
        downloadBasemap=${downloadBasemap}
        position=${POSITION}
        observations=${[]}
        visible=${true}
        online=${true}
      />`,
    );

    await waitFor(() => expect(adapter.setPosition).toHaveBeenCalledWith(POSITION));
    expect(adapter.centreOn).toHaveBeenCalledWith(POSITION);
  });

  test('pushes saved observations to the map', async () => {
    const adapter = fakeAdapter();
    const observations = [{ id: 'obs-1', lat: 51.5, lon: -0.14, synced: false }];
    const { rerender, createMap, downloadBasemap } = renderMap({ adapter });
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    rerender(
      html`<${CaptureMap}
        basemap=${PRESENT}
        createMap=${createMap}
        downloadBasemap=${downloadBasemap}
        position=${null}
        observations=${observations}
        visible=${true}
        online=${true}
      />`,
    );

    await waitFor(() => expect(adapter.setObservations).toHaveBeenCalledWith(observations));
  });

  test('resizes when the capture view becomes visible again', async () => {
    // CapturePage stays mounted while hidden, so the map is laid out at zero
    // size until the surveyor comes back — without a resize it stays blank.
    const adapter = fakeAdapter();
    const { rerender, createMap, downloadBasemap } = renderMap({ adapter, visible: false });
    await waitFor(() => expect(createMap).toHaveBeenCalled());
    adapter.resize.mockClear();

    rerender(
      html`<${CaptureMap}
        basemap=${PRESENT}
        createMap=${createMap}
        downloadBasemap=${downloadBasemap}
        position=${null}
        observations=${[]}
        visible=${true}
        online=${true}
      />`,
    );

    await waitFor(() => expect(adapter.resize).toHaveBeenCalled());
  });

  test('tears the map down on unmount', async () => {
    const adapter = fakeAdapter();
    const { unmount, createMap } = renderMap({ adapter });
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    unmount();

    await waitFor(() => expect(adapter.destroy).toHaveBeenCalled());
  });
});

describe('CaptureMap — follow mode', () => {
  async function renderWithFix() {
    const adapter = fakeAdapter();
    const rendered = renderMap({ adapter, position: POSITION });
    await waitFor(() => expect(adapter.setPosition).toHaveBeenCalledWith(POSITION));
    return { ...rendered, adapter };
  }

  test('no re-centre button while the map is following', async () => {
    await renderWithFix();
    expect(screen.queryByRole('button', { name: /re-?centre/i })).not.toBeInTheDocument();
  });

  test('panning offers re-centre, and tapping it centres on the fix again', async () => {
    const { adapter, createMap } = await renderWithFix();
    const { onUserPan } = createMap.mock.calls[0][0];
    adapter.centreOn.mockClear();

    onUserPan();

    const button = await screen.findByRole('button', { name: /re-?centre/i });
    fireEvent.click(button);

    await waitFor(() => expect(adapter.centreOn).toHaveBeenCalledWith(POSITION));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /re-?centre/i })).not.toBeInTheDocument(),
    );
  });
});
