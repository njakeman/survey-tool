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

function formatMegabytes(bytes) {
  if (!bytes) return null;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function CaptureMap({
  basemap,
  createMap,
  downloadBasemap,
  position,
  observations,
  visible,
  online,
  remoteSizeBytes,
}) {
  const containerRef = useRef(null);
  const adapterRef = useRef(null);
  const [adapterReady, setAdapterReady] = useState(false);
  const [follow, setFollow] = useState(createFollowState);
  const [phase, setPhase] = useState('idle'); // idle | downloading | error
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const present = basemap?.state === 'present';

  useEffect(() => {
    if (!present || adapterRef.current || !containerRef.current) return undefined;
    let cancelled = false;

    createMap({
      container: containerRef.current,
      onUserPan: () => setFollow((current) => onUserPan(current)),
    })
      .then((adapter) => {
        // The view can be torn down while the renderer is still starting.
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
    };
  }, [present]);

  // Unmount only — the map outlives every prop change.
  useEffect(
    () => () => {
      adapterRef.current?.destroy();
      adapterRef.current = null;
    },
    [],
  );

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

  async function handleDownload() {
    setPhase('downloading');
    setError(null);
    setProgress(null);
    try {
      await downloadBasemap((update) => setProgress(update));
      setPhase('idle');
    } catch (downloadError) {
      setPhase('error');
      setError(downloadError.message || 'Could not download the offline map');
    }
  }

  if (!present) {
    // 'unknown' says nothing and offers nothing: a failed status read must
    // not nag the surveyor to re-download an archive they may already have.
    return html`
      <div class="capture-map capture-map-placeholder">
        ${
          phase === 'downloading'
            ? html`<p class="capture-map-progress">${describeProgress(progress)}</p>`
            : null
        }
        ${
          phase === 'error'
            ? html`<p class="capture-map-error">
                ${error}
                <button type="button" onClick=${handleDownload}>Try again</button>
              </p>`
            : null
        }
        ${
          phase === 'idle' && basemap?.state === 'absent'
            ? online
              ? html`<button type="button" onClick=${handleDownload}>
                  Download offline
                  map${
                    remoteSizeBytes
                      ? html` <span class="capture-map-size"
                          >(${formatMegabytes(remoteSizeBytes)})</span
                        >`
                      : null
                  }
                </button>`
              : html`<p class="capture-map-note">
                  Offline map not downloaded — connect to download it
                </p>`
            : null
        }
      </div>
    `;
  }

  return html`
    <div class="capture-map">
      <div class="capture-map-canvas" ref=${containerRef}></div>
      ${
        showsRecentre(follow)
          ? html`<button type="button" class="capture-map-recentre" onClick=${handleRecentre}>
              Re-centre
            </button>`
          : null
      }
      ${error ? html`<p class="capture-map-error">${error}</p>` : null}
    </div>
  `;
}

function describeProgress(progress) {
  if (!progress) return 'Downloading offline map…';
  const { receivedBytes, totalBytes } = progress;
  const received = formatMegabytes(receivedBytes) ?? '0 MB';
  if (!totalBytes) return `Downloading offline map — ${received}`;
  return `Downloading offline map — ${Math.round((receivedBytes / totalBytes) * 100)}%`;
}
