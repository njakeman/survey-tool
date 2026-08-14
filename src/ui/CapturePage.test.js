import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/preact';
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

function createFakeService({ openSession = null, observations = [], traceDraft = null } = {}) {
  return {
    getOpenSession: vi.fn().mockResolvedValue(openSession),
    startSession: vi.fn().mockResolvedValue(OPEN_SESSION),
    endSession: vi.fn().mockResolvedValue({ ...OPEN_SESSION, status: 'closed' }),
    saveObservation: vi.fn().mockResolvedValue({ id: 'obs-1', sessionId: 'sess-1' }),
    countObservations: vi.fn().mockResolvedValue(observations.length),
    listObservations: vi.fn().mockResolvedValue(observations),
    deleteObservation: vi.fn().mockResolvedValue(undefined),
    startTraceDraft: vi.fn().mockImplementation(async ({ mode }) => ({
      id: 'draft-1',
      sessionId: 'sess-1',
      mode,
      startedAt: '2026-08-12T09:00:00.000Z',
    })),
    appendTraceVertex: vi.fn().mockResolvedValue(undefined),
    getTraceDraft: vi.fn().mockResolvedValue(traceDraft),
    discardTraceDraft: vi.fn().mockResolvedValue(undefined),
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
  displayMode = 'auto',
  onSetDisplayMode = vi.fn(),
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
      displayMode=${displayMode}
      onSetDisplayMode=${onSetDisplayMode}
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

  test('with a fix but no open session, Save is absent, not disabled', async () => {
    // Everything that writes into a session is absent without one — there
    // is nothing to explain, so a dashed ghost would be noise (design
    // pass 3 §5a).
    const service = createFakeService({ openSession: null });
    const { sensors, pushPosition } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByLabelText(/session name/i);

    pushPosition(POSITION);

    expect(screen.queryByRole('button', { name: /save observation/i })).toBeNull();
  });
});

