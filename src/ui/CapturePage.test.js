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
  recordAudio,
} = {}) {
  return render(
    html`<${CapturePage}
      service=${service}
      sensors=${sensors}
      downscale=${downscale}
      exportSession=${exportSession}
      onOpenHistory=${onOpenHistory}
      offlineStatus=${offlineStatus}
      recordAudio=${recordAudio}
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

    // The full phrase, not /start a session/: the first-launch headline
    // ("Start a session to begin capturing") matches the loose pattern too.
    await waitFor(() => expect(screen.getByText(/start a session first/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /save observation/i })).toBeDisabled();
  });
});

describe('CapturePage — saving an observation', () => {
  async function renderReady(serviceOverrides, { recordAudio } = {}) {
    const service = createFakeService({ openSession: OPEN_SESSION, ...serviceOverrides });
    const { sensors, pushPosition, pushHeading, positionStop, headingStop } = createFakeSensors();
    render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        recordAudio=${recordAudio}
      />`,
    );
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
        audio: null,
        // Both explicitly null rather than omitted, and asserted as part of
        // the exact object: an observation with no source feature and no
        // marked point has to say so, or a stale one from a previous save
        // could slip through unnoticed.
        feature: null,
        pickedPoint: null,
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

    // A card list now, not a table. A listitem has no accessible name from
    // its contents the way a table row does, so match the text itself.
    expect(await screen.findByText(/51\.500000, -0\.140000/)).toBeInTheDocument();
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

  test('a save is confirmed with the running count, not just an Undo link', async () => {
    // "last saved · Undo" alone never told the surveyor a save had landed —
    // the only feedback was a control appearing. The count is the receipt.
    const observation = { id: 'obs-1', sessionId: 'sess-1', lat: 51.5, lon: -0.14 };
    const service = createFakeService({ openSession: OPEN_SESSION, observations: [observation] });
    const { sensors, pushPosition } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByText('Ashton Keynes');
    pushPosition(POSITION);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save observation/i })).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));

    await screen.findByRole('button', { name: /undo/i });
    expect(screen.getByText(/1 this session/i)).toBeInTheDocument();
  });

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

describe('CapturePage — voice note', () => {
  const NOTE = { blob: new Blob([new Uint8Array(16)], { type: 'audio/mp4' }), durationMs: 2500 };

  async function renderWithRecorder() {
    const handle = { stop: vi.fn().mockResolvedValue(NOTE), cancel: vi.fn() };
    const recordAudio = vi.fn().mockResolvedValue(handle);
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors, pushPosition } = createFakeSensors();
    render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        recordAudio=${recordAudio}
      />`,
    );
    await screen.findByText('Ashton Keynes');
    pushPosition(POSITION);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save observation/i })).not.toBeDisabled(),
    );
    return { service };
  }

  test('a recorded note rides in the save and is cleared by it', async () => {
    const { service } = await renderWithRecorder();

    fireEvent.click(screen.getByRole('button', { name: 'Record voice note' }));
    await screen.findByText(/Recording ·/);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(document.querySelector('audio.voice-note-player')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));

    await waitFor(() =>
      expect(service.saveObservation).toHaveBeenCalledWith(
        expect.objectContaining({ audio: NOTE }),
      ),
    );
    // Cleared with the note and photo: the recording belongs to the
    // observation just saved, not the next one.
    await waitFor(() => expect(document.querySelector('audio.voice-note-player')).toBeNull());
    expect(screen.getByRole('button', { name: 'Record voice note' })).toBeInTheDocument();
  });

  test('without an injected recorder the field simply is not offered', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByText('Ashton Keynes');

    expect(screen.queryByRole('button', { name: 'Record voice note' })).toBeNull();
  });
});

describe('CapturePage — map panel', () => {
  test('feeds the live fix and saved observations to the map', async () => {
    const observations = [{ id: 'obs-1', lat: 51.5, lon: -0.14 }];
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
    const service = createFakeService({ openSession: OPEN_SESSION, observations });
    const { sensors, pushPosition } = createFakeSensors();

    render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        activeRegionId=${'south'}
        statusKnown=${true}
        createMap=${createMap}
        visible=${true}
      />`,
    );
    await screen.findByText('Ashton Keynes');
    pushPosition(POSITION);

    await waitFor(() => expect(adapter.setPosition).toHaveBeenCalledWith(POSITION));
    await waitFor(() =>
      // Decorated on the way through: exported-or-not travels with each
      // observation to the markers.
      expect(adapter.setObservations).toHaveBeenCalledWith([
        { id: 'obs-1', lat: 51.5, lon: -0.14, exported: false },
      ]),
    );
  });

  test('offers the region covering the current fix when a different one is in use', async () => {
    // The fix only exists here, inside the sensor hook, so this is where the
    // suggestion has to be worked out.
    const regions = [
      { id: 'south', name: 'South', bounds: [-1, 51, 0.5, 52], downloaded: true },
      { id: 'north', name: 'North Wiltshire', bounds: [-2.5, 53, -1, 54], downloaded: true },
    ];
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors, pushPosition } = createFakeSensors();

    render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        activeRegionId=${'south'}
        statusKnown=${true}
        regions=${regions}
        createMap=${vi.fn().mockResolvedValue({
          ready: Promise.resolve(),
          setPosition: vi.fn(),
          setObservations: vi.fn(),
          setFeatureLayers: vi.fn(),
          centreOn: vi.fn(),
          resize: vi.fn(),
          destroy: vi.fn(),
        })}
        visible=${true}
      />`,
    );
    await screen.findByText('Ashton Keynes');

    pushPosition({ lat: 53.8, lon: -1.55, accuracyM: 8, fixAt: 'x', fixAtMs: 1 });

    expect(await screen.findByText(/North Wiltshire/)).toBeInTheDocument();
  });

  test('offers the region picker when no region is active', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();
    const onOpenPicker = vi.fn();

    render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        activeRegionId=${null}
        statusKnown=${true}
        createMap=${vi.fn()}
        onOpenPicker=${onOpenPicker}
        visible=${true}
      />`,
    );

    fireEvent.click(await screen.findByRole('button', { name: /choose a region/i }));

    expect(onOpenPicker).toHaveBeenCalled();
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

