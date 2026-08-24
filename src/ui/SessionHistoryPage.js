import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatDate, formatDateLong } from '../sensors/format.js';
import {
  isExported,
  countUnexported,
  isChangedSinceExport,
  hasChangedSinceExport,
} from '../domain/session.js';
import { ObservationsList } from './ObservationsList.js';
import { ExportBadge } from './ExportBadge.js';
import { HistoryMap } from './HistoryMap.js';

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
  // The detail map's wiring: the same createMap closure the capture page
  // uses (main.js, active region and all), plus what HistoryMap needs to
  // know whether and how to show it.
  createMap,
  activeRegionId,
  statusKnown,
  displayMode,
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

  // Deleting is two-step (the TraceStrip pattern: the confirm replaces the
  // trigger, nothing reflows) and permanent — there is no undo for a whole
  // session.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [confirmingPurge, setConfirmingPurge] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeMessage, setPurgeMessage] = useState('');
  const [purgeError, setPurgeError] = useState('');

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
      observations: observations.map((obs) => ({
        ...obs,
        exported: isExported(session, obs),
        changed: isChangedSinceExport(session, obs),
      })),
    });
    setExportState('idle');
    setExportMessage('');
    setLoadState('idle');
    setLoadMessage('');
    setConfirmingDelete(false);
    setDeleteBusy(false);
    setDeleteError('');
  }

  async function handleDelete() {
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await service.deleteSession(selected.session.id);
      // The session is gone; back to the list, snapshot re-read.
      setSelected(null);
      setConfirmingDelete(false);
      setReloadKey((key) => key + 1);
    } catch (error) {
      setDeleteError(error.message || 'Could not delete that session');
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handlePurge() {
    if (!confirmingPurge) {
      setConfirmingPurge(true);
      return;
    }
    setPurgeBusy(true);
    setPurgeMessage('');
    setPurgeError('');
    try {
      const { deletedCount } = await service.deleteExportedSessions();
      setPurgeMessage(`Deleted ${deletedCount} session${deletedCount === 1 ? '' : 's'}`);
      setConfirmingPurge(false);
      setReloadKey((key) => key + 1);
    } catch (error) {
      setPurgeError(error.message || 'Could not delete the exported sessions');
      setConfirmingPurge(false);
    } finally {
      setPurgeBusy(false);
    }
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
              changed: isChangedSinceExport(session, obs),
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
            changed=${hasChangedSinceExport(selected.session)}
          />
        </p>
        ${
          // Self-describing, not self-contained: the reference identity
          // lives on the session record, so this line survives the zip's
          // bytes being long gone. Built in JS (the htm-trims rule).
          selected.session.sessionType === 'revisit' && selected.session.reference
            ? html`<p class="session-detail-reference">
                ${`Revisit of ${selected.session.reference.sessionName} · ${formatDateLong(
                  selected.session.reference.startedAt,
                )}`}
              </p>`
            : null
        }
        <${HistoryMap}
          activeRegionId=${activeRegionId}
          statusKnown=${statusKnown}
          createMap=${createMap}
          observations=${selected.observations}
          night=${displayMode === 'night'}
        />
        <p class="field-label">Observations</p>
        <${ObservationsList}
          observations=${selected.observations}
          gridRef=${gridRef}
          loadAudio=${(id) => service.getAudio(id)}
          loadPhoto=${(id) => service.getPhoto(id)}
        />
        <button
          type="button"
          class="button-primary session-history-export"
          disabled=${exportState === 'exporting' || selected.observations.length === 0}
          onClick=${handleExport}
        >
          ${exportState === 'exporting' ? 'Exporting…' : 'Export'}
        </button>
        ${
          // Reachable only for empty sessions from before ending-discards-
          // them — exactly who needs the reason (the Load-hint precedent).
          selected.observations.length === 0
            ? html`<p class="session-history-export-hint">Nothing recorded in this session</p>`
            : null
        }
        ${
          exportMessage
            ? html`<p class="session-history-export-message" role="status">
                ${
                  // The tick means success — an export that threw and landed
                  // on this same message state (e.g. a Chrome share()
                  // failure) must not read as "✓ Permission denied".
                  exportState === 'error'
                    ? null
                    : html`<span class="save-confirmation-tick" aria-hidden="true">✓</span>`
                }
                ${exportMessage}
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
        ${
          // The destructive act comes last in the stack, behind a two-step
          // confirm that REPLACES its trigger (the TraceStrip pattern). The
          // unexported count is stated before the commit — warn, never
          // block: the surveyor stays in charge of their own data.
          confirmingDelete
            ? html`
                ${
                  countUnexported(selected.session, selected.observations.length) > 0
                    ? html`<p class="session-history-delete-warning warns">
                        ${`${countUnexported(selected.session, selected.observations.length)} observation${
                          countUnexported(selected.session, selected.observations.length) === 1
                            ? ' has'
                            : 's have'
                        } never been exported`}
                      </p>`
                    : null
                }
                <span class="session-history-delete-confirm">
                  <button
                    type="button"
                    class="session-history-delete-commit"
                    disabled=${deleteBusy}
                    onClick=${handleDelete}
                  >
                    ${deleteBusy ? 'Deleting…' : 'Delete permanently'}
                  </button>
                  <button type="button" class="link" onClick=${() => setConfirmingDelete(false)}>
                    Keep session
                  </button>
                </span>
              `
            : html`
                <button
                  type="button"
                  class="link session-history-delete"
                  onClick=${() => {
                    setDeleteError('');
                    setConfirmingDelete(true);
                  }}
                >
                  Delete session
                </button>
              `
        }
        ${
          deleteError
            ? html`<p class="session-history-delete-message panel-danger" role="alert">
                ${deleteError}
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
  // How many listed sessions are fully exported — the badge predicate, so
  // the purge can only ever remove what already reads Exported on screen.
  const fullyExported = visible.filter(
    (s) =>
      countUnexported(s, counts[s.id] ?? 0) === 0 &&
      Boolean(s.lastExportedAt) &&
      // Edited since that export — the zip on disk is stale, so it must not
      // count (or purge) as fully exported until re-exported.
      !hasChangedSinceExport(s),
  ).length;
  const changedSessions = visible.filter((s) => hasChangedSinceExport(s)).length;

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
        // Zero unsent is not all-clear when an export has gone stale: a
        // fully-exported-then-edited session needs re-exporting, and this
        // summary must agree with the purge predicate that refuses it.
        changedSessions > 0
          ? html`<p class="session-history-unsynced">
              <${ExportBadge} exported=${true} changed=${true} />
              ${` ${changedSessions} session${changedSessions === 1 ? '' : 's'} changed since export`}
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
                            <span class="session-history-name">
                              ${session.name}
                              ${
                                session.sessionType === 'revisit'
                                  ? html` <span class="chip session-revisit-chip">Revisit</span>`
                                  : null
                              }
                            </span>
                            <span class="session-history-date">${meta}</span>
                          </span>
                          <${ExportBadge}
                            exported=${
                              countUnexported(session, counts[session.id] ?? 0) === 0 &&
                              Boolean(session.lastExportedAt)
                            }
                            changed=${hasChangedSinceExport(session)}
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
        ${
          '' /* application/octet-stream for Android document providers that
             report zips as bare binary and grey them out; a bad pick still
             fails with a named reason in parseSessionExport. */
        }
        accept=".zip,.geojson,.json,application/zip,application/geo+json,application/json,application/octet-stream"
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
      ${
        // The bulk clean-up, offered only when it can do something. Its
        // eligibility is the badge predicate, so nothing still reading "not
        // exported" on screen can be swept up; two-step via a label swap
        // (the SessionBar pattern), with the count in the confirm label so
        // the second tap says exactly what it will do.
        fullyExported > 0
          ? html`
              <button
                type="button"
                class="button-outline session-history-purge"
                disabled=${purgeBusy}
                onClick=${handlePurge}
              >
                ${
                  // The count rides on BOTH taps (field report, 2026-08-14):
                  // "Delete exported sessions" alone reads like housekeeping,
                  // when it is about to remove every fully-exported session
                  // at once.
                  purgeBusy
                    ? 'Deleting…'
                    : confirmingPurge
                      ? `Confirm delete ${fullyExported} exported session${fullyExported === 1 ? '' : 's'}`
                      : `Delete ${fullyExported} exported session${fullyExported === 1 ? '' : 's'}`
                }
              </button>
            `
          : null
      }
      ${
        purgeError
          ? html`<p class="session-history-purge-message panel-danger" role="alert">
              ${purgeError}
            </p>`
          : purgeMessage
            ? html`<p class="session-history-purge-message" role="status">
                <span class="save-confirmation-tick" aria-hidden="true">✓</span> ${purgeMessage}
              </p>`
            : null
      }
    </main>
  `;
}
