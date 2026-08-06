import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { formatDate } from '../sensors/format.js';
import { ObservationsTable } from './ObservationsTable.js';

// Read-only view of past (non-open) sessions, so ended-but-unsynced sessions
// stay visible and inspectable instead of vanishing once you tap End —
// per-row edit/delete stays a Phase 6 review-screen concern, this is
// display + export only.
export function SessionHistoryPage({ service, exportSession, onBack }) {
  const [sessions, setSessions] = useState(null); // null = still loading
  const [openSessionId, setOpenSessionId] = useState(null);
  const [counts, setCounts] = useState({});

  const [selected, setSelected] = useState(null); // { session, observations } | null
  const [exportState, setExportState] = useState('idle'); // idle | exporting | done | error
  const [exportMessage, setExportMessage] = useState('');

  useEffect(() => {
    (async () => {
      const [open, all] = await Promise.all([service.getOpenSession(), service.listSessions()]);
      const past = all
        .filter((s) => s.id !== open?.id)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      const countEntries = await Promise.all(
        past.map(async (s) => [s.id, (await service.listObservations(s.id)).length]),
      );
      setOpenSessionId(open?.id ?? null);
      setSessions(past);
      setCounts(Object.fromEntries(countEntries));
    })();
  }, []);

  async function openSession(session) {
    const observations = await service.listObservations(session.id);
    setSelected({ session, observations });
    setExportState('idle');
    setExportMessage('');
  }

  async function handleExport() {
    setExportState('exporting');
    setExportMessage('');
    try {
      const result = await exportSession(selected.session.id);
      setExportState('done');
      setExportMessage(
        result.cancelled ? 'Share dismissed' : result.method === 'share' ? 'Shared' : 'Downloaded',
      );
    } catch (error) {
      setExportState('error');
      setExportMessage(error.message || 'Could not export that session');
    }
  }

  if (selected) {
    return html`
      <main class="session-history">
        <button type="button" onClick=${() => setSelected(null)}>Back to sessions</button>
        <h2>${selected.session.name}</h2>
        <${ObservationsTable} observations=${selected.observations} />
        <button type="button" disabled=${exportState === 'exporting'} onClick=${handleExport}>
          ${exportState === 'exporting' ? 'Exporting…' : 'Export'}
        </button>
        ${exportMessage ? html`<p class="session-history-export-message">${exportMessage}</p>` : null}
      </main>
    `;
  }

  return html`
    <main class="session-history">
      <button type="button" onClick=${onBack}>Back to capture</button>
      <h2>Past sessions</h2>
      ${
        sessions === null
          ? null
          : sessions.length === 0
            ? html`<p class="session-history-empty">No past sessions yet</p>`
            : html`
                <ul class="session-history-list">
                  ${sessions
                    .filter((s) => s.id !== openSessionId)
                    .map(
                      (session) => html`
                        <li key=${session.id}>
                          <button type="button" onClick=${() => openSession(session)}>
                            <span class="session-history-name">${session.name}</span>
                            <span class="session-history-date"
                              >${formatDate(session.startedAt)}</span
                            >
                            <span class="session-history-count"
                              >${counts[session.id] ?? 0} saved</span
                            >
                          </button>
                        </li>
                      `,
                    )}
                </ul>
              `
      }
    </main>
  `;
}
