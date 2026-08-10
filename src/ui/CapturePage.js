import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { usePosition } from './hooks/usePosition.js';
import { useHeading } from './hooks/useHeading.js';
import { SessionBar } from './SessionBar.js';
import { ReadingsPanel } from './ReadingsPanel.js';
import { PhotoField } from './PhotoField.js';
import { SaveButton } from './SaveButton.js';
import { ObservationsTable } from './ObservationsTable.js';
import { CaptureMap } from './CaptureMap.js';
import { chooseActive } from '../map/basemapSelection.js';

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

// The integration component: wires the sensor hooks and captureService into
// the presentational children below. Everything it touches is independently
// tested, so a failure here is a wiring failure, not a logic one.
export function CapturePage({
  service,
  sensors,
  downscale,
  exportSession,
  onOpenProbe,
  onOpenHistory,
  offlineStatus,
  activeRegionId,
  statusKnown,
  regions,
  dismissedSuggestionId,
  createMap,
  onSwitchRegion,
  onDismissSuggestion,
  onOpenPicker,
  visible,
}) {
  const [session, setSession] = useState(null);
  const [observations, setObservations] = useState([]);
  const [sessionBusy, setSessionBusy] = useState(false);

  const [exportState, setExportState] = useState('idle'); // idle | exporting | done | error
  const [exportMessage, setExportMessage] = useState('');

  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState(null);

  const [saveState, setSaveState] = useState('idle'); // idle | saving
  const [saveError, setSaveError] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);

  const { reading: position, error: positionError } = usePosition(sensors.watchPosition);
  const {
    reading: heading,
    status: headingStatus,
    enable: enableCompass,
  } = useHeading({
    requestPermission: sensors.requestHeadingPermission,
    watch: sensors.watchHeading,
  });

  // Single source of truth for both the "N saved" count and the
  // observations table — one fetch, not a count kept in sync by hand.
  async function refreshSession() {
    const open = await service.getOpenSession();
    setSession(open);
    setObservations(open ? await service.listObservations(open.id) : []);
  }

  useEffect(() => {
    refreshSession();
  }, []);

  async function handleStart(name) {
    enableCompass(); // synchronous, before any await — iOS gesture rule
    setSessionBusy(true);
    setLastSaved(null); // an Undo must never cross a session boundary
    try {
      await service.startSession(name);
      await refreshSession();
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleEnd() {
    setSessionBusy(true);
    setLastSaved(null); // an Undo must never cross a session boundary
    try {
      await service.endSession();
      await refreshSession();
    } finally {
      setSessionBusy(false);
    }
  }

  async function handlePhotoSelect(file) {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      setPhoto(await downscale(file));
    } catch (error) {
      setPhotoError(error.message || 'Could not process that photo');
    } finally {
      setPhotoBusy(false);
    }
  }

  function handlePhotoClear() {
    setPhoto(null);
    setPhotoError(null);
  }

  async function handleSave() {
    if (saveState === 'saving') return;
    setSaveState('saving');
    setSaveError(null);
    try {
      const observation = await service.saveObservation({
        reading: position,
        heading,
        note,
        photo,
      });
      setNote('');
      setPhoto(null);
      setLastSaved(observation);
      await refreshSession();
    } catch (error) {
      setSaveError(error.message || 'Could not save observation');
    } finally {
      setSaveState('idle');
    }
  }

  async function handleUndo() {
    if (!lastSaved) return;
    try {
      await service.deleteObservation(lastSaved.id);
      setLastSaved(null);
      await refreshSession();
    } catch (error) {
      // Keep lastSaved so the surveyor can retry the undo.
      setSaveError(error.message || 'Could not undo that save');
    }
  }

  // Lets a surveyor export the current session before tapping End — the
  // read-only history view (SessionHistoryPage) covers export afterwards.
  async function handleExport() {
    setExportState('exporting');
    setExportMessage('');
    try {
      const result = await exportSession(session.id);
      setExportState('done');
      setExportMessage(
        result.cancelled ? 'Share dismissed' : result.method === 'share' ? 'Shared' : 'Downloaded',
      );
    } catch (error) {
      setExportState('error');
      setExportMessage(error.message || 'Could not export that session');
    }
  }

  // Worked out here because this is where the live fix is. Only ever an
  // offer — CaptureMap renders it as a prompt and nothing switches until the
  // surveyor taps.
  const { suggestionId } = chooseActive({
    regions: regions ?? [],
    selectedId: activeRegionId,
    position,
  });
  const suggestedRegion =
    suggestionId && suggestionId !== dismissedSuggestionId
      ? (regions ?? []).find((region) => region.id === suggestionId)
      : null;
  const suggestion = suggestedRegion
    ? { id: suggestedRegion.id, name: suggestedRegion.name }
    : null;

  const disabledReason = !session
    ? 'start a session first'
    : !position
      ? 'waiting for GPS fix'
      : '';
  const canSave = Boolean(session) && Boolean(position);

  return html`
    <main class="capture-page">
      <${SessionBar}
        session=${session}
        defaultName=${todayDateString()}
        observationCount=${observations.length}
        busy=${sessionBusy}
        onStart=${handleStart}
        onEnd=${handleEnd}
      />
      <${ReadingsPanel}
        position=${position}
        positionError=${positionError}
        heading=${heading}
        headingStatus=${headingStatus}
        onEnableCompass=${enableCompass}
      />
      <${CaptureMap}
        activeRegionId=${activeRegionId}
        statusKnown=${statusKnown}
        suggestion=${suggestion}
        createMap=${createMap}
        onSwitchRegion=${onSwitchRegion}
        onDismissSuggestion=${onDismissSuggestion}
        onOpenPicker=${onOpenPicker}
        position=${position}
        observations=${observations}
        visible=${visible}
      />
      <label>
        Note
        <textarea value=${note} onInput=${(event) => setNote(event.target.value)} />
      </label>
      <${PhotoField}
        photo=${photo}
        busy=${photoBusy}
        error=${photoError}
        onSelect=${handlePhotoSelect}
        onClear=${handlePhotoClear}
      />
      <${SaveButton}
        disabled=${!canSave}
        disabledReason=${disabledReason}
        saving=${saveState === 'saving'}
        onClick=${handleSave}
      />
      ${saveError ? html`<p class="save-error">${saveError}</p>` : null}
      ${
        lastSaved
          ? html`<p class="last-saved">
              last saved · <button type="button" onClick=${handleUndo}>Undo</button>
            </p>`
          : null
      }
      <${ObservationsTable} observations=${observations} />
      ${
        session
          ? html`
              <button type="button" disabled=${exportState === 'exporting'} onClick=${handleExport}>
                ${exportState === 'exporting' ? 'Exporting…' : 'Export'}
              </button>
              ${exportMessage ? html`<p class="capture-page-export-message">${exportMessage}</p>` : null}
            `
          : null
      }
      ${
        offlineStatus && offlineStatus.precachedCount === 0
          ? html`<p class="offline-status-warning">
              No offline cache — this build will not work offline
            </p>`
          : null
      }
      <button type="button" class="link" onClick=${onOpenHistory}>Session history</button>
      <button type="button" class="link" onClick=${onOpenProbe}>Device probe</button>
    </main>
  `;
}
