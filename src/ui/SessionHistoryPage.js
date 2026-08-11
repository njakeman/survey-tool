import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { formatDate } from '../sensors/format.js';
import { ObservationsList } from './ObservationsList.js';
import { SyncBadge } from './SyncBadge.js';

// Read-only view of past (non-open) sessions, so ended-but-unsynced sessions
// stay visible and inspectable instead of vanishing once you tap End —
// per-row edit/delete stays a Phase 6 review-screen concern, this is
// display + export only.
export function SessionHistoryPage({ service, exportSession, gridRef, onBack }) {
  const [sessions, setSessions] = useState(null); // null = still loading
  const [openSessionId, setOpenSessionId] = useState(null);
  const [counts, setCounts] = useState({});

  const [selected, setSelected] = useState(null); // { session, observations } | null
  const [exportState, setExportState] = useState('idle'); // idle | exporting | done | error
  const [exportMessage, setExportMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [open, all] = await Promise.all([service.getOpenSession(), service.listSessions()]);
      const past = all
        .filter((s) => s.id !== open?.id)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      // countObservations counts through the index. Listing them instead
      // deserialised every observation in the database — notes, metadata and
      // all — to render a column of integers.
      const countEntries = await Promise.all(
        past.map(async (s) => [s.id, await service.countObservations(s.id)]),
      );
      if (cancelled) return;
      setOpenSessionId(open?.id ?? null);
      setSessions(past);
      setCounts(Object.fromEntries(countEntries));
    })();
    return () => {
      cancelled = true;
    };
    // Mount only: the list is a snapshot taken when the view opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <div class="page-header">
          <button type="button" class="button-outline" onClick=${() => setSelected(null)}>
            ← Back to sessions
          </button>
        </div>
        <h2 class="session-detail-title">${selected.session.name}</h2>
        <p class="session-detail-meta">
          <span
            >${`${formatDate(selected.session.startedAt)} · ${selected.observations.length} saved`}</span
          >
          <${SyncBadge} synced=${false} />
        </p>
        <p class="field-label">Observations</p>
        <${ObservationsList} observations=${selected.observations} gridRef=${gridRef} />
        <button
          type="button"
          class="button-primary session-history-export"
          disabled=${exportState === 'exporting'}
          onClick=${handleExport}
        >
          ${exportState === 'exporting' ? 'Exporting…' : 'Export'}
        </button>
        ${
          exportMessage
            ? html`<p class="session-history-export-message" role="status">
                <span class="save-confirmation-tick" aria-hidden="true">✓</span> ${exportMessage}
              </p>`
            : null
        }
      </main>
    `;
  }

  const visible = (sessions ?? []).filter((s) => s.id !== openSessionId);
  // Sync is unbuilt, so everything saved is still pending — the total is what
  // a surveyor wants before driving out of signal, not a per-session hunt.
  const unsynced = visible.reduce((total, s) => total + (counts[s.id] ?? 0), 0);

  return html`
    <main class="session-history">
      <div class="page-header">
        <button type="button" class="button-outline" onClick=${onBack}>← Back to capture</button>
        <h2>Past sessions</h2>
      </div>
      ${
        unsynced > 0
          ? html`<p class="session-history-unsynced">
              <${SyncBadge} synced=${false} /> ${unsynced} observations not yet synced
            </p>`
          : null
      }
      ${
        sessions === null
          ? null
          : visible.length === 0
            ? html`<p class="session-history-empty">No past sessions yet</p>`
            : html`
                <ul class="session-history-list">
                  ${visible.map((session) => {
                    // Built as one string rather than interpolated inline:
                    // htm trims the whitespace around a line break between
                    // expressions, so a wrapped template silently loses the
                    // space before "saved".
                    const meta = `${formatDate(session.startedAt)} · ${counts[session.id] ?? 0} saved`;
                    return html`
                      <li key=${session.id}>
                        <button
                          type="button"
                          class="session-history-row"
                          onClick=${() => openSession(session)}
                        >
                          <span class="session-history-body">
                            <span class="session-history-name">${session.name}</span>
                            <span class="session-history-date">${meta}</span>
                          </span>
                          <${SyncBadge} synced=${false} />
                          <span class="session-history-chevron" aria-hidden="true">›</span>
                        </button>
                      </li>
                    `;
                  })}
                </ul>
              `
      }
    </main>
  `;
}