describe('CapturePage — session gating (design pass 3 §5a/5b)', () => {
  test('without a session the capture block is absent and one line explains why', async () => {
    const service = createFakeService({ openSession: null });
    const { sensors, pushPosition } = createFakeSensors();
    render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        recordAudio=${vi.fn()}
      />`,
    );
    await screen.findByLabelText(/session name/i);
    pushPosition(POSITION);

    expect(screen.queryByLabelText(/^note$/i)).toBeNull();
    expect(document.querySelector('input[capture="environment"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /voice note/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Path/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /save observation/i })).toBeNull();

    // The readings panel and the map stay — GPS works without a session and
    // watching the fix settle is the reason to stand still.
    expect(
      screen.getByText(
        'The position above is live. Start a session to save readings, notes, photos, voice notes and traces into it.',
      ),
    ).toBeInTheDocument();
  });

  test('starting a session brings the capture block in whole', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors, pushPosition } = createFakeSensors();
    render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        recordAudio=${vi.fn()}
      />`,
    );
    await screen.findByText('Ashton Keynes');
    pushPosition(POSITION);

    expect(screen.getByLabelText(/^note$/i)).toBeInTheDocument();
    expect(document.querySelector('input[capture="environment"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Path/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save observation/i })).toBeInTheDocument();
    expect(screen.queryByText(/the position above is live/i)).toBeNull();
  });

  test('without a session, Session history is a full button carrying the unsent count', async () => {
    // The count of unsent work is visible before leaving the field, not
    // after (design pass 3 §5e). The badge takes the pending badges'
    // dashed treatment.
    const service = createFakeService({ openSession: null });
    service.listSessions = vi.fn().mockResolvedValue([
      { id: 's1', status: 'closed', lastExportedAt: null },
      {
        id: 's2',
        status: 'closed',
        lastExportedAt: '2026-08-10T00:00:00.000Z',
        lastExportCount: 2,
      },
    ]);
    service.countObservations = vi.fn().mockImplementation(async (id) => (id === 's1' ? 3 : 2));
    const { sensors } = createFakeSensors();
    renderPage({ service, sensors });

    const button = await screen.findByRole('button', { name: /session history/i });
    await waitFor(() => expect(button).toHaveTextContent('2 sessions'));
    expect(button).toHaveTextContent(/3 unsent/i);
  });

  test('with everything exported the badge is absent and the count spells its unit', async () => {
    const service = createFakeService({ openSession: null });
    service.listSessions = vi.fn().mockResolvedValue([
      {
        id: 's1',
        status: 'closed',
        lastExportedAt: '2026-08-10T00:00:00.000Z',
        lastExportCount: 2,
      },
    ]);
    service.countObservations = vi.fn().mockResolvedValue(2);
    const { sensors } = createFakeSensors();
    renderPage({ service, sensors });

    const button = await screen.findByRole('button', { name: /session history/i });
    await waitFor(() => expect(button).toHaveTextContent('1 session'));
    expect(button).not.toHaveTextContent(/unsent/i);
  });

  test('Session history is offered without a session and stands down during one', async () => {
    // With a session running, history is a detour (design pass 3 §5b) — it
    // comes back the moment the session ends.
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();
    renderPage({ service, sensors });
    await screen.findByText('Ashton Keynes');

    expect(screen.queryByRole('button', { name: /session history/i })).toBeNull();
    // The diagnostic keeps its footer link in both states.
    expect(screen.getByRole('button', { name: /device probe/i })).toBeInTheDocument();
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
        // All explicitly null rather than omitted, and asserted as part of
        // the exact object: an observation with no source feature, no
        // marked point and no pending trace has to say so, or a stale one
        // from a previous save could slip through unnoticed.
        feature: null,
        pickedPoint: null,
        trace: null,
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
    // Mount lists an honest empty session; every read after the save below
    // sees the saved row — which keeps the End confirm on its close wording
    // (a session with a record is closed, not discarded).
    service.listObservations
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: 'obs-1', sessionId: 'sess-1', lat: 51.5, lon: -0.14 }]);
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

  test('editing a saved note goes through the service and refreshes the list', async () => {
    const observation = {
      id: 'obs-1',
      sessionId: 'sess-1',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8,
      note: 'gate post',
    };
    const service = createFakeService({ openSession: OPEN_SESSION, observations: [observation] });
    service.updateNote = vi.fn().mockResolvedValue(undefined);
    const { sensors } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByText('Ashton Keynes');
    await screen.findByText('gate post');

    const [row] = screen.getAllByRole('listitem');
    fireEvent.click(within(row).getByRole('button', { name: /edit note/i }));
    fireEvent.input(within(row).getByLabelText('Note'), { target: { value: 'hinge broken' } });
    fireEvent.click(within(row).getByRole('button', { name: /save note/i }));

    await waitFor(() => expect(service.updateNote).toHaveBeenCalledWith('obs-1', 'hinge broken'));
    // The list re-reads, so the frozen row memo re-renders with the edit.
    await waitFor(() => expect(service.listObservations.mock.calls.length).toBeGreaterThan(1));
  });

  test('viewing a saved photo goes through the service — the open session offers photos too', async () => {
    const observation = {
      id: 'obs-1',
      sessionId: 'sess-1',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8,
      note: 'gate post',
      photoId: 'obs-1',
    };
    const service = createFakeService({ openSession: OPEN_SESSION, observations: [observation] });
    service.getPhoto = vi
      .fn()
      .mockResolvedValue({ id: 'obs-1', contentType: 'image/jpeg', blob: new Blob(['x']) });
    const { sensors } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByText('gate post');

    const [row] = screen.getAllByRole('listitem');
    fireEvent.click(within(row).getByRole('button', { name: 'Photo' }));

    await waitFor(() => expect(service.getPhoto).toHaveBeenCalledWith('obs-1'));
  });

  test('retaking a saved photo runs the downscale pipeline, the service write, and a refresh', async () => {
    // Design pass 4 §7e: the capture page passes onSetPhoto/onDeletePhoto —
    // history does not — and the raw camera file goes through the same
    // 1600px downscale as a compose-time photo.
    const observation = {
      id: 'obs-1',
      sessionId: 'sess-1',
      lat: 51.5,
      lon: -0.14,
      gpsAccuracyM: 8,
      note: 'gate post',
      photoId: 'obs-1',
    };
    const service = createFakeService({ openSession: OPEN_SESSION, observations: [observation] });
    service.getPhoto = vi
      .fn()
      .mockResolvedValue({ id: 'obs-1', contentType: 'image/jpeg', blob: new Blob(['x']) });
    service.setPhoto = vi.fn().mockResolvedValue(undefined);
    const encoded = { blob: new Blob(['downscaled'], { type: 'image/jpeg' }) };
    const downscale = vi.fn().mockResolvedValue(encoded);
    const { sensors } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${downscale} />`);
    await screen.findByText('gate post');

    const [row] = screen.getAllByRole('listitem');
    fireEvent.click(within(row).getByRole('button', { name: 'Photo' }));
    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));

    const dialog = screen.getByRole('dialog', { name: /photo/i });
    const file = new File(['raw'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(dialog.querySelector('input[capture="environment"]'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(downscale).toHaveBeenCalledWith(file));
    await waitFor(() => expect(service.setPhoto).toHaveBeenCalledWith('obs-1', encoded));
    // The refresh is what repoints the row at the new photoId.
    await waitFor(() => expect(service.listObservations.mock.calls.length).toBeGreaterThan(1));
  });

  test('a bumped sessionEpoch re-reads the session and clears the Undo affordance', async () => {
    // Load session (history) makes a past session the open one while this
    // page stays mounted-but-hidden — the epoch bump is its explicit signal
    // to re-read. Undo is cleared for the same reason start and end clear
    // it: an Undo must never cross a session boundary, and a reopen is one.
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors, pushPosition } = createFakeSensors();
    const { rerender } = render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        sessionEpoch=${0}
      />`,
    );
    await screen.findByText('Ashton Keynes');
    pushPosition(POSITION);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save observation/i })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));
    await screen.findByRole('button', { name: /undo/i });

    const loaded = { ...OPEN_SESSION, id: 'sess-2', name: 'Loaded Site' };
    service.getOpenSession.mockResolvedValue(loaded);
    rerender(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        sessionEpoch=${1}
      />`,
    );

    await screen.findByText('Loaded Site');
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
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
    // Export needs something to export — at zero it is disabled with a hint.
    const service = createFakeService({
      openSession: OPEN_SESSION,
      observations: [{ id: 'obs-1', sessionId: 'sess-1', lat: 51.5, lon: -0.14 }],
    });
    const { sensors } = createFakeSensors();
    const exportSession = vi.fn().mockResolvedValue({ method: 'share' });
    renderPage({ service, sensors, exportSession });
    await screen.findByText('Ashton Keynes');

    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    expect(exportSession).toHaveBeenCalledWith('sess-1');
    await waitFor(() => expect(screen.getByText(/shared/i)).toBeInTheDocument());
  });

  test('a failed export shows an error rather than crashing the page', async () => {
    const service = createFakeService({
      openSession: OPEN_SESSION,
      observations: [{ id: 'obs-1', sessionId: 'sess-1', lat: 51.5, lon: -0.14 }],
    });
    const { sensors } = createFakeSensors();
    const exportSession = vi.fn().mockRejectedValue(new Error('zip failed'));
    renderPage({ service, sensors, exportSession });
    await screen.findByText('Ashton Keynes');

    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    await screen.findByText(/zip failed/);
  });

  test('Export is disabled with a hint while the session has nothing to export', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByText('Ashton Keynes');

    expect(screen.getByRole('button', { name: /^export$/i })).toBeDisabled();
    expect(screen.getByText(/nothing to export yet/i)).toBeInTheDocument();
  });

  test('Export enables once an observation is saved, and the hint goes', async () => {
    const observation = { id: 'obs-1', sessionId: 'sess-1', lat: 51.5, lon: -0.14 };
    const service = createFakeService({
      openSession: OPEN_SESSION,
      observations: [observation],
    });
    const { sensors } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByText('Ashton Keynes');
    await screen.findByText(/1 saved/);

    expect(screen.getByRole('button', { name: /^export$/i })).not.toBeDisabled();
    expect(screen.queryByText(/nothing to export yet/i)).toBeNull();
  });

  test('Export is a session-level control at the page foot, not a capture action', async () => {
    // Everything in the capture-actions row attaches to the observation
    // being composed; Export acts on the whole session, like End session.
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();
    renderPage({ service, sensors });
    await screen.findByText('Ashton Keynes');

    const exportButton = screen.getByRole('button', { name: /^export$/i });
    expect(exportButton.closest('.capture-actions')).toBeNull();
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

    fireEvent.click(screen.getByRole('button', { name: 'Voice note' }));
    await screen.findByRole('timer');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    // The recorded state is now the shared transport row, not <audio>.
    await waitFor(() => expect(document.querySelector('.voice-transport')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));

    await waitFor(() =>
      expect(service.saveObservation).toHaveBeenCalledWith(
        expect.objectContaining({ audio: NOTE }),
      ),
    );
    // Cleared with the note and photo: the recording belongs to the
    // observation just saved, not the next one.
    await waitFor(() => expect(document.querySelector('.voice-transport')).toBeNull());
    expect(screen.getByRole('button', { name: 'Voice note' })).toBeInTheDocument();
  });

  test('without an injected recorder the field simply is not offered', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const { sensors } = createFakeSensors();
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByText('Ashton Keynes');

    expect(screen.queryByRole('button', { name: 'Voice note' })).toBeNull();
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
      // Decorated on the way through: exported-or-not (and changed-since-
      // export) travels with each observation to the markers.
      expect(adapter.setObservations).toHaveBeenCalledWith([
        { id: 'obs-1', lat: 51.5, lon: -0.14, exported: false, changed: false },
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
      setPickedPoint: vi.fn(),
      setHighlight: vi.fn(),
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
    return { adapter, tapFeature: (feature) => act(() => tap(feature)) };
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

  test('the selection is highlighted on the map while the sheet is open, linked, and until unlinked', async () => {
    const { adapter, tapFeature } = await armedPage();

    tapFeature(FEATURE);
    await waitFor(() => expect(adapter.setHighlight).toHaveBeenCalledWith(FEATURE));

    // Record here closes the sheet but keeps the link — the highlight must
    // survive with it, or "this one" vanishes the moment it matters.
    adapter.setHighlight.mockClear();
    fireEvent.click(await screen.findByRole('button', { name: /record here/i }));
    expect(adapter.setHighlight).not.toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await waitFor(() => expect(adapter.setHighlight).toHaveBeenCalledWith(null));
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

  test('Record here on a polygon marks its centroid, not the spot the surveyor stands on', async () => {
    // The surveyor is at the gate; the parcel is the thing being recorded.
    const polygon = {
      ...FEATURE,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-0.15, 50.86],
            [-0.14, 50.86],
            [-0.14, 50.87],
            [-0.15, 50.87],
            [-0.15, 50.86],
          ],
        ],
      },
    };
    const { service, tapFeature } = await armedPage();
    tapFeature(polygon);

    fireEvent.click(await screen.findByRole('button', { name: /record here/i }));

    // Goes through the marked-point path, visibly: same strip, same
    // "Use my position" way out.
    expect(await screen.findByText(/Marked on the map/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));
    await waitFor(() =>
      expect(service.saveObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: expect.objectContaining({ featureId: 'P-42' }),
          pickedPoint: expect.objectContaining({
            lat: expect.closeTo(50.865, 5),
            lon: expect.closeTo(-0.145, 5),
            // The polygon's reach from its centroid — the observation stands
            // for all of it — never a GPS figure.
            accuracyM: expect.any(Number),
          }),
        }),
      ),
    );
  });

  test('Record here on anything that is not a polygon keeps the live fix', async () => {
    const point = { ...FEATURE, geometry: { type: 'Point', coordinates: [-0.145, 50.865] } };
    const { service, tapFeature } = await armedPage();
    tapFeature(point);

    fireEvent.click(await screen.findByRole('button', { name: /record here/i }));

    expect(screen.queryByText(/Marked on the map/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));
    await waitFor(() =>
      expect(service.saveObservation).toHaveBeenCalledWith(
        expect.objectContaining({ pickedPoint: null }),
      ),
    );
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

describe('CapturePage — display mode', () => {
  test('the footer offers four exclusive positions and each is a deliberate tap', async () => {
    const service = createFakeService({ openSession: null });
    const { sensors } = createFakeSensors();
    const onSetDisplayMode = vi.fn();
    renderPage({ service, sensors, onSetDisplayMode });
    await screen.findByLabelText(/session name/i);

    const group = screen.getByRole('radiogroup', { name: /display/i });
    const options = within(group).getAllByRole('radio');
    expect(options.map((option) => option.textContent.trim())).toEqual([
      'Auto',
      'Light',
      'Dark',
      'Night',
    ]);
    expect(within(group).getByRole('radio', { name: 'Auto' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(within(group).getByRole('radio', { name: 'Night' }).getAttribute('aria-checked')).toBe(
      'false',
    );

    fireEvent.click(within(group).getByRole('radio', { name: 'Light' }));
    fireEvent.click(within(group).getByRole('radio', { name: 'Dark' }));
    fireEvent.click(within(group).getByRole('radio', { name: 'Night' }));
    expect(onSetDisplayMode.mock.calls.map(([mode]) => mode)).toEqual(['light', 'dark', 'night']);
  });

  test('a forced position shows as the checked state', async () => {
    const service = createFakeService({ openSession: null });
    const { sensors } = createFakeSensors();
    renderPage({ service, sensors, displayMode: 'dark' });
    await screen.findByLabelText(/session name/i);

    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Auto' }).getAttribute('aria-checked')).toBe('false');
  });

  test("Auto captions itself with the system's resolved scheme; forced positions do not", async () => {
    const service = createFakeService({ openSession: null });
    const { sensors } = createFakeSensors();
    const { rerender } = render(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        displayMode=${'auto'}
        systemScheme=${'dark'}
      />`,
    );
    await screen.findByLabelText(/session name/i);

    expect(screen.getByText('Following the system — dark')).toBeInTheDocument();

    rerender(
      html`<${CapturePage}
        service=${service}
        sensors=${sensors}
        downscale=${vi.fn()}
        displayMode=${'night'}
        systemScheme=${'dark'}
      />`,
    );
    expect(screen.queryByText(/following the system/i)).toBeNull();
  });
});

