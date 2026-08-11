import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { CapturePage } from './CapturePage.js';
import { SessionHistoryPage } from './SessionHistoryPage.js';
import { ProbePage } from '../probe/ProbePage.js';
import { BasemapPicker } from './BasemapPicker.js';

// The entire "router": in-memory view state, no hash, no history API. Hash
// routing re-triggers iOS geolocation permission prompts on standalone
// launches (WebKit bug 215884) — an on-screen Back button is the only route
// back, which is fine since the iOS back swipe does nothing in standalone
// mode anyway.
export function App({
  service,
  sensors,
  downscale,
  exportSession,
  importSession,
  recordAudio,
  offlineStatus,
  updateAvailable,
  onReload,
  activeRegionId,
  statusKnown,
  dismissedSuggestionId,
  regions,
  manifestAvailable,
  createMap,
  onSelectRegion,
  onDownloadRegion,
  onRemoveRegion,
  onDismissSuggestion,
  online,
  featureLayers,
  featureLayerCatalogue,
  featureLayersAvailable,
  onEnableLayer,
  onDisableLayer,
  onRemoveLayer,
  gridRef,
}) {
  const [view, setView] = useState('capture');

  // CapturePage stays mounted whichever view is showing: the in-progress
  // observation (note/photo) lives only in its state until Save and must
  // never be wiped by a view switch, and unmounting would also tear down
  // the ~1Hz GPS watch and force a cold re-acquire on return. Probe and
  // history mount fresh per visit — history deliberately re-reads sessions.
  let overlay = null;
  if (view === 'probe') {
    overlay = html`
      <div>
        <button type="button" onClick=${() => setView('capture')}>Back to capture</button>
        <${ProbePage} />
      </div>
    `;
  } else if (view === 'history') {
    overlay = html`
      <${SessionHistoryPage}
        service=${service}
        exportSession=${exportSession}
        importSession=${importSession}
        gridRef=${gridRef}
        onBack=${() => setView('capture')}
      />
    `;
  } else if (view === 'basemaps') {
    overlay = html`
      <${BasemapPicker}
        regions=${regions}
        manifestAvailable=${manifestAvailable}
        activeId=${activeRegionId}
        online=${online}
        onSelect=${onSelectRegion}
        onDownload=${onDownloadRegion}
        onRemove=${onRemoveRegion}
        onBack=${() => setView('capture')}
        featureLayers=${featureLayerCatalogue}
        featureLayersAvailable=${featureLayersAvailable}
        onEnableLayer=${onEnableLayer}
        onDisableLayer=${onDisableLayer}
        onRemoveLayer=${onRemoveLayer}
      />
    `;
  }

  return html`
    <div>
      ${
        updateAvailable
          ? // An offer, not a warning: a waiting service worker never
            // activates without this tap, and the surveyor chooses when.
            html`<p class="update-banner">
              New version available.
              <button type="button" class="button-inverse" onClick=${onReload}>Reload</button>
            </p>`
          : null
      }
      <div hidden=${view !== 'capture'}>
        <${CapturePage}
          service=${service}
          sensors=${sensors}
          downscale=${downscale}
          exportSession=${exportSession}
          recordAudio=${recordAudio}
          offlineStatus=${offlineStatus}
          activeRegionId=${activeRegionId}
          statusKnown=${statusKnown}
          regions=${regions}
          dismissedSuggestionId=${dismissedSuggestionId}
          createMap=${createMap}
          featureLayers=${featureLayers}
          gridRef=${gridRef}
          onSwitchRegion=${onSelectRegion}
          onDismissSuggestion=${onDismissSuggestion}
          onOpenPicker=${() => setView('basemaps')}
          visible=${view === 'capture'}
          onOpenProbe=${() => setView('probe')}
          onOpenHistory=${() => setView('history')}
        />
      </div>
      ${overlay}
    </div>
  `;
}
