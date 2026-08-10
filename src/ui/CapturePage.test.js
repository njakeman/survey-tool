import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/preact';
import { html } from 'htm/preact';
import { CapturePage } from './CapturePage.js';

const OPEN_SESSION = {
  id: 'sess-1',
  name: 'Ashton Keynes',
  status: 'open',
  startedAt: '2026-08-06T09:00:00.000Z',
};
const POSITION = {
  lat: 51.5,
  lon: -0.14,
  accuracyM: 8.2,
  altitudeM: null,
  altitudeAccuracyM: null,
  fixAt: 'x',
  fixAtMs: 1,
};
const HEADING = { headingDeg: 247, headingAccuracyDeg: 5, source: 'webkit-compass' };

function createFakeService({ openSession = null, observations = [] } = {}) {
  return {
    getOpenSession: vi.fn().mockResolvedValue(openSession),
    startSession: vi.fn().mockResolvedValue(OPEN_SESSION),
    endSession: vi.fn().mockResolvedValue({ ...OPEN_SESSION, status: 'closed' }),
    saveObservation: vi.fn().mockResolvedValue({ id: 'obs-1', sessionId: 'sess-1' }),
    countObservations: vi.fn().mockResolvedValue(observations.length),
    listObservations: vi.fn().mockResolvedValue(observations),
    deleteObservation: vi.fn().mockResolvedValue(undefined),
  };
}

function renderPage({
  service,
  sensors,
  downscale = vi.fn(),
  exportSession = vi.fn(),
  onOpenHistory = vi.fn(),
  offlineStatus,
} = {}) {
  return render(
    html`<${CapturePage}
      service=${service}
      sensors=${sensors}
      downscale=${downscale}
      exportSession=${exportSession}
      onOpenHistory=${onOpenHistory}
      offlineStatus=${offlineStatus}
    />`,
  );
}

function createFakeSensors() {
  let positionHandlers = null;
  let headingHandlers = null;
  const positionStop = vi.fn();
  const headingStop = vi.fn();
  return {
    sensors: {
      watchPosition: (handlers) => {
        positionHandlers = handlers;
        return positionStop;
      },
      watchHeading: (handlers) => {
        headingHandlers = handlers;
        return headingStop;
      },
      requestHeadingPermission: vi.fn().mockResolvedValue('granted'),
    },
    pushPosition: (reading) => act(() => positionHandlers?.onReading(reading)),
    pushHeading: (reading) => act(() => headingHandlers?.onReading(reading)),
    positionStop,
    headingStop,
  };
}

describe('CapturePage — session', () => {
  test("mounts with no open session, showing the start form pre-filled with today's date", async () => {
    const service = createFakeService({ openSession: null });
    const { sensors } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);

    const input = await screen.findByLabelText(/session name/i);
    expect(input).toHaveValue(new Date().toISOString().slice(0, 10));
  });

  test('mounts with an open session and shows it', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);

    await screen.findByText('Ashton Keynes');
  });
});

describe('CapturePage — save gating', () => {
  test('save is disabled with no fix, and the reason is shown', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);

    await screen.findByText('Ashton Keynes');
    expect(screen.getByRole('button', { name: /save observation/i })).toBeDisabled();
    // Exact match: ReadingsPanel's own "Waiting for GPS fix…" text also
    // matches a case-insensitive substring search, so disambiguate exactly.
    expect(screen.getByText('waiting for GPS fix')).toBeInTheDocument();
  });

  test('pushing a position reading through the sensor enables save', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors, pushPosition } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByText('Ashton Keynes');

    pushPosition(POSITION);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save observation/i })).not.toBeDisabled(),
    );
  });

  test('save is disabled with a fix but no open session', async () => {
    const service = createFakeService({ openSession: null });
    const { sensors, pushPosition } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByLabelText(/session name/i);

    pushPosition(POSITION);

    await waitFor(() => expect(screen.getByText(/start a session/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /save observation/i })).toBeDisabled();
  });
});

