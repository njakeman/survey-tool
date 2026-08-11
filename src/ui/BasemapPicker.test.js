import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { html } from 'htm/preact';
import { BasemapPicker } from './BasemapPicker.js';

const SOUTH = {
  id: 'south',
  name: 'South Wiltshire',
  sizeBytes: 24_000_000,
  bounds: [-1, 51, 0.5, 52],
  downloaded: true,
};
const NORTH = {
  id: 'north',
  name: 'North Wiltshire',
  sizeBytes: 18_000_000,
  bounds: [-2.5, 53, -1, 54],
  downloaded: false,
};

function renderPicker({
  regions = [SOUTH, NORTH],
  manifestAvailable = true,
  activeId = 'south',
  onSelect = vi.fn(),
  onDownload = vi.fn().mockResolvedValue(undefined),
  onRemove = vi.fn().mockResolvedValue(undefined),
  onBack = vi.fn(),
  online = true,
} = {}) {
  const result = render(
    html`<${BasemapPicker}
      regions=${regions}
      manifestAvailable=${manifestAvailable}
      activeId=${activeId}
      onSelect=${onSelect}
      onDownload=${onDownload}
      onRemove=${onRemove}
      onBack=${onBack}
      online=${online}
    />`,
  );
  return { ...result, onSelect, onDownload, onRemove, onBack };
}

describe('BasemapPicker', () => {
  test('lists every published region with its size', () => {
    renderPicker();

    expect(screen.getByRole('button', { name: /^South Wiltshire/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^North Wiltshire/ })).toBeInTheDocument();
    expect(screen.getByText(/24 MB/)).toBeInTheDocument();
    expect(screen.getByText(/18 MB/)).toBeInTheDocument();
  });

  test('says what kind of archive a region is and how deep it goes', () => {
    // tileType and the zoom range are already in the manifest and already
    // carried through basemapService — and they matter before committing to
    // a download: a raster region behaves differently on screen, and z5–15
    // will not zoom in as far as the surveyor might expect.
    renderPicker({
      regions: [{ ...SOUTH, tileType: 'vector', minZoom: 5, maxZoom: 15 }],
    });

    expect(screen.getByText('24 MB · vector · z5–15')).toBeInTheDocument();
  });

  test('omits what the manifest could not tell us rather than printing blanks', () => {
    // Offline, listAvailable() falls back to what is on the device, and an
    // older download may have no recorded type or zoom range.
    renderPicker({ regions: [{ ...SOUTH, tileType: null, minZoom: null, maxZoom: null }] });

    expect(screen.getByText('24 MB')).toBeInTheDocument();
  });

  test('marks which region the map is currently using', () => {
    renderPicker({ activeId: 'south' });

    expect(screen.getByRole('button', { name: /^South Wiltshire/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: /^North Wiltshire/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  test('selecting a downloaded region reports it and goes back to the map', async () => {
    const { onSelect, onBack } = renderPicker({ activeId: null });

    fireEvent.click(screen.getByRole('button', { name: /^South Wiltshire/ }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('south'));
    expect(onBack).toHaveBeenCalled();
  });

  test('a region that is not downloaded offers a download rather than selection', async () => {
    const { onSelect, onDownload } = renderPicker();

    fireEvent.click(screen.getByRole('button', { name: /^North Wiltshire/ }));

    await waitFor(() => expect(onDownload).toHaveBeenCalledWith('north', expect.any(Function)));
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('shows progress while a region downloads', async () => {
    const onDownload = vi.fn((id, onProgress) => {
      onProgress({ receivedBytes: 9_000_000, totalBytes: 18_000_000 });
      return new Promise(() => {});
    });
    renderPicker({ onDownload });

    fireEvent.click(screen.getByRole('button', { name: /^North Wiltshire/ }));

    expect(await screen.findByText(/50%/)).toBeInTheDocument();
  });

  test('a failed download is reported against that region and can be retried', async () => {
    const onDownload = vi.fn().mockRejectedValue(new Error('connection lost'));
    renderPicker({ onDownload });

    fireEvent.click(screen.getByRole('button', { name: /^North Wiltshire/ }));

    expect(await screen.findByText(/connection lost/)).toBeInTheDocument();
    // The row is still actionable rather than stuck mid-download.
    expect(screen.getByRole('button', { name: /^North Wiltshire/ })).toBeEnabled();
  });

  test('cannot start a download while offline', () => {
    renderPicker({ online: false });

    expect(screen.getByRole('button', { name: /^North Wiltshire/ })).toBeDisabled();
    expect(screen.getByText(/connect to download/i)).toBeInTheDocument();
  });

  test('offers to free space by removing a downloaded region other than the active one', async () => {
    const { onRemove } = renderPicker({
      activeId: 'north',
      regions: [SOUTH, { ...NORTH, downloaded: true }],
    });

    fireEvent.click(screen.getByRole('button', { name: /remove south wiltshire/i }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('south'));
  });

  test('does not offer to remove the region the map is using', () => {
    renderPicker({ activeId: 'south' });

    expect(
      screen.queryByRole('button', { name: /remove south wiltshire/i }),
    ).not.toBeInTheDocument();
  });

  test('says so when no regions are published at all', () => {
    renderPicker({ regions: [], manifestAvailable: true });

    expect(screen.getByText(/no offline maps are published/i)).toBeInTheDocument();
  });

  test('explains a list that could not be fetched, rather than claiming there are none', () => {
    // "Couldn't reach the list" and "there are no maps" are different facts;
    // conflating them would tell a surveyor their regions had vanished.
    renderPicker({ regions: [SOUTH], manifestAvailable: false });

    expect(screen.getByText(/could not be checked/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^South Wiltshire/ })).toBeInTheDocument();
  });

  test('Back returns to the map', () => {
    const { onBack } = renderPicker();

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));

    expect(onBack).toHaveBeenCalled();
  });
});
