import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
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
  photoId: null,
};

function createFakeService({ openSession = null, sessions = [], observationsBySession = {} } = {}) {
  return {
    getOpenSession: vi.fn().mockResolvedValue(openSession),
    listSessions: vi.fn().mockResolvedValue(sessions),
    listObservations: vi.fn((sessionId) => Promise.resolve(observationsBySession[sessionId] ?? [])),
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
    expect(screen.getByText('2026-08-05')).toBeInTheDocument();
    expect(screen.getByText('2 saved')).toBeInTheDocument();
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
  });
});