describe('CapturePage — saving an observation', () => {
  async function renderReady(serviceOverrides) {
    const service = createFakeService({ openSession: OPEN_SESSION, ...serviceOverrides });
    const { sensors, pushPosition, pushHeading, positionStop, headingStop } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByText('Ashton Keynes');
    pushPosition(POSITION);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save observation/i })).not.toBeDisabled(),
    );
    return { service, sensors, pushPosition, pushHeading, positionStop, headingStop };
  }

  // The compass watcher only registers once "Enable compass" is tapped
  // (useHeading's enable()) — pushHeading is a no-op before that.
  async function enableCompassAndWait() {
    fireEvent.click(screen.getByRole('button', { name: /enable compass/i }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /enable compass/i })).not.toBeInTheDocument(),
    );
  }

  test('tapping Save calls saveObservation with the reading, heading, note and photo on screen', async () => {
    const { service, pushHeading } = await renderReady();
    await enableCompassAndWait();
    pushHeading(HEADING);
    fireEvent.input(screen.getByLabelText(/note/i), { target: { value: 'gate post' } });

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));

    await waitFor(() =>
      expect(service.saveObservation).toHaveBeenCalledWith({
        reading: POSITION,
        heading: HEADING,
        note: 'gate post',
        photo: null,
      }),
    );
  });

  test('after a successful save, the note and photo are cleared and the count updates', async () => {
    const { service } = await renderReady();
    service.listObservations.mockResolvedValue([{ id: 'obs-1', sessionId: 'sess-1' }]);
    fireEvent.input(screen.getByLabelText(/note/i), { target: { value: 'gate post' } });

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));

    await waitFor(() => expect(screen.getByLabelText(/note/i)).toHaveValue(''));
    await waitFor(() => expect(screen.getByText(/1 saved/)).toBeInTheDocument());
  });

  test('the observations table shows a newly-saved observation without a reload', async () => {
    const savedObservation = {
      id: 'obs-1',
      sessionId: 'sess-1',
      fixAt: POSITION.fixAt,
      lat: POSITION.lat,
      lon: POSITION.lon,
      gpsAccuracyM: POSITION.accuracyM,
      headingDeg: null,
      note: 'gate post',
      photoId: null,
    };
    const { service } = await renderReady();
    service.saveObservation.mockResolvedValue(savedObservation);
    service.listObservations.mockResolvedValue([savedObservation]);
    fireEvent.input(screen.getByLabelText(/note/i), { target: { value: 'gate post' } });

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));

    expect(await screen.findByRole('row', { name: /51\.500000, -0\.140000/ })).toBeInTheDocument();
  });

  test('after a failed save, the note and photo are retained and an error is shown', async () => {
    const { service } = await renderReady();
    service.saveObservation.mockRejectedValue(new Error('disk full'));
    fireEvent.input(screen.getByLabelText(/note/i), { target: { value: 'gate post' } });

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));

    await screen.findByText(/disk full/);
    expect(screen.getByLabelText(/note/i)).toHaveValue('gate post');
  });

  test('double-tapping Save only calls saveObservation once', async () => {
    const { service } = await renderReady();
    let resolveSave;
    service.saveObservation.mockReturnValue(new Promise((resolve) => (resolveSave = resolve)));

    const button = screen.getByRole('button', { name: /save observation/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(service.saveObservation).toHaveBeenCalledTimes(1);
    await act(async () => resolveSave({ id: 'obs-1' }));
  });

  test('selecting a photo calls the injected downscale and stores its result', async () => {
    const downscaleResult = {
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      width: 100,
      height: 100,
    };
    const downscale = vi.fn().mockResolvedValue(downscaleResult);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${downscale} />`);
    await screen.findByText('Ashton Keynes');
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });

    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

    expect(downscale).toHaveBeenCalledWith(file);
    await screen.findByRole('img');

    URL.createObjectURL.mockRestore();
    URL.revokeObjectURL.mockRestore();
  });

  test('a rejecting downscale shows a photo error and does not crash the page', async () => {
    const downscale = vi.fn().mockRejectedValue(new Error('could not decode'));
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${downscale} />`);
    await screen.findByText('Ashton Keynes');
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });

    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });

    await screen.findByText(/could not decode/);
  });
});

describe('CapturePage — undo lifecycle', () => {
  async function renderReadyWithSave() {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors, pushPosition } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByText('Ashton Keynes');
    pushPosition(POSITION);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save observation/i })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));
    await screen.findByRole('button', { name: /undo/i });
    return { service };
  }

  test('ending the session removes the Undo affordance', async () => {
    // A surviving Undo would delete from a session that is already closed.
    const { service } = await renderReadyWithSave();
    service.getOpenSession.mockResolvedValue(null);

    fireEvent.click(screen.getByRole('button', { name: /^end session$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm end session/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument(),
    );
  });

  test('a failed undo shows an inline error instead of escaping to the fatal handler', async () => {
    const { service } = await renderReadyWithSave();
    service.deleteObservation.mockRejectedValue(new Error('delete failed'));

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));

    await screen.findByText(/delete failed/);
    // Undo stays available so the surveyor can retry.
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
  });
});

