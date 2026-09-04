import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  createFollowState,
  onFix,
  onRecentre,
  onUserPan,
  showsRecentre,
} from '../map/followMode.js';
import { bearingDeg, distanceM, pickAccuracyM } from '../geo/distance.js';
import { compassPoint, formatDistance } from '../sensors/format.js';
import { StationWalk } from './StationWalk.js';

// Where the picking crosshair sits, as a fraction down the map panel. A third
// rather than the middle because the confirm panel covers the bottom ~94px:
// centred, the reticle's target landed *behind* that panel and there was
// nothing to aim with.
//
// Exported and used twice — to position the crosshair in CSS, and to ask the
// adapter what is under it — so the two cannot disagree. They must not: at
// z17 a pixel is about 0.9 m, so a reticle and a recorded point 50px apart is
// a 45 m error in the saved coordinates, with nothing on screen to show it.
export const CROSSHAIR_Y_FRACTION = 0.33;

// The map panel on the capture page. Imports nothing heavy: the renderer
// arrives as the injected `createMap` factory (main.js loads the adapter
// dynamically), which is what keeps this testable with a fake adapter and
// keeps maplibre out of the UI layer.
//
// Choosing and downloading regions lives in BasemapPicker; this panel only
// shows the active one, offers a way to the picker, and relays a suggestion.

