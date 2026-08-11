import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  createFollowState,
  onFix,
  onRecentre,
  onUserPan,
  showsRecentre,
} from '../map/followMode.js';

// The map panel on the capture page. Imports nothing heavy: the renderer
// arrives as the injected `createMap` factory (main.js loads the adapter
// dynamically), which is what keeps this testable with a fake adapter and
// keeps maplibre out of the UI layer.
//
// Choosing and downloading regions lives in BasemapPicker; this panel only
// shows the active one, offers a way to the picker, and relays a suggestion.

export function CaptureMap({
  activeRegionId,
  statusKnown,
  suggestion,
  createMap,
  onSwitchRegion,
  onDismissSuggestion,
  onOpenPicker,
  position,
  observations,
  visible,
}) {
  const containerRef = useRef(null);
  const adapterRef = useRef(null);
  const [adapterReady, setAdapterReady] = useState(false);
  const [follow, setFollow] = useState(createFollowState);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!activeRegionId || !containerRef.current) return undefined;
    let cancelled = false;

    // Switching region rebuilds from scratch: a MapLibre map is bound to the
    // archive it was constructed with.
    setError(null);
    createMap({
      container: containerRef.current,
      onUserPan: () => setFollow((current) => onUserPan(current)),
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

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    adapter.setPosition(position);
    if (!position) return;
    setFollow((current) => {
      const { state, centreOn } = onFix(current, position);
      if (centreOn) adapter.centreOn(centreOn);
      return state;
    });
  }, [position, adapterReady]);

  useEffect(() => {
    adapterRef.current?.setObservations(observations ?? []);
  }, [observations, adapterReady]);

  useEffect(() => {
    // CapturePage stays mounted while another view shows, so the map was
    // laid out at zero size and needs measuring again on the way back.
    if (visible) adapterRef.current?.resize();
  }, [visible, adapterReady]);

  function handleRecentre() {
    setFollow((current) => {
      const { state, centreOn } = onRecentre(current);
      if (centreOn) adapterRef.current?.centreOn(centreOn);
      return state;
    });
  }

  if (!statusKnown) return null;

  if (!activeRegionId) {
    return html`
      <div class="capture-map capture-map-placeholder">
        <button type="button" onClick=${onOpenPicker}>Choose a region</button>
      </div>
    `;
  }

  return html`
    <div class="capture-map">
      <div class="capture-map-canvas" ref=${containerRef}></div>
      ${
        suggestion
          ? // Appears from a GPS tick alone, with no user action.
            html`<p class="capture-map-suggestion" role="status">
              You appear to be in ${suggestion.name}.
              <button type="button" onClick=${() => onSwitchRegion(suggestion.id)}>
                Switch to it
              </button>
              <button type="button" onClick=${() => onDismissSuggestion(suggestion.id)}>
                Not now
              </button>
            </p>`
          : null
      }
      ${
        showsRecentre(follow)
          ? html`<button type="button" class="capture-map-recentre" onClick=${handleRecentre}>
              Re-centre
            </button>`
          : null
      }
      <button type="button" class="capture-map-change" onClick=${onOpenPicker}>Change map</button>
      ${error ? html`<p class="capture-map-error" role="alert">${error}</p>` : null}
    </div>
  `;
}