describe('CapturePage — lifecycle and gesture ordering', () => {
  test('unmount stops the position watcher (always active) and the heading watcher once enabled', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors, positionStop, headingStop } = createFakeSensors();
    const { unmount } = render(
      html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`,
    );
    await screen.findByText('Ashton Keynes');
    fireEvent.click(screen.getByRole('button', { name: /enable compass/i }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /enable compass/i })).not.toBeInTheDocument(),
    );

    unmount();

    expect(positionStop).toHaveBeenCalled();
    expect(headingStop).toHaveBeenCalled();
  });

  test('Start-session calls requestHeadingPermission before awaiting startSession (iOS gesture rule)', async () => {
    const service = createFakeService({ openSession: null });
    const { sensors } = createFakeSensors();
    const callOrder = [];
    sensors.requestHeadingPermission = vi.fn(() => {
      callOrder.push('requestHeadingPermission');
      return Promise.resolve('granted');
    });
    service.startSession = vi.fn(() => {
      callOrder.push('startSession');
      return Promise.resolve(OPEN_SESSION);
    });
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByLabelText(/session name/i);

    fireEvent.click(screen.getByRole('button', { name: /start session/i }));

    await waitFor(() => expect(service.startSession).toHaveBeenCalled());
    expect(callOrder).toEqual(['requestHeadingPermission', 'startSession']);
  });
});

describe('CapturePage — session history link and export', () => {
  test('tapping "Session history" calls onOpenHistory', async () => {
    const service = createFakeService({ openSession: null });
    const { sensors } = createFakeSensors();
    const onOpenHistory = vi.fn();
    renderPage({ service, sensors, onOpenHistory });
    await screen.findByLabelText(/session name/i);

    fireEvent.click(screen.getByRole('button', { name: /session history/i }));

    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  test('there is no Export button when no session is open', async () => {
    const service = createFakeService({ openSession: null });
    const { sensors } = createFakeSensors();
    renderPage({ service, sensors });
    await screen.findByLabelText(/session name/i);

    expect(screen.queryByRole('button', { name: /^export$/i })).not.toBeInTheDocument();
  });

  test('tapping Export on the open session calls exportSession with its id and shows a success message', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();
    const exportSession = vi.fn().mockResolvedValue({ method: 'share' });
    renderPage({ service, sensors, exportSession });
    await screen.findByText('Ashton Keynes');

    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    expect(exportSession).toHaveBeenCalledWith('sess-1');
    await waitFor(() => expect(screen.getByText(/shared/i)).toBeInTheDocument());
  });

  test('a failed export shows an error rather than crashing the page', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();
    const exportSession = vi.fn().mockRejectedValue(new Error('zip failed'));
    renderPage({ service, sensors, exportSession });
    await screen.findByText('Ashton Keynes');

    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    await screen.findByText(/zip failed/);
  });
});

describe('CapturePage — map panel', () => {
  const PRESENT_BASEMAP = { state: 'present', sizeBytes: 1, downloadedAt: 'x', etag: '"v1"' };

  test('feeds the live fix and saved observations to the map', async () => {
    const observations = [{ id: 'obs-1', lat: 51.5, lon: -0.14, synced: false }];
    const adapter = {
      ready: Promise.resolve(),
      setPosition: vi.fn(),
      setObservations: vi.fn(),
      centreOn: vi.fn(),
      resize: vi.fn(),
      destroy: vi.fn(),
    };
    const createMap = vi.fn().mockResolvedValue(adapter);
    const service = createFakeService({ openSession: OPEN_SESSION, observations });
    const { sensors, pushPosition } = createFakeSensors();

    render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        basemap=${PRESENT_BASEMAP}
        createMap=${createMap}
        downloadBasemap=${vi.fn()}
        visible=${true}
        online=${true}
      />`,
    );
    await screen.findByText('Ashton Keynes');
    pushPosition(POSITION);

    await waitFor(() => expect(adapter.setPosition).toHaveBeenCalledWith(POSITION));
    await waitFor(() => expect(adapter.setObservations).toHaveBeenCalledWith(observations));
  });

  test('offers the basemap download when no archive is stored', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();

    render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        basemap=${{ state: 'absent' }}
        createMap=${vi.fn()}
        downloadBasemap=${vi.fn()}
        visible=${true}
        online=${true}
      />`,
    );

    expect(
      await screen.findByRole('button', { name: /download offline map/i }),
    ).toBeInTheDocument();
  });
});

describe('CapturePage — offline status badge', () => {
  test('no badge when offlineStatus is not supplied', async () => {
    const service = createFakeService({ openSession: null });
    const { sensors } = createFakeSensors();
    renderPage({ service, sensors });
    await screen.findByLabelText(/session name/i);

    expect(screen.queryByText(/no offline cache/i)).not.toBeInTheDocument();
  });

  test('no badge when the build has real precached entries', async () => {
    const service = createFakeService({ openSession: null });
    const { sensors } = createFakeSensors();
    renderPage({
      service,
      sensors,
      offlineStatus: { precachedCount: 9, offlineReady: true },
    });
    await screen.findByLabelText(/session name/i);

    expect(screen.queryByText(/no offline cache/i)).not.toBeInTheDocument();
  });

  test('shows a warning when the build has nothing precached (dev server, not a production build)', async () => {
    const service = createFakeService({ openSession: null });
    const { sensors } = createFakeSensors();
    renderPage({
      service,
      sensors,
      offlineStatus: { precachedCount: 0, offlineReady: false },
    });
    await screen.findByLabelText(/session name/i);

    expect(screen.getByText(/no offline cache/i)).toBeInTheDocument();
  });
});
