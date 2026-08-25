import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import { html } from 'htm/preact';
import { SessionHistoryPage } from './SessionHistoryPage.js';

const OPEN_SESSION = {
  id: 'sess-open',
  name: 'Currently Open',
  status: 'open',
  startedAt: '2026-08-06T09:00:00.000Z',
};
const CLOSED_A = {
  id: 'sess-a',
  name: 'Site A',
  status: 'closed',
  startedAt: '2026-08-05T09:00:00.000Z',
};
const CLOSED_B = {
  id: 'sess-b',
  name: 'Site B',
  status: 'closed',
  startedAt: '2026-08-04T09:00:00.000Z',
};

const OBS = {
  id: 'obs-1',
  sessionId: 'sess-a',
  fixAt: '2026-08-05T10:00:00.000Z',
  lat: 51.5,
  lon: -0.14,
  gpsAccuracyM: 8,
  headingDeg: null,
  note: '',
  photos: [],
};

const CLOSED_REVISIT = {
  id: 'sess-r',
  name: '2026-08-21',
  status: 'closed',
  startedAt: '2026-08-21T09:00:00.000Z',
  sessionType: 'revisit',
  reference: {
    filename: 'long-barrow-2025-04-12.zip',
    hash: 'a'.repeat(64),
    sessionId: 'ref-sess-1',
    sessionName: 'Long Barrow south',
    startedAt: '2025-04-12T09:00:00.000Z',
    stationCount: 12,
    photoCount: 41,
  },
};

function createFakeService({ openSession = null, sessions = [], observationsBySession = {} } = {}) {
  return {
    getOpenSession: vi.fn().mockResolvedValue(openSession),
    listSessions: vi.fn().mockResolvedValue(sessions),
    listObservations: vi.fn((sessionId) => Promise.resolve(observationsBySession[sessionId] ?? [])),
    // The list renders counts via countObservations, which counts through
    // the index instead of loading every observation to measure it.
    countObservations: vi.fn((sessionId) =>
      Promise.resolve((observationsBySession[sessionId] ?? []).length),
    ),
  };
}

