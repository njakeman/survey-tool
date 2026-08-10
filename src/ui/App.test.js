import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { html } from 'htm/preact';
import { App } from './App.js';

function createFakeService() {
  return {
    getOpenSession: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
    listObservations: vi.fn().mockResolvedValue([]),
    startSession: vi.fn(),
    endSession: vi.fn(),
    saveObservation: vi.fn(),
    countObservations: vi.fn().mockResolvedValue(0),
    deleteObservation: vi.fn(),
  };
}

function fakeSensors() {
  return {
    watchPosition: () => () => {},
    watchHeading: () => () => {},
    requestHeadingPermission: vi.fn().mockResolvedValue('granted'),
  };
}

function renderApp(overrides = {}) {
  return render(
    html`<${App}
      service=${overrides.service ?? createFakeService()}
      sensors=${overrides.sensors ?? fakeSensors()}
      downscale=${overrides.downscale ?? vi.fn()}
      exportSession=${overrides.exportSession ?? vi.fn()}
      offlineStatus=${overrides.offlineStatus}
      updateAvailable=${overrides.updateAvailable}
      onReload=${overrides.onReload}
      basemap=${overrides.basemap}
      createMap=${overrides.createMap ?? vi.fn()}
      downloadBasemap=${overrides.downloadBasemap ?? vi.fn()}
      online=${overrides.online}
      remoteSizeBytes=${overrides.remoteSizeBytes}
    />`,
  );
}

describe('App', () => {
  test('defaults to the capture view', async () => {
    renderApp();
    expect(await screen.findByRole('button', { name: /save observation/i })).toBeInTheDocument();
  });

  test('the device probe link switches to the probe view, and Back returns to capture', async () => {
    renderApp();
    await screen.findByRole('button', { name: /save observation/i });

    fireEvent.click(screen.getByRole('button', { name: /device probe/i }));
    expect(await screen.findByText('Device capability probe')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    expect(await screen.findByRole('button', { name: /save observation/i })).toBeInTheDocument();
  });

  test('the session history link switches to the history view, and Back returns to capture', async () => {
    renderApp();
    await screen.findByRole('button', { name: /save observation/i });

    fireEvent.click(screen.getByRole('button', { name: /session history/i }));
    expect(await screen.findByText('Past sessions')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    expect(await screen.findByRole('button', { name: /save observation/i })).toBeInTheDocument();
  });

  test('passes offlineStatus through to the capture view, surfacing the no-precache warning', async () => {
    renderApp({ offlineStatus: { precachedCount: 0, offlineReady: false } });

    expect(await screen.findByText(/no offline cache/i)).toBeInTheDocument();
  });

  test('shows no update banner by default', async () => {
    renderApp();
    await screen.findByRole('button', { name: /save observation/i });

    expect(screen.queryByText(/new version/i)).not.toBeInTheDocument();
  });

  test('shows an update banner and reloads on tap when an update is waiting', async () => {
    const onReload = vi.fn();
    renderApp({ updateAvailable: true, onReload });
    await screen.findByRole('button', { name: /save observation/i });

    fireEvent.click(await screen.findByRole('button', { name: /reload/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  test('the update banner is visible from every view, not just capture', async () => {
    renderApp({ updateAvailable: true, onReload: vi.fn() });
    await screen.findByRole('button', { name: /save observation/i });

    fireEvent.click(screen.getByRole('button', { name: /device probe/i }));
    await screen.findByText('Device capability probe');

    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  test('threads the basemap props down to the capture view', async () => {
    renderApp({ basemap: { state: 'absent' }, online: true });

    expect(
      await screen.findByRole('button', { name: /download offline map/i }),
    ).toBeInTheDocument();
  });

  test('tells the map when the capture view is hidden, so it can remeasure on return', async () => {
    const adapter = {
      ready: Promise.resolve(),
      setPosition: vi.fn(),
      setObservations: vi.fn(),
      centreOn: vi.fn(),
      resize: vi.fn(),
      destroy: vi.fn(),
    };
    const createMap = vi.fn().mockResolvedValue(adapter);
    renderApp({
      basemap: { state: 'present', sizeBytes: 1, downloadedAt: 'x', etag: '"v1"' },
      createMap,
      online: true,
    });
    await screen.findByRole('button', { name: /save observation/i });
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /session history/i }));
    await screen.findByText('Past sessions');
    adapter.resize.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));

    await waitFor(() => expect(adapter.resize).toHaveBeenCalled());
  });

  test('switching to history and back preserves an in-progress note', async () => {
    // The in-progress observation (note/photo) lives only in CapturePage
    // state until Save — a view switch must never wipe it (CLAUDE.md's
    // no-surprise-data-loss rule; unmounting the page is exactly that).
    renderApp();
    await screen.findByRole('button', { name: /save observation/i });

    fireEvent.input(screen.getByLabelText(/note/i), { target: { value: 'half-typed note' } });
    fireEvent.click(screen.getByRole('button', { name: /session history/i }));
    await screen.findByText('Past sessions');
    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));

    await screen.findByRole('button', { name: /save observation/i });
    expect(screen.getByLabelText(/note/i)).toHaveValue('half-typed note');
  });

  test('switching views neither tears down nor restarts the GPS watch', async () => {
    const positionStop = vi.fn();
    const watchPosition = vi.fn(() => positionStop);
    renderApp({
      sensors: {
        watchPosition,
        watchHeading: () => () => {},
        requestHeadingPermission: vi.fn().mockResolvedValue('granted'),
      },
    });
    await screen.findByRole('button', { name: /save observation/i });
    expect(watchPosition).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /session history/i }));
    await screen.findByText('Past sessions');
    expect(positionStop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    await screen.findByRole('button', { name: /save observation/i });
    expect(watchPosition).toHaveBeenCalledTimes(1); // no cold re-acquire
  });

  test('never touches window.location.hash — no client-side router', async () => {
    const initialHash = window.location.hash;
    renderApp();
    await screen.findByRole('button', { name: /save observation/i });

    fireEvent.click(screen.getByRole('button', { name: /device probe/i }));
    await screen.findByText('Device capability probe');
    expect(window.location.hash).toBe(initialHash);

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    await screen.findByRole('button', { name: /save observation/i });
    expect(window.location.hash).toBe(initialHash);
  });
});