export function CaptureMap({
  activeRegionId,
  regionName,
  statusKnown,
  suggestion,
  createMap,
  onSwitchRegion,
  onDismissSuggestion,
  onOpenPicker,
  position,
  observations,
  featureLayers,
  onFeatureTap,
  selectedFeature,
  pickedPoint,
  onPickPoint,
  activeTrace,
  stations = null,
  currentStationId = null,
  canPick = true,
  gridRef,
  visible,
  night = false,
  heading = null,
  positionStale = false,
  // The effective device heading for the station readout — CapturePage owns
  // the compass→course fallback chain, exactly as it does for StationBlock.
  guidanceHeadingDeg = null,
}) {
  const containerRef = useRef(null);
  const adapterRef = useRef(null);
  const [adapterReady, setAdapterReady] = useState(false);
  const [follow, setFollow] = useState(createFollowState);
  const [error, setError] = useState(null);

  // Maximised: the panel becomes the screen (field to-do 2026-09-04 —
  // navigating to a station needs more map than 300px). A state attribute
  // on the SAME node plus a resize, never a portal or a second container:
  // the map is built once per region against containerRef, and a new node
  // would destroy it mid-survey. Nothing outside the panel changes, so the
  // GPS watch, a recording trace, the sticky station and the composed
  // observation are untouched by construction. Taking 300px out of flow
  // lets the browser clamp the scroll position, so it is stashed on the way
  // in and restored on the way out — the page must be exactly where it was.
  const [maximised, setMaximised] = useState(false);
  const scrollBeforeRef = useRef(0);

  // Where the outgoing map was looking, stashed in the build effect's
  // cleanup so a region switch reopens on the same ground instead of the
  // new region's default centre (all four online regions share the GB
  // centroid — the map visibly relocated to the North Pennines on every
  // switch to one of them). Best-effort: a broken adapter has no view worth
  // keeping, so a failed read just means the defaults — never the panel
  // error, which is for failures the surveyor must act on.
  const lastViewRef = useRef(null);

  // The tap handler is a fresh closure on every render, but the map is built
  // once per region — so the adapter would hold the very first one forever,
  // and every tap would land in a handler closed over a stale session. A ref
  // read at call time keeps the adapter's own callback stable.
  const featureTapRef = useRef(onFeatureTap);
  featureTapRef.current = onFeatureTap;

  // Marking a point the surveyor can see but cannot reach. A crosshair fixed
  // at the centre with the map panned underneath it, rather than a tap: a
  // gloved fingertip is a 44px target that covers the thing being aimed at,
  // where the crosshair is one pixel and always visible. Tap is also already
  // taken by feature layers.
  const [picking, setPicking] = useState(false);
  const [crosshair, setCrosshair] = useState(null);
  // Read inside the adapter's own tap callback, which is created once per
  // map and would otherwise close over `picking` as it was at construction.
  const pickingRef = useRef(false);
  pickingRef.current = picking;

  useEffect(() => {
    if (!activeRegionId || !containerRef.current) return undefined;
    let cancelled = false;

    // Switching region rebuilds from scratch: a MapLibre map is bound to the
    // archive it was constructed with.
    setError(null);
    createMap({
      container: containerRef.current,
      view: lastViewRef.current ?? undefined,
      onUserPan: () => setFollow((current) => onUserPan(current)),
      // Suppressed while picking: inspecting a feature and placing a point
      // are two different intents, and a tap that did both would do neither
      // predictably.
      onFeatureTap: (result) => {
        if (pickingRef.current) return;
        // The feature's sheet opens on the page beneath a maximised map, so
        // the map gives way — the tap's result must be visible.
        setMaximised(false);
        featureTapRef.current?.(result);
      },
    })
      .then((adapter) => {
        // The region can change again — or the view be torn down — while the
        // renderer is still starting.
        if (cancelled) {
          adapter.destroy();
          return;
        }
        adapterRef.current = adapter;
        setAdapterReady(true);
      })
      .catch((mapError) => {
        if (!cancelled) setError(mapError.message || 'Could not open the offline map');
      });

    return () => {
      cancelled = true;
      // Stash the outgoing view before the teardown — cleanup runs before
      // the next effect body, so the replacement build reads a fresh stash.
      const outgoing = adapterRef.current;
      if (outgoing) {
        try {
          const { lat, lon } = outgoing.getCenter();
          lastViewRef.current = { center: [lon, lat], zoom: outgoing.getZoom() };
        } catch {
          // A broken adapter has no view worth keeping.
        }
      }
      // Tear the outgoing map down here rather than on unmount alone, so
      // switching region releases the archive it was holding.
      adapterRef.current?.destroy();
      adapterRef.current = null;
      setAdapterReady(false);
    };
    // Keyed on the archive alone: createMap is a fresh closure on every
    // parent render, so depending on it would tear down and rebuild the map
    // continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRegionId]);

  // A renderer call that throws must never reach window.onerror. main.js's
  // handler puts the fatal-error banner over the whole page, and an
  // in-progress observation — note and photo — lives only in CapturePage's
  // state until Save. Losing that to a map problem is the wrong trade every
  // time, so map failures are reported in the map panel, where the existing
  // error line already is. Same rule as the adapter's onError, which already
  // routes maplibre's own error events away from the banner; this covers the
  // other path, a synchronous throw out of an effect.
  //
  // Not a substitute for the adapter being safe to call. It is the net under
  // the next one of these, found the hard way after "Style is not done
  // loading" reached a phone.
  function guarded(work) {
    try {
      work();
    } catch (mapError) {
      setError(mapError.message || 'The map failed');
    }
  }

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    guarded(() => {
      adapter.setPosition(position);
      if (!position) return;
      setFollow((current) => {
        const { state, centreOn } = onFix(current, position);
        if (centreOn) adapter.centreOn(centreOn);
        return state;
      });
    });
  }, [position, adapterReady]);

  useEffect(() => {
    guarded(() => adapterRef.current?.setObservations(observations ?? []));
  }, [observations, adapterReady]);

  useEffect(() => {
    // Keyed on the array reference, which main.js only replaces when a layer
    // is actually toggled — the adapter rebuilds a layer's sources and paint
    // wholesale, so running this on every GPS tick would be ruinous.
    guarded(() => adapterRef.current?.setFeatureLayers(featureLayers ?? []));
  }, [featureLayers, adapterReady]);

  useEffect(() => {
    // CapturePage stays mounted while another view shows, so the map was
    // laid out at zero size and needs measuring again on the way back — and
    // maximising changes the box the same way. The attribute is committed
    // before this runs, so resize() measures the new size; MapLibre's own
    // trackResize observer is belt-and-braces.
    if (visible) guarded(() => adapterRef.current?.resize());
  }, [visible, maximised, adapterReady]);

  useEffect(() => {
    if (!maximised) return undefined;
    // Cleanup runs once the collapsed layout is committed — the page is its
    // full height again, so the stashed offset is reachable.
    return () => {
      if (typeof window.scrollTo === 'function') window.scrollTo(0, scrollBeforeRef.current);
    };
  }, [maximised]);

  useEffect(() => {
    guarded(() => adapterRef.current?.setPickedPoint(pickedPoint ?? null));
  }, [pickedPoint, adapterReady]);

  useEffect(() => {
    // Keyed on the coordinates array reference: CapturePage replaces it per
    // accepted vertex — every few seconds at walking pace — not per GPS tick.
    guarded(() => adapterRef.current?.setActiveTrace(activeTrace ?? null));
  }, [activeTrace, adapterReady]);

  useEffect(() => {
    // The tapped (or linked) feature, echoed on the map so "this one" is
    // visible while its sheet is open and until Record here is saved.
    guarded(() => adapterRef.current?.setHighlight(selectedFeature ?? null));
  }, [selectedFeature, adapterReady]);

  useEffect(() => {
    // Revisit stations. Keyed on the derived array reference (CapturePage
    // memoises it per observation/claim change) plus the current target —
    // never per GPS tick.
    guarded(() =>
      adapterRef.current?.setStations?.(
        stations ? { stations, currentId: currentStationId } : null,
      ),
    );
  }, [stations, currentStationId, adapterReady]);

  useEffect(() => {
    // The CSS filter handles the tiles; the canvas-drawn trace casings need
    // their colour flipped to hold against the dimmed ground.
    guarded(() => adapterRef.current?.setNightMode?.(night));
  }, [night, adapterReady]);

  useEffect(() => {
    // The locator's beam and stale state. Heading ticks are throttled to
    // ~5Hz by the sensor adapter; the beam is the one thing on the map
    // allowed to move continuously.
    guarded(() => adapterRef.current?.setLocator?.({ heading, stale: positionStale }));
  }, [heading, positionStale, adapterReady]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!picking || !adapter) return undefined;
    // Subscribed only while picking. The readout has to be live under a
    // moving thumb, but a standing subscription would re-render this panel on
    // every follow-mode recentre, about once a second, for a readout that is
    // not on screen.
    const read = () =>
      setCrosshair({
        ...adapter.getPointAtFraction({ y: CROSSHAIR_Y_FRACTION }),
        zoom: adapter.getZoom(),
      });
    read();
    return adapter.onMove?.(read);
  }, [picking, adapterReady]);

  function startPicking() {
    // Follow mode off first. Otherwise the surveyor lines the crosshair up,
    // a GPS tick lands a second later, and the map jumps back to them — a
    // bug with no workaround from their side.
    setFollow((current) => onUserPan(current));
    setPicking(true);
  }

  function confirmPick() {
    if (!crosshair) return;
    onPickPoint?.({
      lat: crosshair.lat,
      lon: crosshair.lon,
      // Not the surveyor's own fix accuracy: this point was placed by eye,
      // and its uncertainty is how precisely the map could be aimed.
      accuracyM: pickAccuracyM(crosshair.lat, crosshair.zoom),
    });
    setPicking(false);
    // The picked point arms Save on the page beneath — the map gives way.
    setMaximised(false);
  }

  function expandMap() {
    // Read before the state commits: once the panel leaves the flow the
    // browser may already have clamped the scroll position.
    scrollBeforeRef.current = window.scrollY ?? 0;
    setMaximised(true);
  }

  function handleRecentre() {
    setFollow((current) => {
      const { state, centreOn } = onRecentre(current);
      if (centreOn) adapterRef.current?.centreOn(centreOn);
      return state;
    });
  }

  // "SU 14082 39216 · 240 m NE". Built as one string rather than interpolated
  // inline: htm trims the whitespace around a line break between expressions,
  // so a wrapped template silently loses the separators.
  function describeCrosshair() {
    if (!crosshair) return 'Reading the map…';
    const parts = [];
    const reference = gridRef?.(crosshair.lat, crosshair.lon);
    if (reference) parts.push(reference);
    if (position) {
      const away = distanceM(position, crosshair);
      const compass = compassPoint(bearingDeg(position, crosshair));
      parts.push(`${formatDistance(away)} ${compass}`);
    }
    // Coordinates only when there is nothing friendlier to show — outside
    // Great Britain, or before the shift grid has loaded.
    if (parts.length === 0) parts.push(`${crosshair.lat.toFixed(5)}, ${crosshair.lon.toFixed(5)}`);
    return parts.join(' · ');
  }

  if (!statusKnown) return null;

  if (!activeRegionId) {
    return html`
      <div class="capture-map capture-map-placeholder">
        <p class="capture-map-caption">no basemap on this device</p>
        <button type="button" class="button-surface" onClick=${onOpenPicker}>
          Choose a region
        </button>
      </div>
    `;
  }

  // The readout over the maximised map: the current station's walking
  // instruction, which the map covers when it is the screen. Only there —
  // on the page, StationBlock already shows it directly beneath the panel.
  const currentStation =
    maximised && stations
      ? (stations.find((station) => station.id === currentStationId) ?? null)
      : null;

  return html`
    <div class="capture-map" data-maximised=${maximised ? 'true' : undefined}>
      <div class="capture-map-canvas" ref=${containerRef}></div>
      ${
        // Its own corner rather than a fourth button in the control row,
        // which already wraps once Re-centre appears. Visible text while
        // maximised: the way back has to be legible in sun, through gloves.
        maximised
          ? html`<button
              type="button"
              class="button-surface capture-map-expand"
              onClick=${() => setMaximised(false)}
            >
              Close map
            </button>`
          : html`<button
              type="button"
              class="button-surface capture-map-expand"
              aria-label="Expand map"
              onClick=${expandMap}
            >
              <span aria-hidden="true">⤢</span>
            </button>`
      }
      ${
        // Which archive you are looking at. Regions can overlap and several
        // can be on the device at once; without this the only way to tell is
        // to open the picker.
        regionName
          ? html`<p class="capture-map-caption capture-map-region">${regionName}</p>`
          : null
      }
      ${
        // How many reference stations this revisit stands against — the
        // diamonds' legend, in one number. Natural case; CSS uppercases.
        stations && stations.length > 0
          ? html`<p class="capture-map-caption capture-map-stations">
              <span aria-hidden="true">◆</span> Stations · ${stations.length}
            </p>`
          : null
      }
      ${
        suggestion
          ? // Appears from a GPS tick alone, with no user action.
            html`<div class="capture-map-suggestion" role="status">
              <p class="capture-map-suggestion-copy">
                You appear to be in <strong>${suggestion.name}</strong>.
              </p>
              <div class="capture-map-suggestion-actions">
                <button
                  type="button"
                  class="button-primary"
                  onClick=${() => onSwitchRegion(suggestion.id)}
                >
                  Switch to it
                </button>
                <button
                  type="button"
                  class="button-outline"
                  onClick=${() => onDismissSuggestion(suggestion.id)}
                >
                  Not now
                </button>
              </div>
            </div>`
          : null
      }
      ${
        picking
          ? html`
              <div
                class="capture-map-crosshair"
                style=${`--crosshair-y: ${CROSSHAIR_Y_FRACTION * 100}%`}
                aria-hidden="true"
              ></div>
              <div class="capture-map-picking" role="status">
                <p class="capture-map-picking-readout">${describeCrosshair()}</p>
                <div class="capture-map-picking-actions">
                  <button type="button" class="button-primary" onClick=${confirmPick}>
                    Use this point
                  </button>
                  <button type="button" class="button-outline" onClick=${() => setPicking(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            `
          : null
      }
      ${
        // One flex row rather than three separately-positioned boxes. Pinned
        // left, centre and right, these came to roughly 380px of buttons
        // across a 320px map and overlapped — only visibly so once Re-centre
        // appeared, which needs the surveyor to have panned away from their
        // fix, which is why it went unnoticed. Hidden while picking: the
        // confirm panel owns the bottom of the map, and re-centring mid-aim
        // would undo the aiming.
        picking
          ? null
          : html`<div class="capture-map-foot">
              ${
                currentStation && position
                  ? html`<div class="capture-map-walk">
                      <p class="capture-map-walk-label">
                        Station ${currentStation.index + 1} of ${stations.length} ·
                        ${' '}${currentStation.name}
                      </p>
                      <${StationWalk}
                        position=${position}
                        station=${currentStation}
                        guidanceHeadingDeg=${guidanceHeadingDeg}
                      />
                    </div>`
                  : null
              }
              <div class="capture-map-controls">
                <button type="button" class="button-surface" onClick=${onOpenPicker}>
                  Change map
                </button>
                ${
                  // Withheld while a trace is pending: marking a point and the
                  // pending trace would arm the same Save with two different
                  // provisional positions.
                  canPick
                    ? html`<button type="button" class="button-surface" onClick=${startPicking}>
                        Mark a distant point
                      </button>`
                    : null
                }
                ${
                  showsRecentre(follow)
                    ? html`<button type="button" class="button-surface" onClick=${handleRecentre}>
                        Re-centre
                      </button>`
                    : null
                }
              </div>
            </div>`
      }
      ${error ? html`<p class="capture-map-error" role="alert">${error}</p>` : null}
    </div>
  `;
}
