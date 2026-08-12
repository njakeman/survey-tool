import { html } from 'htm/preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { usePosition } from './hooks/usePosition.js';
import { useHeading } from './hooks/useHeading.js';
import { SessionBar } from './SessionBar.js';
import { ReadingsPanel, STALE_AFTER_MS } from './ReadingsPanel.js';
import { PhotoField } from './PhotoField.js';
import { SaveButton } from './SaveButton.js';
import { VoiceNoteField } from './VoiceNoteField.js';
import { ObservationsList } from './ObservationsList.js';
import { CaptureMap } from './CaptureMap.js';
import { FeatureSheet } from './FeatureSheet.js';
import { TraceStrip } from './TraceStrip.js';
import { TraceGlyph } from './traceGlyphs.js';
import { formatLatLon } from '../sensors/format.js';
import { chooseActive } from '../map/basemapSelection.js';
import { isExported } from '../domain/session.js';
import { polygonCentroid, polygonExtentM } from '../geo/centroid.js';
import {
  acceptFix,
  createTraceState,
  finishTrace,
  pauseTrace,
  resumeTrace,
  traceStats,
} from '../trace/recording.js';

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
  displayMode,
  onSetDisplayMode,
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

  // The trace being walked: the draft record it persists into and the pure
  // recorder state (trace/recording.js). Held here like pickedPoint — it must
  // survive typing a note, capturing a point observation, and view switches.
  const [traceSession, setTraceSession] = useState(null); // { draft, state, error }
  // A finished walk waiting on Save — finishTrace's result plus what the
  // save needs to clear the draft. Save composes it with the note, photo,
  // voice note and feature link exactly like any other observation.
  const [pendingTrace, setPendingTrace] = useState(null);
  const [traceChooserOpen, setTraceChooserOpen] = useState(false);
  // An unfinished draft found in IndexedDB on mount — a force-quit mid-walk.
  // Offered, never auto-resumed: recording again is a decision.
  const [recoveredDraft, setRecoveredDraft] = useState(null);
  const [confirmingRecoveredDiscard, setConfirmingRecoveredDiscard] = useState(false);

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
    // A draft in the store with no strip on screen is a force-quit mid-walk.
    service.getTraceDraft().then((found) => {
      if (found) setRecoveredDraft(found);
    });
    // Mount only: re-reading whenever the closure changes would refetch the
    // session on every GPS tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The appender: every fix from the shared watch goes through the pure
  // recorder; only an accepted vertex is persisted — which is what keeps the
  // no-watch-persistence carve-out narrow. Re-running after a state change
  // re-offers the same fix, which the distance rule rejects, so the effect
  // is safely idempotent.
  useEffect(() => {
    if (!traceSession || !position) return;
    const { state, vertex } = acceptFix(traceSession.state, position);
    if (!vertex) return;
    setTraceSession((current) => (current ? { ...current, state } : current));
    service.appendTraceVertex(traceSession.draft.id, vertex).catch(() => {
      // A failed append is a failed crash-safety guarantee — say so where
      // the surveyor is looking.
      setTraceSession((current) =>
        current ? { ...current, error: 'Could not record that point — storage failed' } : current,
      );
    });
    // service is stable; traceSession covers the state the appender reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, traceSession]);

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
    // A closed session must not leave a draft pointing at it, and a pending
    // trace not yet saved is exactly the data loss End would silently cause.
    if (traceSession || pendingTrace) {
      const message = 'Finish or discard the trace first';
      if (traceSession) setTraceSession({ ...traceSession, error: message });
      else setPendingTrace({ ...pendingTrace, error: message });
      return;
    }
    setSessionBusy(true);
    setLastSaved(null); // an Undo must never cross a session boundary
    try {
      await service.endSession();
      await refreshSession();
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleStartTrace(mode) {
    setTraceChooserOpen(false);
    try {
      const draft = await service.startTraceDraft({ mode });
      setTraceSession({ draft, state: createTraceState({ mode }), error: null });
    } catch (error) {
      setSaveError(error.message || 'Could not start the trace');
    }
  }

  function handlePauseTrace() {
    setTraceSession((current) =>
      current ? { ...current, state: pauseTrace(current.state), error: null } : current,
    );
  }

  function handleResumeTrace() {
    setTraceSession((current) =>
      current ? { ...current, state: resumeTrace(current.state), error: null } : current,
    );
  }

  // Shared by the live Finish and the recovery strip's: close the walk into
  // a pending trace, or say why it cannot close yet.
  function finishIntoPending(draft, state) {
    try {
      const finished = finishTrace(state);
      setPendingTrace({
        ...finished,
        draftId: draft.id,
        mode: state.mode,
        stats: traceStats(state),
        error: null,
      });
      setTraceSession(null);
      // Both arm the same Save; a stale mark would silently override the
      // walked line's own representative point.
      setPickedPoint(null);
      return true;
    } catch {
      const message =
        state.mode === 'boundary'
          ? 'Keep walking or discard — a boundary needs three distinct points'
          : 'Keep walking or discard — a path needs at least two points';
      setTraceSession({ draft, state, error: message });
      return false;
    }
  }

  function handleFinishTrace() {
    if (traceSession) finishIntoPending(traceSession.draft, traceSession.state);
  }

  async function handleDiscardTrace() {
    const draftId = traceSession?.draft.id ?? pendingTrace?.draftId;
    setTraceSession(null);
    setPendingTrace(null);
    if (!draftId) return;
    try {
      await service.discardTraceDraft(draftId);
    } catch (error) {
      setSaveError(error.message || 'Could not discard the trace');
    }
  }

  // The recovered draft's vertices, back into recorder state — paused, so a
  // relaunch hours later can never silently stitch the drive home onto the
  // hedgerow.
  function recoveredState() {
    const { draft, vertices } = recoveredDraft;
    return pauseTrace(createTraceState({ mode: draft.mode, vertices }));
  }

  function handleResumeRecovered() {
    setTraceSession({ draft: recoveredDraft.draft, state: recoveredState(), error: null });
    setRecoveredDraft(null);
  }

  function handleFinishRecovered() {
    const { draft } = recoveredDraft;
    setRecoveredDraft(null);
    finishIntoPending(draft, recoveredState());
  }

  async function handleDiscardRecovered() {
    const { draft } = recoveredDraft;
    setRecoveredDraft(null);
    setConfirmingRecoveredDiscard(false);
    try {
      await service.discardTraceDraft(draft.id);
    } catch (error) {
      setSaveError(error.message || 'Could not discard the trace');
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
        // The finished walk, when one is waiting: Save is the same tap
        // either way, and the annotations compose identically.
        trace: pendingTrace
          ? {
              draftId: pendingTrace.draftId,
              geometry: pendingTrace.geometry,
              representative: pendingTrace.representative,
              gpsAccuracyM: pendingTrace.gpsAccuracyM,
              fixAt: pendingTrace.fixAt,
            }
          : null,
      });
      setNote('');
      setPhoto(null);
      setAudio(null);
      setAudioError(null);
      // The draft died inside the save transaction; the strip follows it.
      setPendingTrace(null);
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
    // Recording a polygon records the polygon's place, not the gateway the
    // surveyor happens to be standing in: its centroid goes through the
    // marked-point path (positionSource 'map', altitude nulled), with the
    // polygon's own reach as the accuracy — visible above Save on the usual
    // strip, and "Use my position" reverts it. Points and lines keep the
    // live fix: the surveyor is presumed at them.
    const centre = polygonCentroid(feature.geometry);
    if (centre) {
      setPickedPoint({ ...centre, accuracyM: polygonExtentM(feature.geometry, centre) });
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

  // What the strip shows, derived from whichever half of the trace state
  // exists — pending wins, because a pending trace is what Save will take.
  const stripTrace = pendingTrace
    ? {
        status: 'pending',
        mode: pendingTrace.mode,
        startedAt: null,
        stats: pendingTrace.stats,
        warnings: pendingTrace.warnings,
        error: pendingTrace.error,
      }
    : traceSession
      ? {
          status: traceSession.state.paused ? 'paused' : 'recording',
          mode: traceSession.state.mode,
          startedAt: traceSession.draft.startedAt,
          stats: traceStats(traceSession.state),
          warnings: [],
          error: traceSession.error,
        }
      : null;

  // The line on the map: the walk so far while recording, the finished
  // shape while pending — it must not vanish between Finish and Save.
  const activeTraceCoords = useMemo(() => {
    if (pendingTrace) {
      return pendingTrace.geometry.type === 'Polygon'
        ? pendingTrace.geometry.coordinates[0]
        : pendingTrace.geometry.coordinates;
    }
    if (traceSession) return traceSession.state.vertices.map((v) => [v.lon, v.lat]);
    return null;
  }, [pendingTrace, traceSession]);

  const disabledReason = !session
    ? 'start a session first'
    : !position && !pendingTrace
      ? 'waiting for GPS fix'
      : '';
  // A pending trace can save without a live fix — after a relaunch recovery
  // the walk itself is the provenance (captureService nulls the rest).
  const canSave = Boolean(session) && (Boolean(position) || Boolean(pendingTrace));

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
        ${
          '' /* Highlighted while its sheet is open, and kept while linked by
             Record here so "this one" stays visible until Save or dismiss. */
        }
        selectedFeature=${tappedFeature ?? linkedFeature}
        pickedPoint=${pickedPoint}
        onPickPoint=${setPickedPoint}
        activeTrace=${activeTraceCoords}
        ${
          '' /* Marking a point and a pending trace arm the same Save; two
             provisional positions at once could only disagree. */
        }
        canPick=${!pendingTrace}
        gridRef=${gridRef}
        visible=${visible}
        night=${displayMode === 'night'}
        heading=${heading}
        positionStale=${
          /* Computed at render like the readings panel's own stale line —
             the GPS watch re-renders this page ~1Hz while it is alive, and
             when it stops delivering, both readouts age together. */
          Boolean(position && Date.now() - position.fixAtMs >= STALE_AFTER_MS)
        }
      />
      ${
        // Not a readout of something happening now — the app asking an
        // unprompted question after a crash — so it takes the suggestion
        // ground like the chooser, not the strip's accent edge, and nothing
        // pulses because nothing is recording. A sentence, not a status
        // line: the surveyor arrives at this cold, possibly days later.
        recoveredDraft
          ? html`<div class="trace-recovery" role="status">
              <p class="trace-recovery-title">Unfinished trace found</p>
              <p class="trace-recovery-copy">
                ${`A ${recoveredDraft.draft.mode} with ${recoveredDraft.vertices.length} point${
                  recoveredDraft.vertices.length === 1 ? '' : 's'
                } was still recording when the app closed. It has not been saved.`}
              </p>
              ${
                confirmingRecoveredDiscard
                  ? html`<span class="trace-discard-confirm">
                      <button
                        type="button"
                        class="trace-discard-commit"
                        onClick=${handleDiscardRecovered}
                      >
                        Discard trace
                      </button>
                      <button
                        type="button"
                        class="link"
                        onClick=${() => setConfirmingRecoveredDiscard(false)}
                      >
                        Keep it
                      </button>
                    </span>`
                  : html`<span class="trace-recovery-actions">
                      <button type="button" class="button-primary" onClick=${handleResumeRecovered}>
                        Resume
                      </button>
                      <button type="button" class="button-surface" onClick=${handleFinishRecovered}>
                        Finish
                      </button>
                      <button
                        type="button"
                        class="link"
                        onClick=${() => setConfirmingRecoveredDiscard(true)}
                      >
                        Discard
                      </button>
                    </span>`
              }
            </div>`
          : null
      }
      ${
        stripTrace
          ? html`<${TraceStrip}
              trace=${stripTrace}
              onPause=${handlePauseTrace}
              onResume=${handleResumeTrace}
              onFinish=${handleFinishTrace}
              onDiscard=${handleDiscardTrace}
            />`
          : null
      }
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
          // Starting a walk is a kind of capture, so it lives with the
          // capture actions — the map controls row is already full. Hidden
          // once a trace exists in any state: one walk at a time.
          session && !traceSession && !pendingTrace && !recoveredDraft
            ? html`<button
                type="button"
                class="button-outline"
                disabled=${!position}
                onClick=${() => setTraceChooserOpen((open) => !open)}
              >
                Trace
              </button>`
            : null
        }
      </div>
      ${
        // The one moment of modal choice in the flow, so it takes the
        // region-suggestion ground: like the suggestion, it is the app
        // asking an unprompted question. Options are stacked (it has to
        // hold at 320px) and each says what it records — a first-time user
        // won't know a boundary auto-closes.
        traceChooserOpen
          ? html`<div class="trace-chooser">
              <div class="trace-chooser-head">
                <p class="trace-chooser-title">What are you walking?</p>
                <button type="button" class="link" onClick=${() => setTraceChooserOpen(false)}>
                  Cancel
                </button>
              </div>
              <button
                type="button"
                class="trace-chooser-option"
                onClick=${() => handleStartTrace('path')}
              >
                <${TraceGlyph} mode="path" />
                <span class="trace-chooser-body">
                  <span class="trace-chooser-name">Trace a path</span>
                  <span class="trace-chooser-desc"
                    >Records the line you walk, start to finish.</span
                  >
                </span>
              </button>
              <button
                type="button"
                class="trace-chooser-option"
                onClick=${() => handleStartTrace('boundary')}
              >
                <${TraceGlyph} mode="boundary" />
                <span class="trace-chooser-body">
                  <span class="trace-chooser-name">Trace a boundary</span>
                  <span class="trace-chooser-desc">
                    Closes the loop back to your start point when you finish.
                  </span>
                </span>
              </button>
            </div>`
          : null
      }
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
        // At the page foot with the other session-level controls, not in the
        // capture-actions row: photo, voice and trace all attach to the
        // observation being composed, while Export — like End session — acts
        // on the whole session. (Design pass 2c: a scope argument, not a
        // space-saving one.)
        session
          ? html`<button
              type="button"
              class="button-outline capture-page-export"
              disabled=${exportState === 'exporting'}
              onClick=${handleExport}
            >
              ${exportState === 'exporting' ? 'Exporting…' : 'Export'}
            </button>`
          : null
      }
      ${
        exportMessage
          ? html`<p class="capture-page-export-message" role="status">${exportMessage}</p>`
          : null
      }
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
      <div class="mode-switch" role="group" aria-label="Display mode">
        <button
          type="button"
          class="mode-switch-option"
          aria-pressed=${displayMode !== 'night'}
          onClick=${() => onSetDisplayMode?.('auto')}
        >
          Auto
        </button>
        <button
          type="button"
          class="mode-switch-option"
          aria-pressed=${displayMode === 'night'}
          onClick=${() => onSetDisplayMode?.('night')}
        >
          Night
        </button>
      </div>
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