describe('SessionHistoryPage — list', () => {
  test('shows a friendly empty state when there are no past sessions', async () => {
    const service = createFakeService({ sessions: [] });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );

    expect(await screen.findByText(/no past sessions yet/i)).toBeInTheDocument();
  });

  test('excludes the currently open session from the list', async () => {
    const service = createFakeService({
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_A],
    });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );

    await screen.findByText('Site A');
    expect(screen.queryByText('Currently Open')).not.toBeInTheDocument();
  });

  test('shows each past session with its date and observation count', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: { 'sess-a': [OBS, OBS] },
    });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );

    await screen.findByText('Site A');
    // One metadata line rather than two loose spans.
    expect(screen.getByText('2026-08-05 · 2 saved')).toBeInTheDocument();
  });

  test('totals what has never been exported, the number worth knowing before putting the phone away', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A, CLOSED_B],
      observationsBySession: { 'sess-a': [OBS, OBS], 'sess-b': [OBS] },
    });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );

    expect(await screen.findByText(/3 observations not yet exported/i)).toBeInTheDocument();
  });

  test('no unexported summary when everything has left the device', async () => {
    const service = createFakeService({ sessions: [CLOSED_A] });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );

    await screen.findByText('Site A');
    expect(screen.queryByText(/not yet exported/i)).not.toBeInTheDocument();
  });

  test('the top summary counts sessions changed since export, not only unsent rows', async () => {
    // A fully-exported-then-edited session has zero unsent observations but
    // a stale export — the summary must not read all-clear.
    const service = createFakeService({
      sessions: [
        {
          ...CLOSED_A,
          lastExportedAt: '2026-08-05T12:00:00.000Z',
          lastExportCount: 1,
          changedSinceExportAt: '2026-08-05T13:00:00.000Z',
        },
      ],
      observationsBySession: { 'sess-a': [OBS] },
    });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );

    await screen.findByText('Site A');
    expect(screen.getByText(/1 session changed since export/i)).toBeInTheDocument();
    expect(screen.queryByText(/not yet exported/i)).not.toBeInTheDocument();
  });

  test('a session edited after its export reads Changed since export in the list', async () => {
    // A photo retake (or note edit) after an export makes the zip on
    // someone's laptop stale — the badge says so instead of "Exported".
    const service = createFakeService({
      sessions: [
        {
          ...CLOSED_A,
          lastExportedAt: '2026-08-05T12:00:00.000Z',
          lastExportCount: 1,
          changedSinceExportAt: '2026-08-05T13:00:00.000Z',
        },
      ],
      observationsBySession: { 'sess-a': [OBS] },
    });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );

    await screen.findByText('Site A');
    // Scoped to the row: the top summary now carries the phrase too.
    const row = screen.getByRole('button', { name: /Site A/ });
    expect(within(row).getByText(/changed since export/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Exported$/)).not.toBeInTheDocument();
  });

  test('lists multiple past sessions newest first', async () => {
    const service = createFakeService({ sessions: [CLOSED_B, CLOSED_A] });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );

    await screen.findByText('Site A');
    const names = screen.getAllByRole('button', { name: /Site (A|B)/ }).map((el) => el.textContent);
    expect(names[0]).toContain('Site A');
    expect(names[1]).toContain('Site B');
  });

  test('the top-level Back control calls onBack', async () => {
    const onBack = vi.fn();
    const service = createFakeService({ sessions: [] });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${onBack} />`,
    );
    await screen.findByText(/no past sessions yet/i);

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('SessionHistoryPage — revisit sessions', () => {
  test('a revisit row wears the Revisit chip', async () => {
    const service = createFakeService({ sessions: [CLOSED_A, CLOSED_REVISIT] });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );

    const row = (await screen.findByRole('button', { name: /2026-08-21/ })).closest('button');
    // Natural case in the DOM; CSS uppercases the chip.
    expect(within(row).getByText('Revisit')).toBeInTheDocument();
  });

  test('the detail names the referenced survey — kept even when the zip itself is long gone', async () => {
    const service = createFakeService({ sessions: [CLOSED_REVISIT] });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );
    await screen.findByText('2026-08-21');

    fireEvent.click(screen.getByRole('button', { name: /2026-08-21/ }));

    expect(
      await screen.findByText(/Revisit of Long Barrow south · 12 Apr 2025/),
    ).toBeInTheDocument();
  });

  test('an ordinary session shows neither chip nor reference line', async () => {
    const service = createFakeService({ sessions: [CLOSED_A] });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );
    await screen.findByText('Site A');

    expect(screen.queryByText('Revisit')).toBeNull();
  });
});

describe('SessionHistoryPage — the detail map', () => {
  function fakeAdapter() {
    return {
      ready: Promise.resolve(),
      setObservations: vi.fn(),
      setNightMode: vi.fn(),
      destroy: vi.fn(),
    };
  }

  function renderWithMap({ createMap, activeRegionId = 'south', displayMode = 'auto' }) {
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    return render(
      html`<${SessionHistoryPage}
        service=${service}
        exportSession=${vi.fn()}
        onBack=${vi.fn()}
        createMap=${createMap}
        activeRegionId=${activeRegionId}
        statusKnown=${true}
        displayMode=${displayMode}
      />`,
    );
  }

  test("the detail shows the session on a read-only map fitted to its observations; the list doesn't", async () => {
    const createMap = vi.fn().mockResolvedValue(fakeAdapter());
    const { container } = renderWithMap({ createMap });
    await screen.findByText('Site A');
    expect(container.querySelector('.history-map')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));

    await waitFor(() => expect(container.querySelector('.history-map')).not.toBeNull());
    await waitFor(() => expect(createMap).toHaveBeenCalledTimes(1));
    expect(createMap.mock.calls[0][0].fit).toEqual([
      [-0.14, 51.5],
      [-0.14, 51.5],
    ]);
  });

  test('night mode reaches the detail map', async () => {
    const adapter = fakeAdapter();
    renderWithMap({ createMap: vi.fn().mockResolvedValue(adapter), displayMode: 'night' });
    await screen.findByText('Site A');

    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));

    await waitFor(() => expect(adapter.setNightMode).toHaveBeenCalledWith(true));
  });

  test('no active region → no map panel and no placeholder in the detail', async () => {
    const createMap = vi.fn();
    const { container } = renderWithMap({ createMap, activeRegionId: null });
    await screen.findByText('Site A');

    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));

    await screen.findByText(/51\.500000, -0\.140000/);
    expect(container.querySelector('.history-map')).toBeNull();
    expect(createMap).not.toHaveBeenCalled();
  });
});

describe('SessionHistoryPage — detail', () => {
  test('tapping a session shows its observations and an Export button', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );
    await screen.findByText('Site A');

    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));

    expect(await screen.findByText(/51\.500000, -0\.140000/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^export$/i })).toBeInTheDocument();
  });

  test('a saved photo can be viewed from the read-only detail — photos are reads', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: {
        'sess-a': [{ ...OBS, photos: [{ id: 'obs-1', referencePhoto: null }] }],
      },
    });
    service.getPhoto = vi
      .fn()
      .mockResolvedValue({ id: 'obs-1', contentType: 'image/jpeg', blob: new Blob(['x']) });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );
    await screen.findByText('Site A');
    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Photo' }));

    await waitFor(() => expect(service.getPhoto).toHaveBeenCalledWith('obs-1'));

    // Reads only: history passes no onSetPhoto/onDeletePhoto, so the full
    // view offers no Retake or Delete (design pass 4 §7e).
    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));
    const dialog = screen.getByRole('dialog', { name: /photo/i });
    expect(within(dialog).queryByText(/retake/i)).toBeNull();
    expect(within(dialog).queryByText(/delete/i)).toBeNull();
  });

  test('a pre-fix empty session offers no live Export — disabled, with the reason beside it', async () => {
    // The app no longer produces empty sessions (ending one discards it),
    // but ones from before the change can still sit in history.
    const service = createFakeService({ sessions: [CLOSED_A] });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );
    await screen.findByText('Site A');
    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));

    await screen.findByText(/no observations saved yet/i);
    expect(screen.getByRole('button', { name: /^export$/i })).toBeDisabled();
    expect(screen.getByText(/nothing recorded in this session/i)).toBeInTheDocument();
  });

  test('a session with observations keeps its live Export and no hint', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );
    await screen.findByText('Site A');
    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));

    await screen.findByText(/51\.500000, -0\.140000/);
    expect(screen.getByRole('button', { name: /^export$/i })).not.toBeDisabled();
    expect(screen.queryByText(/nothing recorded in this session/i)).toBeNull();
  });

  test('a "back to list" control in the detail view returns to the session list, not the top-level view', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    const onBack = vi.fn();
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${onBack} />`,
    );
    await screen.findByText('Site A');
    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));
    await screen.findByRole('button', { name: /^export$/i });

    fireEvent.click(screen.getByRole('button', { name: /back to sessions/i }));

    await screen.findByText('Site A'); // back on the list
    expect(onBack).not.toHaveBeenCalled();
  });

  test('tapping Export calls exportSession with the session id and shows a success message', async () => {
    const exportSession = vi.fn().mockResolvedValue({ method: 'share' });
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    render(
      html`<${SessionHistoryPage}
        service=${service}
        exportSession=${exportSession}
        onBack=${vi.fn()}
      />`,
    );
    await screen.findByText('Site A');
    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));
    await screen.findByRole('button', { name: /^export$/i });

    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    expect(exportSession).toHaveBeenCalledWith('sess-a');
    await waitFor(() => expect(screen.getByText(/shared/i)).toBeInTheDocument());
  });

  test('a failed export shows an error rather than crashing the page', async () => {
    const exportSession = vi.fn().mockRejectedValue(new Error('zip failed'));
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    render(
      html`<${SessionHistoryPage}
        service=${service}
        exportSession=${exportSession}
        onBack=${vi.fn()}
      />`,
    );
    await screen.findByText('Site A');
    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));
    await screen.findByRole('button', { name: /^export$/i });

    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    await screen.findByText(/zip failed/);
    // The success tick must not appear on the error path — an earlier
    // version rendered it unconditionally whenever exportMessage was set,
    // so a share() failure surfaced as "✓ Permission denied".
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
  });
});

