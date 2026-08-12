import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatDate } from '../sensors/format.js';
import { isExported, countUnexported } from '../domain/session.js';
import { ObservationsList } from './ObservationsList.js';
import { ExportBadge } from './ExportBadge.js';

// Read-only view of past (non-open) sessions, so ended-but-unexported
// sessions stay visible and inspectable instead of vanishing once you tap
// End — per-row edit/delete stays a Phase 6 review-screen concern. This is
// also where sessions come *in*: Import reads a previously exported zip (or
// bare session.geojson) back onto the device, as a copy — and back *into
// use*: Load session reopens a past session in the capture interface so it
// can be added to (refused while another session is open, deliberately —
// the surveyor ends their live session first, nothing is auto-closed).
export function SessionHistoryPage({
  service,
  exportSession,
  importSession,
  gridRef,
  onBack,
  onSessionLoaded,
}) {
  const [sessions, setSessions] = useState(null); // null = still loading
  const [openSessionId, setOpenSessionId] = useState(null);
  const [counts, setCounts] = useState({});
  // Bumped after a successful import so the mount snapshot re-reads.
  const [reloadKey, setReloadKey] = useState(0);

  const [selected, setSelected] = useState(null); // { session, observations } | null
  const [exportState, setExportState] = useState('idle'); // idle | exporting | done | error
  const [exportMessage, setExportMessage] = useState('');

  const fileInputRef = useRef(null);
  const [importState, setImportState] = useState('idle'); // idle | importing | done | error
  const [importMessage, setImportMessage] = useState('');

  const [loadState, setLoadState] = useState('idle'); // idle | loading | error
  const [loadMessage, setLoadMessage] = useState('');

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
    // A snapshot taken when the view opens, re-taken only after an import
    // lands something new to show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  async function handleImportFile(event) {
    const [file] = event.target.files ?? [];
    // Same file again must still fire change next time.
    event.target.value = '';
    if (!file) return;
    setImportState('importing');
    setImportMessage('');
    try {
      const summary = await importSession(file);
      setImportState('done');
      const photos = summary.photoCount ? `, ${summary.photoCount} photos` : '';
      setImportMessage(
        `Imported '${summary.name}' — ${summary.observationCount} observations${photos}`,
      );
      setReloadKey((key) => key + 1);
    } catch (error) {
      setImportState('error');
      setImportMessage(error.message || 'Could not import that file');
    }
  }

  async function openSession(session) {
    const observations = await service.listObservations(session.id);
    setSelected({
      session,
      observations: observations.map((obs) => ({ ...obs, exported: isExported(session, obs) })),
    });
    setExportState('idle');
    setExportMessage('');
    setLoadState('idle');
    setLoadMessage('');
  }

  async function handleLoad() {
    setLoadState('loading');
    setLoadMessage('');
    try {
      await service.reopenSession(selected.session.id);
      // The session on screen just became the live one; hand straight over
      // to capture rather than showing a list it no longer belongs on.
      onSessionLoaded?.();
    } catch (error) {
      setLoadState('error');
      setLoadMessage(error.message || 'Could not load that session');
    }
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
      // A completed export stamped the session; carry the stamp into what is
      // on screen so every badge flips while the surveyor is looking, and
      // re-take the list snapshot for when they go back.
      if (result.exportedAt) {
        setSelected((current) => {
          if (!current) return current;
          const session = {
            ...current.session,
            lastExportedAt: result.exportedAt,
            lastExportCount: result.observationCount,
          };
          return {
            session,
            observations: current.observations.map((obs) => ({
              ...obs,
              exported: isExported(session, obs),
            })),
          };
        });
        setReloadKey((key) => key + 1);
      }
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
          <${ExportBadge}
            exported=${
              countUnexported(selected.session, selected.observations.length) === 0 &&
              Boolean(selected.session.lastExportedAt)
            }
          />
        </p>
        <p class="field-label">Observations</p>
        <${ObservationsList}
          observations=${selected.observations}
          gridRef=${gridRef}
          loadAudio=${(id) => service.getAudio(id)}
        />
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
        <button
          type="button"
          class="button-outline session-history-load"
          disabled=${Boolean(openSessionId) || loadState === 'loading'}
          onClick=${handleLoad}
        >
          ${loadState === 'loading' ? 'Loading…' : 'Load session'}
        </button>
        ${
          openSessionId
            ? html`<p class="session-history-load-hint">
                End the current session first to load this one
              </p>`
            : null
        }
        ${
          loadState === 'error'
            ? html`<p class="session-history-load-message panel-danger" role="alert">
                ${loadMessage}
              </p>`
            : null
        }
      </main>
    `;
  }

  const visible = (sessions ?? []).filter((s) => s.id !== openSessionId);
  // What has never left the device, totalled — the number a surveyor wants
  // before putting the phone away, not a per-session hunt.
  const unexported = visible.reduce((total, s) => total + countUnexported(s, counts[s.id] ?? 0), 0);

  return html`
    <main class="session-history">
      <div class="page-header">
        <button type="button" class="button-outline" onClick=${onBack}>← Back to capture</button>
        <h2>Past sessions</h2>
      </div>
      ${
        unexported > 0
          ? html`<p class="session-history-unsynced">
              <${ExportBadge} exported=${false} /> ${unexported} observations not yet exported
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
                          <${ExportBadge}
                            exported=${
                              countUnexported(session, counts[session.id] ?? 0) === 0 &&
                              Boolean(session.lastExportedAt)
                            }
                          />
                          <span class="session-history-chevron" aria-hidden="true">›</span>
                        </button>
                      </li>
                    `;
                  })}
                </ul>
              `
      }
      <input
        ref=${fileInputRef}
        type="file"
        accept=".zip,.geojson,.json,application/zip,application/geo+json,application/json"
        class="visually-hidden"
        aria-hidden="true"
        tabindex="-1"
        onChange=${handleImportFile}
      />
      <button
        type="button"
        class="button-outline session-history-import"
        disabled=${importState === 'importing'}
        onClick=${() => fileInputRef.current?.click()}
      >
        ${importState === 'importing' ? 'Importing…' : 'Import session'}
      </button>
      ${
        importState === 'error'
          ? html`<p class="session-history-import-message panel-danger" role="alert">
              ${importMessage}
            </p>`
          : importMessage
            ? html`<p class="session-history-import-message" role="status">
                <span class="save-confirmation-tick" aria-hidden="true">✓</span> ${importMessage}
              </p>`
            : null
      }
    </main>
  `;
}
