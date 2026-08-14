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
    getTraceDraft: vi.fn().mockResolvedValue(null),
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
      activeRegionId=${overrides.activeRegionId ?? null}
      statusKnown=${overrides.statusKnown ?? true}
      suggestion=${overrides.suggestion ?? null}
      regions=${overrides.regions ?? []}
      manifestAvailable=${overrides.manifestAvailable ?? true}
      createMap=${overrides.createMap ?? vi.fn()}
      onSelectRegion=${overrides.onSelectRegion ?? vi.fn()}
      onDownloadRegion=${overrides.onDownloadRegion ?? vi.fn()}
      onRemoveRegion=${overrides.onRemoveRegion ?? vi.fn()}
      onDismissSuggestion=${overrides.onDismissSuggestion ?? vi.fn()}
      online=${overrides.online}
    />`,
  );
}

describe('App', () => {
  test('defaults to the capture view', async () => {
    renderApp();
    expect(await screen.findByLabelText(/session name/i)).toBeInTheDocument();
  });

  test('the device probe link switches to the probe view, and Back returns to capture', async () => {
    renderApp();
    await screen.findByLabelText(/session name/i);

    fireEvent.click(screen.getByRole('button', { name: /device probe/i }));
    expect(await screen.findByText('Device capability probe')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    expect(await screen.findByLabelText(/session name/i)).toBeInTheDocument();
  });

  test('the session history link switches to the history view, and Back returns to capture', async () => {
    renderApp();
    await screen.findByLabelText(/session name/i);

    fireEvent.click(screen.getByRole('button', { name: /session history/i }));
    expect(await screen.findByText('Past sessions')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    expect(await screen.findByLabelText(/session name/i)).toBeInTheDocument();
  });

  test('history detail receives the map wiring, so a past session renders on the active basemap', async () => {
    const adapter = {
      ready: Promise.resolve(),
      setObservations: vi.fn(),
      setNightMode: vi.fn(),
      destroy: vi.fn(),
    };
    const createMap = vi.fn().mockResolvedValue(adapter);
    const service = createFakeService();
    service.listSessions.mockResolvedValue([
      { id: 'sess-a', name: 'Site A', status: 'closed', startedAt: '2026-08-05T09:00:00.000Z' },
    ]);
    service.listObservations.mockResolvedValue([
      {
        id: 'obs-1',
        sessionId: 'sess-a',
        fixAt: '2026-08-05T10:00:00.000Z',
        lat: 51.5,
        lon: -0.14,
        gpsAccuracyM: 8,
        note: '',
        photoId: null,
      },
    ]);
    renderApp({ service, createMap, activeRegionId: 'south' });
    await screen.findByLabelText(/session name/i);

    fireEvent.click(screen.getByRole('button', { name: /session history/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Site A/ }));

    // The capture map also builds from the same factory; the history call is
    // the one carrying a fit.
    await waitFor(() =>
      expect(createMap.mock.calls.some(([options]) => options.fit != null)).toBe(true),
    );
  });

  test('passes offlineStatus through to the capture view, surfacing the no-precache warning', async () => {
    renderApp({ offlineStatus: { precachedCount: 0, offlineReady: false } });

    expect(await screen.findByText(/no offline cache/i)).toBeInTheDocument();
  });

  test('shows no update banner by default', async () => {
    renderApp();
    await screen.findByLabelText(/session name/i);

    expect(screen.queryByText(/new version/i)).not.toBeInTheDocument();
  });

  test('shows an update banner and reloads on tap when an update is waiting', async () => {
    const onReload = vi.fn();
    renderApp({ updateAvailable: true, onReload });
    await screen.findByLabelText(/session name/i);

    fireEvent.click(await screen.findByRole('button', { name: /reload/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  test('the update banner is visible from every view, not just capture', async () => {
    renderApp({ updateAvailable: true, onReload: vi.fn() });
    await screen.findByLabelText(/session name/i);

    fireEvent.click(screen.getByRole('button', { name: /device probe/i }));
    await screen.findByText('Device capability probe');

    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  test('threads the basemap props down to the capture view', async () => {
    renderApp({ activeRegionId: null, online: true });

    expect(await screen.findByRole('button', { name: /choose a region/i })).toBeInTheDocument();
  });

  test('the map panel opens the region picker, and Back returns to capture', async () => {
    renderApp({
      activeRegionId: null,
      regions: [{ id: 'south', name: 'South Wiltshire', sizeBytes: 1, downloaded: true }],
    });
    await screen.findByLabelText(/session name/i);

    fireEvent.click(screen.getByRole('button', { name: /choose a region/i }));
    expect(await screen.findByText('Offline maps')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    expect(await screen.findByLabelText(/session name/i)).toBeInTheDocument();
  });

  test('tells the map when the capture view is hidden, so it can remeasure on return', async () => {
    const adapter = {
      ready: Promise.resolve(),
      setPosition: vi.fn(),
      setObservations: vi.fn(),
      setFeatureLayers: vi.fn(),
      centreOn: vi.fn(),
      resize: vi.fn(),
      destroy: vi.fn(),
    };
    const createMap = vi.fn().mockResolvedValue(adapter);
    renderApp({ activeRegionId: 'south', createMap, online: true });
    await screen.findByLabelText(/session name/i);
    await waitFor(() => expect(createMap).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /session history/i }));
    await screen.findByText('Past sessions');
    adapter.resize.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));

    await waitFor(() => expect(adapter.resize).toHaveBeenCalled());
  });

  test('switching views and back preserves an in-progress note', async () => {
    // The in-progress observation (note/photo) lives only in CapturePage
    // state until Save — a view switch must never wipe it (CLAUDE.md's
    // no-surprise-data-loss rule; unmounting the page is exactly that).
    // The note needs an open session (design pass 3 §5a gates the capture
    // block), and with one running the reachable views are the probe and
    // the region picker — history stands down (§5b).
    const service = createFakeService();
    service.getOpenSession.mockResolvedValue({
      id: 'sess-1',
      name: 'Site A',
      status: 'open',
      startedAt: '2026-08-06T09:00:00.000Z',
    });
    renderApp({ service });
    await screen.findByRole('button', { name: /save observation/i });

    fireEvent.input(screen.getByLabelText(/note/i), { target: { value: 'half-typed note' } });
    fireEvent.click(screen.getByRole('button', { name: /device probe/i }));
    await screen.findByText('Device capability probe');
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
    await screen.findByLabelText(/session name/i);
    expect(watchPosition).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /session history/i }));
    await screen.findByText('Past sessions');
    expect(positionStop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    await screen.findByLabelText(/session name/i);
    expect(watchPosition).toHaveBeenCalledTimes(1); // no cold re-acquire
  });

  test('loading a past session from history hands it to capture as the live session', async () => {
    // CapturePage stays mounted while history is open and re-reads nothing
    // on return — loading a session has to tell it explicitly, or the
    // reopened session would sit invisible until a relaunch.
    const past = {
      id: 'sess-a',
      name: 'Site A',
      status: 'closed',
      startedAt: '2026-08-05T09:00:00.000Z',
    };
    const service = createFakeService();
    let open = null;
    service.getOpenSession = vi.fn(() => Promise.resolve(open));
    service.listSessions = vi.fn().mockResolvedValue([past]);
    service.reopenSession = vi.fn(() => {
      open = { ...past, status: 'open', endedAt: null };
      return Promise.resolve(open);
    });
    renderApp({ service });
    await screen.findByLabelText(/session name/i);

    fireEvent.click(screen.getByRole('button', { name: /session history/i }));
    await screen.findByText('Site A');
    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));
    fireEvent.click(await screen.findByRole('button', { name: /load session/i }));

    // Straight back to capture, with the loaded session live in the bar —
    // the session is open now, so the capture block (Save) is what appears.
    await screen.findByRole('button', { name: /save observation/i });
    expect(await screen.findByText('Site A')).toBeInTheDocument();
    expect(screen.queryByText('Past sessions')).not.toBeInTheDocument();
  });

  test('never touches window.location.hash — no client-side router', async () => {
    const initialHash = window.location.hash;
    renderApp();
    await screen.findByLabelText(/session name/i);

    fireEvent.click(screen.getByRole('button', { name: /device probe/i }));
    await screen.findByText('Device capability probe');
    expect(window.location.hash).toBe(initialHash);

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    await screen.findByLabelText(/session name/i);
    expect(window.location.hash).toBe(initialHash);
  });
});
