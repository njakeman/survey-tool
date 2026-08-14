import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { observationBounds } from '../map/viewport.js';

// The read-only map in a session-history detail: where did this session's
// records land. A slim sibling of CaptureMap — same injected createMap
// factory (main.js's closure over the active region, so the basemap and the
// dynamic-import chunk are shared), none of the capture concerns: no follow
// mode, no position or locator, no picking, no feature layers (they are a
// capture-time aid; here they would add tap targets that imply an
// interactivity the page refuses), no controls beyond the renderer's own
// pan and zoom.
//
// Rendered only when there is something to show: a session with no
// observations has nothing to fit to, and without an active region an empty
// frame would be a question history cannot answer (getting a basemap is the
// capture page's job). The opening view is fitted to the session's data at
// construction — no jump from the archive centre.
export function HistoryMap({
  activeRegionId,
  statusKnown,
  createMap,
  observations,
  night = false,
}) {
  const containerRef = useRef(null);
  const adapterRef = useRef(null);
  const [adapterReady, setAdapterReady] = useState(false);
  const [error, setError] = useState(null);

  const showable = statusKnown && activeRegionId && (observations?.length ?? 0) > 0;

  // The fit is decided at build time from the observations present then —
  // a ref read inside the build effect, so the effect can stay keyed on the
  // region alone (createMap and the array are fresh references per render).
  const observationsRef = useRef(observations);
  observationsRef.current = observations;

  useEffect(() => {
    if (!showable || !containerRef.current) return undefined;
    let cancelled = false;

    setError(null);
    createMap({
      container: containerRef.current,
      fit: observationBounds(observationsRef.current),
    })
      .then((adapter) => {
        if (cancelled) {
          adapter.destroy();
          return;
        }
        adapterRef.current = adapter;
        setAdapterReady(true);
      })
      .catch((mapError) => {
        if (!cancelled) setError(mapError.message || 'Could not open the map');
      });

    return () => {
      cancelled = true;
      adapterRef.current?.destroy();
      adapterRef.current = null;
      setAdapterReady(false);
    };
    // Keyed on the region (and showability) alone — createMap is a fresh
    // closure every parent render; depending on it would rebuild the map
    // continuously. Same rule as CaptureMap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRegionId, showable]);

  // Same net as CaptureMap's guarded(): a renderer throw must land in the
  // panel, not on window.onerror's fatal banner.
  function guarded(work) {
    try {
      work();
    } catch (mapError) {
      setError(mapError.message || 'The map failed');
    }
  }

  useEffect(() => {
    guarded(() => adapterRef.current?.setObservations(observations ?? []));
  }, [observations, adapterReady]);

  useEffect(() => {
    guarded(() => adapterRef.current?.setNightMode?.(night));
  }, [night, adapterReady]);

  if (!showable) return null;

  return html`
    <div class="history-map">
      <div class="history-map-canvas" ref=${containerRef}></div>
      ${error ? html`<p class="history-map-error" role="alert">${error}</p>` : null}
    </div>
  `;
}