describe('SessionHistoryPage — load session', () => {
  function renderDetail({ service, onSessionLoaded = vi.fn() } = {}) {
    render(
      html`<${SessionHistoryPage}
        service=${service}
        exportSession=${vi.fn()}
        onBack=${vi.fn()}
        onSessionLoaded=${onSessionLoaded}
      />`,
    );
    return { onSessionLoaded };
  }

  test('offers Load session in the detail view, reopening it and handing over to capture', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    service.reopenSession = vi.fn().mockResolvedValue({ ...CLOSED_A, status: 'open' });
    const { onSessionLoaded } = renderDetail({ service });
    await screen.findByText('Site A');
    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));
    await screen.findByRole('button', { name: /load session/i });

    fireEvent.click(screen.getByRole('button', { name: /load session/i }));

    await waitFor(() => expect(onSessionLoaded).toHaveBeenCalledTimes(1));
    expect(service.reopenSession).toHaveBeenCalledWith('sess-a');
  });

  test('is refused while another session is open, and says why', async () => {
    // The user decision: no auto-closing. The surveyor ends their current
    // session deliberately, then loads.
    const service = createFakeService({
      openSession: OPEN_SESSION,
      sessions: [OPEN_SESSION, CLOSED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    service.reopenSession = vi.fn();
    renderDetail({ service });
    await screen.findByText('Site A');
    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));

    const load = await screen.findByRole('button', { name: /load session/i });
    expect(load).toBeDisabled();
    expect(screen.getByText(/end the current session first/i)).toBeInTheDocument();
    expect(service.reopenSession).not.toHaveBeenCalled();
  });

  test('a failed load shows the error inline rather than crashing the page', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    service.reopenSession = vi.fn().mockRejectedValue(new Error('a session is already open'));
    const { onSessionLoaded } = renderDetail({ service });
    await screen.findByText('Site A');
    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));
    await screen.findByRole('button', { name: /load session/i });

    fireEvent.click(screen.getByRole('button', { name: /load session/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already open/));
    expect(onSessionLoaded).not.toHaveBeenCalled();
  });
});