describe('CapturePage — recording against a map feature', () => {
  const FEATURE = {
    layerId: 'parcels',
    layerName: 'Field parcels',
    featureId: 'P-42',
    title: 'SU1408 3921',
    fields: [{ key: 'area_ha', value: '4.2' }],
  };

  function renderWithMap({ service, sensors }) {
    let tap;
    const adapter = {
      ready: Promise.resolve(),
      setPosition: vi.fn(),
      setObservations: vi.fn(),
      setFeatureLayers: vi.fn(),
      centreOn: vi.fn(),
      resize: vi.fn(),
      destroy: vi.fn(),
    };
    const createMap = vi.fn((options) => {
      tap = options.onFeatureTap;
      return Promise.resolve(adapter);
    });
    render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        activeRegionId=${'south'}
        statusKnown=${true}
        createMap=${createMap}
        visible=${true}
      />`,
    );
    return { tapFeature: (feature) => act(() => tap(feature)) };
  }

  async function armedPage() {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors, pushPosition } = createFakeSensors();
    const map = renderWithMap({ service, sensors });
    await screen.findByText('Ashton Keynes');
    pushPosition(POSITION);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save observation/i })).not.toBeDisabled(),
    );
    return { service, ...map };
  }

  test('a tap on the map shows the feature, and tapping empty map puts it away', async () => {
    const { tapFeature } = await armedPage();

    tapFeature(FEATURE);
    expect(await screen.findByRole('heading', { name: 'SU1408 3921' })).toBeInTheDocument();

    tapFeature(null);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'SU1408 3921' })).not.toBeInTheDocument(),
    );
  });

  test('Record here links the feature and prefills the note', async () => {
    const { tapFeature } = await armedPage();
    tapFeature(FEATURE);

    fireEvent.click(await screen.findByRole('button', { name: /record here/i }));

    expect(screen.getByLabelText(/note/i)).toHaveValue('SU1408 3921');
    expect(screen.getByText(/Linked to Field parcels: SU1408 3921/)).toBeInTheDocument();
    // The sheet closes on Record here — the note field is where the surveyor
    // is going next, and the sheet was covering it.
    expect(screen.queryByRole('heading', { name: 'SU1408 3921' })).not.toBeInTheDocument();
  });

  test('never overwrites a note already typed', async () => {
    // The link is recorded structurally either way, so the note text is a
    // convenience — not worth discarding work the surveyor cannot get back.
    const { tapFeature } = await armedPage();
    fireEvent.input(screen.getByLabelText(/note/i), { target: { value: 'broken stile' } });

    tapFeature(FEATURE);
    fireEvent.click(await screen.findByRole('button', { name: /record here/i }));

    expect(screen.getByLabelText(/note/i)).toHaveValue('broken stile');
  });

  test('the link reaches saveObservation', async () => {
    const { service, tapFeature } = await armedPage();
    tapFeature(FEATURE);
    fireEvent.click(await screen.findByRole('button', { name: /record here/i }));

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));

    await waitFor(() =>
      expect(service.saveObservation).toHaveBeenCalledWith(
        expect.objectContaining({ feature: FEATURE }),
      ),
    );
  });

  test('the link is cleared after saving, so the next observation is not silently attached', async () => {
    const { service, tapFeature } = await armedPage();
    tapFeature(FEATURE);
    fireEvent.click(await screen.findByRole('button', { name: /record here/i }));
    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));
    await waitFor(() => expect(service.saveObservation).toHaveBeenCalled());

    await waitFor(() =>
      expect(screen.queryByText(/Linked to Field parcels/)).not.toBeInTheDocument(),
    );

    service.saveObservation.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));
    await waitFor(() =>
      expect(service.saveObservation).toHaveBeenCalledWith(
        expect.objectContaining({ feature: null }),
      ),
    );
  });

  test('Unlink drops the link without touching the note or the photo', async () => {
    const { service, tapFeature } = await armedPage();
    tapFeature(FEATURE);
    fireEvent.click(await screen.findByRole('button', { name: /record here/i }));

    fireEvent.click(screen.getByRole('button', { name: /unlink/i }));

    expect(screen.queryByText(/Linked to Field parcels/)).not.toBeInTheDocument();
    // The prefilled note stays: unlinking is about the link, not the work.
    expect(screen.getByLabelText(/note/i)).toHaveValue('SU1408 3921');

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));
    await waitFor(() =>
      expect(service.saveObservation).toHaveBeenCalledWith(
        expect.objectContaining({ feature: null }),
      ),
    );
  });

  test('offers no Record here before a session is open', async () => {
    const service = createFakeService({ openSession: null });
    const { sensors } = createFakeSensors();
    const { tapFeature } = renderWithMap({ service, sensors });
    await screen.findByLabelText(/session name/i);

    tapFeature(FEATURE);

    expect(await screen.findByRole('heading', { name: 'SU1408 3921' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record here/i })).not.toBeInTheDocument();
  });
});

describe('CapturePage — saving against a point marked on the map', () => {
  const CENTRE = { lat: 51.6, lon: -0.2 };

  async function armedWithMap() {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors, pushPosition } = createFakeSensors();
    const adapter = {
      ready: Promise.resolve(),
      setPosition: vi.fn(),
      setObservations: vi.fn(),
      setFeatureLayers: vi.fn(),
      setPickedPoint: vi.fn(),
      getPointAtFraction: vi.fn(() => CENTRE),
      getZoom: vi.fn(() => 17),
      onMove: vi.fn(() => () => {}),
      centreOn: vi.fn(),
      resize: vi.fn(),
      destroy: vi.fn(),
    };
    render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        activeRegionId=${'south'}
        statusKnown=${true}
        createMap=${vi.fn().mockResolvedValue(adapter)}
        visible=${true}
      />`,
    );
    await screen.findByText('Ashton Keynes');
    pushPosition(POSITION);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save observation/i })).not.toBeDisabled(),
    );
    return { service, adapter };
  }

  async function markAPoint() {
    const armed = await armedWithMap();
    fireEvent.click(screen.getByRole('button', { name: /mark a distant point/i }));
    fireEvent.click(await screen.findByRole('button', { name: /use this point/i }));
    return armed;
  }

  test('the marked point shows above Save, so it is visible at the moment it applies', async () => {
    await markAPoint();

    expect(await screen.findByText(/Marked on the map/)).toBeInTheDocument();
  });

  test('the marked point reaches saveObservation', async () => {
    const { service } = await markAPoint();

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));

    await waitFor(() =>
      expect(service.saveObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          pickedPoint: expect.objectContaining({ lat: CENTRE.lat, lon: CENTRE.lon }),
        }),
      ),
    );
  });

  test('the mark is cleared after saving, so the next observation is not silently placed there', async () => {
    const { service } = await markAPoint();
    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));
    await waitFor(() => expect(service.saveObservation).toHaveBeenCalled());

    await waitFor(() => expect(screen.queryByText(/Marked on the map/)).not.toBeInTheDocument());

    service.saveObservation.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));
    await waitFor(() =>
      expect(service.saveObservation).toHaveBeenCalledWith(
        expect.objectContaining({ pickedPoint: null }),
      ),
    );
  });

  test('"Use my position" drops the mark and reverts to the fix', async () => {
    const { service } = await markAPoint();

    fireEvent.click(screen.getByRole('button', { name: /use my position/i }));

    expect(screen.queryByText(/Marked on the map/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));
    await waitFor(() =>
      expect(service.saveObservation).toHaveBeenCalledWith(
        expect.objectContaining({ pickedPoint: null }),
      ),
    );
  });

  test('a note and a photo survive marking a point', async () => {
    // The mark is a property of the observation being built, not a mode that
    // discards it — the surveyor may well type the note first.
    await armedWithMap();
    fireEvent.input(screen.getByLabelText(/note/i), { target: { value: 'far gate' } });

    fireEvent.click(screen.getByRole('button', { name: /mark a distant point/i }));
    fireEvent.click(await screen.findByRole('button', { name: /use this point/i }));

    expect(screen.getByLabelText(/note/i)).toHaveValue('far gate');
  });
});