describe('CapturePage - trace modes', () => {
  // ~22 m and ~44 m north of POSITION - far enough apart that the recorder
  // accepts each as a vertex at +/-8.2 m accuracy.
  const FIX_2 = { ...POSITION, lat: 51.5002, fixAt: 'x2', fixAtMs: 2 };
  const FIX_3 = { ...POSITION, lat: 51.5004, fixAt: 'x3', fixAtMs: 3 };

  async function startPathTrace({ service, sensors, pushPosition }) {
    render(html`<${CapturePage} service=${service} sensors=${sensors} downscale=${vi.fn()} />`);
    await screen.findByText('Ashton Keynes');
    pushPosition(POSITION);

    fireEvent.click(screen.getByRole('button', { name: /^Path/ }));
    await screen.findByText(/Tracing path/);
  }

  test('tapping Path begins recording, one tap deep', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const fakes = createFakeSensors();
    await startPathTrace({ service, ...fakes });

    expect(service.startTraceDraft).toHaveBeenCalledWith({ mode: 'path' });
    // The first fix was already accepted as vertex zero.
    await waitFor(() => expect(service.appendTraceVertex).toHaveBeenCalled());
  });

  test('the pair stands ready with captions, and there is no chooser', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const fakes = createFakeSensors();
    render(
      html`<${CapturePage} service=${service} sensors=${fakes.sensors} downscale=${vi.fn()} />`,
    );
    await screen.findByText('Ashton Keynes');
    fakes.pushPosition(POSITION);

    // The captions carry what the chooser existed to explain — a first-time
    // user won't know a boundary auto-closes — which is why the chooser
    // could go (design pass 3 §5d).
    expect(screen.getByRole('button', { name: /^Path/ })).toHaveTextContent('Open line, A to B');
    expect(screen.getByRole('button', { name: /^Boundary/ })).toHaveTextContent(
      'Closes back to the start',
    );
    expect(screen.getByText('Trace a line along the ground')).toBeInTheDocument();
    expect(screen.queryByText('What are you walking?')).toBeNull();
    expect(service.startTraceDraft).not.toHaveBeenCalled();
  });

  test('the pair waits for a fix before either walk can start', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const fakes = createFakeSensors();
    render(
      html`<${CapturePage} service=${service} sensors=${fakes.sensors} downscale=${vi.fn()} />`,
    );
    await screen.findByText('Ashton Keynes');

    expect(screen.getByRole('button', { name: /^Path/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Boundary/ })).toBeDisabled();
  });

  test('while a path records, Boundary stands down rather than disappearing', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const fakes = createFakeSensors();
    await startPathTrace({ service, ...fakes });

    // The live walk's strip holds the pair's slot; the other mode stays
    // visible but disabled, so the pair never reflows under a thumb.
    expect(screen.queryByRole('button', { name: /^Path/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Boundary/ })).toBeDisabled();
  });

  test('walking appends vertices to the draft as they are accepted', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const fakes = createFakeSensors();
    await startPathTrace({ service, ...fakes });

    fakes.pushPosition(FIX_2);
    fakes.pushPosition(FIX_3);

    await waitFor(() => expect(service.appendTraceVertex).toHaveBeenCalledTimes(3));
    expect(screen.getByText(/3 points/)).toBeInTheDocument();
  });

  test('Finish arms the save, and Save hands the trace to the service', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const fakes = createFakeSensors();
    await startPathTrace({ service, ...fakes });
    fakes.pushPosition(FIX_2);
    await waitFor(() => expect(service.appendTraceVertex).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await screen.findByText(/save to keep it/i);

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));
    await waitFor(() => expect(service.saveObservation).toHaveBeenCalled());
    const args = service.saveObservation.mock.calls[0][0];
    expect(args.trace.draftId).toBe('draft-1');
    expect(args.trace.geometry.type).toBe('LineString');
    expect(args.trace.geometry.coordinates).toHaveLength(2);

    // Saved: the strip is gone.
    await waitFor(() => expect(screen.queryByText(/save to keep it/i)).toBeNull());
  });

  test('a boundary that cannot close yet errors on the strip and keeps recording', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const fakes = createFakeSensors();
    render(
      html`<${CapturePage} service=${service} sensors=${fakes.sensors} downscale=${vi.fn()} />`,
    );
    await screen.findByText('Ashton Keynes');
    fakes.pushPosition(POSITION);

    fireEvent.click(screen.getByRole('button', { name: /^Boundary/ }));
    await screen.findByText(/Tracing boundary/);

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/keep walking/i);
    expect(screen.getByText(/Tracing boundary/)).toBeInTheDocument();
    expect(service.saveObservation).not.toHaveBeenCalled();
  });

  test('Discard clears the trace and deletes the draft', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const fakes = createFakeSensors();
    await startPathTrace({ service, ...fakes });

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard trace' }));

    await waitFor(() => expect(service.discardTraceDraft).toHaveBeenCalledWith('draft-1'));
    expect(screen.queryByText(/Tracing path/)).toBeNull();
  });

  test('an ordinary point observation still saves mid-trace, without the trace', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const fakes = createFakeSensors();
    await startPathTrace({ service, ...fakes });

    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));

    await waitFor(() => expect(service.saveObservation).toHaveBeenCalled());
    expect(service.saveObservation.mock.calls[0][0].trace ?? null).toBeNull();
    // The walk carries on.
    expect(screen.getByText(/Tracing path/)).toBeInTheDocument();
  });

  test('ending the session is refused while a trace is running', async () => {
    const service = createFakeService({ openSession: OPEN_SESSION });
    const fakes = createFakeSensors();
    await startPathTrace({ service, ...fakes });

    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    // Nothing saved yet, so the confirm wears the discard wording — but the
    // trace guard fires first and nothing is discarded.
    fireEvent.click(screen.getByRole('button', { name: /discard session/i }));

    await screen.findByText(/finish or discard the trace first/i);
    expect(service.endSession).not.toHaveBeenCalled();
  });

  test('an unfinished draft found on mount is offered for recovery, resuming paused', async () => {
    const service = createFakeService({
      openSession: OPEN_SESSION,
      traceDraft: {
        draft: {
          id: 'draft-9',
          sessionId: 'sess-1',
          mode: 'path',
          startedAt: '2026-08-12T08:00:00.000Z',
        },
        vertices: [
          { draftId: 'draft-9', seq: 0, lat: 51.5, lon: -0.14, accuracyM: 5, fixAt: 't0' },
          { draftId: 'draft-9', seq: 1, lat: 51.5002, lon: -0.14, accuracyM: 6, fixAt: 't1' },
        ],
      },
    });
    const fakes = createFakeSensors();
    render(
      html`<${CapturePage} service=${service} sensors=${fakes.sensors} downscale=${vi.fn()} />`,
    );

    await screen.findByText(/unfinished trace/i);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    // Paused, never silently recording - a relaunch hours later must not
    // stitch the drive home onto the hedgerow.
    await screen.findByText(/Paused · path/);
    expect(screen.getByText(/2 points/)).toBeInTheDocument();
  });

  test('the recovery panel explains itself in a sentence and leads with Resume', async () => {
    // The surveyor arrives at this cold, possibly days later — "12 points"
    // alone does not tell them whether their walk survived. And nothing is
    // recording, so nothing pulses (design pass 2e).
    const service = createFakeService({
      openSession: OPEN_SESSION,
      traceDraft: {
        draft: {
          id: 'draft-9',
          sessionId: 'sess-1',
          mode: 'path',
          startedAt: '2026-08-12T08:00:00.000Z',
        },
        vertices: [
          { draftId: 'draft-9', seq: 0, lat: 51.5, lon: -0.14, accuracyM: 5, fixAt: 't0' },
          { draftId: 'draft-9', seq: 1, lat: 51.5002, lon: -0.14, accuracyM: 6, fixAt: 't1' },
        ],
      },
    });
    const fakes = createFakeSensors();
    render(
      html`<${CapturePage} service=${service} sensors=${fakes.sensors} downscale=${vi.fn()} />`,
    );

    await screen.findByText('Unfinished trace found');
    expect(
      screen.getByText(
        /A path with 2 points was still recording when the app closed\. It has not been saved\./,
      ),
    ).toBeInTheDocument();

    const panel = document.querySelector('.trace-recovery');
    expect(panel).not.toBeNull();
    expect(panel.querySelector('.trace-strip-dot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Resume' }).className).toContain('button-primary');
  });
});