describe('SessionHistoryPage — delete session', () => {
  const EXPORTED_A = {
    ...CLOSED_A,
    lastExportedAt: '2026-08-05T12:00:00.000Z',
    lastExportCount: 1,
  };

  async function openDetail(service) {
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );
    await screen.findByText('Site A');
    fireEvent.click(screen.getByRole('button', { name: /Site A/ }));
    await screen.findByRole('button', { name: /delete session/i });
  }

  test('the delete is two-step: the confirm replaces the trigger, and Keep session escapes', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    service.deleteSession = vi.fn();
    await openDetail(service);

    fireEvent.click(screen.getByRole('button', { name: /delete session/i }));

    expect(screen.getByRole('button', { name: /delete permanently/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete session$/i })).toBeNull();
    expect(service.deleteSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /keep session/i }));

    expect(screen.queryByRole('button', { name: /delete permanently/i })).toBeNull();
    expect(screen.getByRole('button', { name: /delete session/i })).toBeInTheDocument();
  });

  test('warns how many observations have never been exported before the commit', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A], // never exported — both observations unexported
      observationsBySession: { 'sess-a': [OBS, OBS] },
    });
    service.deleteSession = vi.fn();
    await openDetail(service);

    fireEvent.click(screen.getByRole('button', { name: /delete session/i }));

    expect(screen.getByText(/2 observations have never been exported/i)).toBeInTheDocument();
  });

  test('no unexported warning when everything has left the device', async () => {
    const service = createFakeService({
      sessions: [EXPORTED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    service.deleteSession = vi.fn();
    await openDetail(service);

    fireEvent.click(screen.getByRole('button', { name: /delete session/i }));

    expect(screen.queryByText(/never been exported/i)).toBeNull();
  });

  test('committing deletes through the service and returns to a refreshed list', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    service.deleteSession = vi.fn().mockResolvedValue(undefined);
    await openDetail(service);

    fireEvent.click(screen.getByRole('button', { name: /delete session/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

    await waitFor(() => expect(service.deleteSession).toHaveBeenCalledWith('sess-a'));
    // Back on the list, with the snapshot re-read.
    await screen.findByText('Past sessions');
    await waitFor(() => expect(service.listSessions.mock.calls.length).toBeGreaterThan(1));
  });

  test('a failed delete shows the error inline and keeps the session on screen', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    service.deleteSession = vi.fn().mockRejectedValue(new Error('delete failed'));
    await openDetail(service);

    fireEvent.click(screen.getByRole('button', { name: /delete session/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/delete failed/));
    expect(screen.getByText('Site A')).toBeInTheDocument();
  });
});

describe('SessionHistoryPage — purge exported sessions', () => {
  const EXPORTED_A = {
    ...CLOSED_A,
    lastExportedAt: '2026-08-05T12:00:00.000Z',
    lastExportCount: 1,
  };

  test('offers the purge only when at least one listed session is fully exported', async () => {
    const service = createFakeService({
      sessions: [EXPORTED_A, CLOSED_B],
      observationsBySession: { 'sess-a': [OBS] },
    });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );
    await screen.findByText('Site A');

    expect(screen.getByRole('button', { name: /delete 1 exported session/i })).toBeInTheDocument();
  });

  test('hides the purge when nothing has been fully exported', async () => {
    const service = createFakeService({
      sessions: [CLOSED_A, CLOSED_B],
      observationsBySession: { 'sess-a': [OBS] },
    });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );
    await screen.findByText('Site A');

    expect(screen.queryByRole('button', { name: /delete .*exported session/i })).toBeNull();
  });

  test('purges two-step, reports the count and refreshes the list', async () => {
    const service = createFakeService({
      sessions: [EXPORTED_A],
      observationsBySession: { 'sess-a': [OBS] },
    });
    service.deleteExportedSessions = vi.fn().mockResolvedValue({ deletedCount: 1 });
    render(
      html`<${SessionHistoryPage} service=${service} exportSession=${vi.fn()} onBack=${vi.fn()} />`,
    );
    await screen.findByText('Site A');

    fireEvent.click(screen.getByRole('button', { name: /^delete 1 exported session/i }));
    expect(service.deleteExportedSessions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /confirm delete 1 exported session/i }));

    await waitFor(() => expect(service.deleteExportedSessions).toHaveBeenCalledTimes(1));
    await screen.findByText(/deleted 1 session/i);
    await waitFor(() => expect(service.listSessions.mock.calls.length).toBeGreaterThan(1));
  });
});

