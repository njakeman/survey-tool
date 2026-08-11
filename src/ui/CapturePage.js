import { html } from 'htm/preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { usePosition } from './hooks/usePosition.js';
import { useHeading } from './hooks/useHeading.js';
import { SessionBar } from './SessionBar.js';
import { ReadingsPanel } from './ReadingsPanel.js';
import { PhotoField } from './PhotoField.js';
import { SaveButton } from './SaveButton.js';
import { VoiceNoteField } from './VoiceNoteField.js';
import { ObservationsList } from './ObservationsList.js';
import { CaptureMap } from './CaptureMap.js';
import { FeatureSheet } from './FeatureSheet.js';
import { formatLatLon } from '../sensors/format.js';
import { chooseActive } from '../map/basemapSelection.js';
import { isExported } from '../domain/session.js';

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
  recordAudio,
  onOpenProbe,
  onOpenHistory,
  offlineStatus,
  activeRegionId,
  statusKnown,
  regions,
  dismissedSuggestionId,
  createMap,
  featureLayers,
  gridRef,
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

  // The recorded-but-unsaved voice note — { blob, durationMs } | null. Held
  // here like the note and photo so it survives view switches and is cleared
  // by the same save.
  const [audio, setAudio] = useState(null);
  const [audioError, setAudioError] = useState(null);

  // Two distinct things, deliberately. `tappedFeature` is what the sheet is
  // showing — transient, cleared by tapping the map again. `linkedFeature` is
  // what the next Save will record, which survives dismissing the sheet and
  // typing a note, and is cleared only by saving or by unlinking.
  const [tappedFeature, setTappedFeature] = useState(null);
  const [linkedFeature, setLinkedFeature] = useState(null);

  // A point marked on the map because the surveyor could see the thing but
  // not reach it. Held here rather than in CaptureMap so it survives typing a
  // note and taking a photo, exactly as the linked feature does.
  const [pickedPoint, setPickedPoint] = useState(null);

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
    // Mount only: re-reading whenever the closure changes would refetch the
    // session on every GPS tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        audio,
        feature: linkedFeature,
        pickedPoint,
      });
      setNote('');
      setPhoto(null);
      setAudio(null);
      setAudioError(null);
      // Cleared with the note and photo: the link belongs to the observation
      // just saved, and leaving it armed would silently attach the next one
      // to a feature the surveyor has walked away from.
      setLinkedFeature(null);
      setTappedFeature(null);
      // Cleared with the note and the photo. A mark left armed would silently
      // attach the next observation to a place the surveyor has walked away
      // from — and unlike a stale note, nothing on screen would look wrong.
      setPickedPoint(null);
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

  function handleRecordHere(feature) {
    setLinkedFeature(feature);
    setTappedFeature(null);
    // Only into an empty note. Overwriting something already typed would
    // discard work the surveyor cannot get back — and the link is recorded
    // structurally regardless, so the note text is a convenience, not the
    // record.
    setNote((current) => (current.trim() ? current : feature.title));
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
      // A completed export stamps lastExportedAt on the session; re-read so
      // the badges flip to Exported while the surveyor is looking at them.
      if (!result.cancelled) await refreshSession();
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

  // Exported-or-not is derived here, once per change, and travels with each
  // observation to both the list and the map markers — neither consumer has
  // to know how it is worked out.
  const decoratedObservations = useMemo(
    () => observations.map((obs) => ({ ...obs, exported: isExported(session, obs) })),
    [observations, session],
  );

  // The GPS watch re-renders this component about once a second, and the
  // list re-formats every saved row each time — a per-row Date and
  // toLocaleTimeString, growing with the session, on the weakest CPU in the
  // system while the radio is busy. The rows only change on save, so hold the
  // vnode still between saves and Preact skips the subtree entirely.
  const loadAudio = (id) => service.getAudio(id);
  const observationsList = useMemo(
    () =>
      html`<${ObservationsList}
        observations=${decoratedObservations}
        gridRef=${gridRef}
        loadAudio=${loadAudio}
      />`,
    // loadAudio is a fresh closure every render but only wraps the stable
    // service — deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [decoratedObservations, gridRef],
  );

  const disabledReason = !session
    ? 'start a session first'
    : !position
      ? 'waiting for GPS fix'
      : '';
  const canSave = Boolean(session) && Boolean(position);

  return html`
    <main class="capture-page">
      <!-- The app's only h1. Visually hidden: the session bar already names
           the session on screen, but a document with no h1 leaves screen
           readers with nothing to orient by. -->
      <h1 class="visually-hidden">Field survey capture</h1>
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
        ${
          '' /* enable() stops any existing watch and re-arms, so retry is the
             same call — and it comes from a tap, which is what iOS needs. */
        }
        onRetryCompass=${enableCompass}
        gridRef=${gridRef}
      />
      <${CaptureMap}
        activeRegionId=${activeRegionId}
        regionName=${(regions ?? []).find((region) => region.id === activeRegionId)?.name}
        statusKnown=${statusKnown}
        suggestion=${suggestion}
        createMap=${createMap}
        onSwitchRegion=${onSwitchRegion}
        onDismissSuggestion=${onDismissSuggestion}
        onOpenPicker=${onOpenPicker}
        position=${position}
        observations=${decoratedObservations}
        featureLayers=${featureLayers}
        onFeatureTap=${setTappedFeature}
        pickedPoint=${pickedPoint}
        onPickPoint=${setPickedPoint}
        gridRef=${gridRef}
        visible=${visible}
      />
      <${FeatureSheet}
        feature=${tappedFeature}
        ${
          '' /* Withheld without an open session or a fix, because Save would
             refuse anyway — see SaveButton's disabledReason. */
        }
        canRecord=${canSave}
        onRecord=${handleRecordHere}
        onDismiss=${() => setTappedFeature(null)}
      />
      <label class="field">
        <span class="field-label">Note</span>
        <textarea value=${note} onInput=${(event) => setNote(event.target.value)} />
      </label>
      <div class="capture-actions">
        <${PhotoField}
          photo=${photo}
          busy=${photoBusy}
          error=${photoError}
          onSelect=${handlePhotoSelect}
          onClear=${handlePhotoClear}
        />
        ${
          // Export sits beside Take Photo rather than below the observations:
          // exporting the *open* session is a thing a surveyor does before
          // walking away, not a history-screen chore.
          session
            ? html`<button
                type="button"
                class="button-outline"
                disabled=${exportState === 'exporting'}
                onClick=${handleExport}
              >
                ${exportState === 'exporting' ? 'Exporting…' : 'Export'}
              </button>`
            : null
        }
      </div>
      ${
        // Below the photo row: recording is rarer than photographing, and a
        // recorded note shows an inline player where the button was.
        recordAudio
          ? html`<${VoiceNoteField}
              audio=${audio}
              error=${audioError}
              onRecorded=${setAudio}
              onRemove=${() => setAudio(null)}
              onError=${setAudioError}
              recordAudio=${recordAudio}
            />`
          : null
      }
      ${
        exportMessage
          ? html`<p class="capture-page-export-message" role="status">${exportMessage}</p>`
          : null
      }
      ${
        // Above Save with the linked-feature strip, for the same reason: this
        // is the moment it takes effect, and it has to be reversible without
        // losing the note and photo already collected.
        pickedPoint
          ? html`<p class="linked-feature">
              <span class="linked-feature-label"
                >${`Marked on the map · ${gridRef?.(pickedPoint.lat, pickedPoint.lon) ?? formatLatLon(pickedPoint.lat, pickedPoint.lon)}`}</span
              >
              <button type="button" class="link" onClick=${() => setPickedPoint(null)}>
                Use my position
              </button>
            </p>`
          : null
      }
      ${
        // Sits directly above Save because that is the moment it takes
        // effect, and it is removable: a surveyor who tapped the wrong parcel
        // must be able to say so without clearing their note and photo too.
        linkedFeature
          ? html`<p class="linked-feature">
              <span class="linked-feature-label"
                >Linked to ${linkedFeature.layerName}: ${linkedFeature.title}</span
              >
              <button
                type="button"
                class="link"
                onClick=${() => setLinkedFeature(null)}
                aria-label=${`Unlink ${linkedFeature.title}`}
              >
                Unlink
              </button>
            </p>`
          : null
      }
      <${SaveButton}
        disabled=${!canSave}
        disabledReason=${disabledReason}
        saving=${saveState === 'saving'}
        onClick=${handleSave}
      />
      ${
        // role="alert" rather than a plain paragraph: a save that failed is
        // the one thing the surveyor must not walk away from unaware.
        saveError ? html`<p class="save-error panel-danger" role="alert">✕ ${saveError}</p>` : null
      }
      ${
        // A visible receipt, not just an Undo control appearing. The count is
        // the part a surveyor actually checks — that the tap landed and how
        // many are now in the session.
        lastSaved
          ? html`<div class="save-confirmation">
              <span class="save-confirmation-tick" aria-hidden="true">✓</span>
              <span class="save-confirmation-text"
                >last saved · ${observations.length} this session</span
              >
              <button type="button" class="link" onClick=${handleUndo}>Undo</button>
            </div>`
          : null
      }
      ${observationsList}
      ${
        offlineStatus && offlineStatus.precachedCount === 0
          ? // Appears with no user action, once the offline check settles
            // after first paint — silent means never noticed.
            html`<p class="offline-status-warning panel-danger" role="status">
              No offline cache — this build will not work offline
            </p>`
          : null
      }
      <button type="button" class="link" onClick=${onOpenHistory}>Session history</button>
      <button type="button" class="link" onClick=${onOpenProbe}>Device probe</button>
      ${
        // Grid references come from Ordnance Survey's OSTN15 transformation,
        // which is OS data and wants acknowledging where it is used. One
        // muted line on the screen that shows them, rather than buried in a
        // README nobody reads on a phone.
        html`<p class="attribution">Contains OS data © Crown copyright and database right 2026</p>`
      }
    </main>
  `;
}