describe('SessionHistoryPage — import', () => {
  function renderWithImport({ importSession, service = createFakeService() } = {}) {
    render(
      html`<${SessionHistoryPage}
        service=${service}
        exportSession=${vi.fn()}
        importSession=${importSession}
        onBack=${vi.fn()}
      />`,
    );
    return service;
  }

  function pickFile(file) {
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
  }

  test('hands the chosen file to importSession and reports the summary', async () => {
    const importSession = vi
      .fn()
      .mockResolvedValue({ name: 'Hedgerow survey', observationCount: 14, photoCount: 12 });
    const service = renderWithImport({ importSession });
    const file = new File(['zip bytes'], 'hedgerow-survey-2026-08-06.zip', {
      type: 'application/zip',
    });

    pickFile(file);

    await waitFor(() =>
      expect(
        screen.getByText(/Imported 'Hedgerow survey' — 14 observations, 12 photos/),
      ).toBeInTheDocument(),
    );
    expect(importSession).toHaveBeenCalledWith(file);
    // The list snapshot re-reads, so the new session appears without leaving
    // the view.
    expect(service.listSessions.mock.calls.length).toBeGreaterThan(1);
  });

  test('omits the photo count when the export carried none', async () => {
    const importSession = vi
      .fn()
      .mockResolvedValue({ name: 'Bare geojson', observationCount: 3, photoCount: 0 });
    renderWithImport({ importSession });

    pickFile(new File(['{}'], 'session.geojson', { type: 'application/geo+json' }));

    await waitFor(() =>
      expect(screen.getByText(/Imported 'Bare geojson' — 3 observations$/)).toBeInTheDocument(),
    );
  });

  test('shows the named failure as an alert and re-reads nothing', async () => {
    const importSession = vi
      .fn()
      .mockRejectedValue(new Error('Could not import: session.geojson is not valid JSON (x.zip)'));
    const service = renderWithImport({ importSession });

    pickFile(new File(['nope'], 'x.zip', { type: 'application/zip' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/not valid JSON \(x\.zip\)/),
    );
    expect(service.listSessions).toHaveBeenCalledTimes(1);
  });
});
