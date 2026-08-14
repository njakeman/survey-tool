import { render } from 'preact';
import { html } from 'htm/preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App.js';
import { formatError, isMutedErrorEvent } from './error-display.js';
import { openDatabase } from './storage/db.js';
import { markSessionExported } from './storage/sessionStore.js';
import { createCaptureService } from './app/captureService.js';
import { newId, nowIso } from './domain/id.js';
import { watchPosition } from './sensors/position.js';
import { watchHeading, requestHeadingPermission } from './sensors/heading.js';
import { downscaleImageBlob } from './photo/encode.js';
import { startRecording } from './audio/record.js';
import { buildSessionExport } from './export/buildSessionExport.js';
import { zipEntries } from './export/zip.js';
import { shareOrDownload } from './export/share.js';
import { importSessionExport } from './import/importSession.js';
import { subscribeOfflineStatus } from './app/offlineStatus.js';
import { applyDisplayMode } from './app/displayMode.js';
import { getSetting, putSetting } from './storage/settingsStore.js';
import { createBasemapService } from './app/basemapService.js';
import { createFeatureLayerService } from './app/featureLayerService.js';
import { deleteLegacyBasemap } from './storage/basemapStore.js';
import { chooseActive } from './map/basemapSelection.js';
import { ONLINE_BASEMAPS, getOnlineBasemap } from './map/onlineBasemaps.js';
import { glyphsUrl } from './map/glyphs.js';
import { toGridRef } from './geo/osgb.js';
import './style.css';

// A blank screen with no console access (no Mac nearby for Web Inspector) is
// undiagnosable in the field. Anything that throws during startup — or later,
// uncaught — renders here instead of leaving #app empty.
function showFatalError(errorLike) {
  const app = document.getElementById('app');
  if (!app) return;
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space: pre-wrap; padding: 1rem; color: #b00; font-size: 0.85rem;';
  pre.textContent = `Something went wrong loading the app:\n\n${formatError(errorLike)}`;
  if (app.firstChild) {
    // #app already holds a real, rendered view — possibly mid-observation,
    // with an unsaved note/photo in memory. A later, possibly-unrelated
    // error (a stray rejection, a sensor hiccup) must not wipe that out from
    // under the surveyor. Only a genuinely empty #app — nothing ever
    // rendered, the actual "blank screen" case this exists for — gets the
    // full-replacement treatment below.
    app.prepend(pre);
  } else {
    app.appendChild(pre);
  }
}

window.addEventListener('error', (event) => {
  // WebKit's muted cross-origin errors (null error object, no filename)
  // surface from browser-internal/extension script — on iOS, notably around
  // the share sheet — and can never be app code or carry anything
  // actionable. Painting the fatal banner over a working app for them was
  // the intermittent "Script error. (:0:0)" report. Ignored here, logged
  // for anyone with a debugger attached; asserted in e2e/install.spec.js.
  if (isMutedErrorEvent(event)) {
    console.warn('Ignored muted cross-origin error', event);
    return;
  }
  // Prefer the real Error when the event carries one — name and stack beat
  // the event's message/filename summary.
  showFatalError(event.error ?? event);
});
window.addEventListener('unhandledrejection', (event) => showFatalError(event.reason));

// Composition root: open storage, build the capture service, bind sensor
// adapters to real browser globals, and render. Deliberately dumb — any
// conditional here belongs in a tested module instead (see plan Phase 3).
async function main() {
  const db = await openDatabase();
  const service = createCaptureService({ db, newId, nowIso });

  const sensors = {
    watchPosition: (handlers) => watchPosition(navigator.geolocation, handlers),
    watchHeading: (handlers) => watchHeading(window, handlers),
    requestHeadingPermission: () => requestHeadingPermission(window.DeviceOrientationEvent),
  };

  const downscale = (file) => downscaleImageBlob(file);

  // Voice notes. Browser-only module, main.js-only import — the same rule as
  // photo/encode.js — with the real recorder bound here and a fake handed in
  // everywhere tests need one.
  const recordAudio = () =>
    startRecording({
      mediaDevices: navigator.mediaDevices,
      MediaRecorderCtor: window.MediaRecorder,
    });

  // The OSTN15 shift grid, 34 kB from the precache. Held here rather than
  // imported into geo/osgb.js so that module stays pure, and read through a
  // function so every consumer gets whatever has arrived — a grid reference
  // is a convenience, and nothing waits for it or fails without it.
  let osgbGrid = null;
  const gridRef = (lat, lon) => (osgbGrid ? toGridRef(lat, lon, osgbGrid) : null);

  async function exportSession(sessionId) {
    const { filename, entries, observationCount } = await buildSessionExport(db, {
      sessionId,
      appVersion: __APP_VERSION__,
      gridRef,
    });
    const zipBlob = await zipEntries(entries);
    const file = new File([zipBlob], filename, { type: 'application/zip' });
    const result = await shareOrDownload(file, { title: filename });
    // The one write export makes: stamp what left and when, which is all the
    // Exported badges derive from. A dismissed share sheet stamps nothing —
    // the data went nowhere.
    if (result.cancelled) return result;
    const exportedAt = nowIso();
    await markSessionExported(db, sessionId, { exportedAt, observationCount });
    return { ...result, exportedAt, observationCount };
  }

  // The reverse trip: a previously exported zip (or bare session.geojson)
  // back onto the device, always as a copy under fresh ids.
  const importSession = async (file) =>
    importSessionExport(db, { buffer: await file.arrayBuffer(), filename: file.name }, { newId });

  // Absolute, because the service resolves each region's relative manifest
  // URL against it.
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  const basemapService = createBasemapService({
    db,
    fetchFn: (...args) => fetch(...args),
    manifestUrl: `${baseUrl}basemaps/manifest.json`,
    baseUrl,
    nowIso,
  });

  const featureLayerService = createFeatureLayerService({
    db,
    fetchFn: (...args) => fetch(...args),
    manifestUrl: `${baseUrl}feature-layers/manifest.json`,
    baseUrl,
    nowIso,
  });

  // The renderer is imported only once an archive actually exists, so a
  // device that has never downloaded one never pays for ~800 KB of MapLibre
  // at startup. The split chunk is still precached, so the import resolves
  // offline (same rule as photo/encode.js: browser-only, main.js only).
  // `fit` (history map): open fitted to a session's data. `view` (region
  // switch): open at the outgoing map's centre/zoom. Both applied by the
  // adapter at construction; fit outranks view.
  async function createMap({ container: mapContainer, onUserPan, onFeatureTap, fit, view }) {
    // An online region has no archive: hand the adapter the region and let
    // failed fetches surface as warnings (the adapter handles the two online
    // kinds — tile template vs remote style — itself). Everything about the
    // map's behaviour — overlays, picking, feature layers — is identical.
    const onlineRegion = getOnlineBasemap(state.activeRegionId);
    if (onlineRegion) {
      const { createMapAdapter } = await import('./map/mapAdapter.js');
      return createMapAdapter({
        container: mapContainer,
        online: onlineRegion,
        glyphsUrl: glyphsUrl(import.meta.env.BASE_URL),
        fit,
        view,
        onUserPan,
        onFeatureTap,
        onError: (error) => console.warn('map error', error),
      });
    }
    const archiveBuffer = await basemapService.loadArchive(state.activeRegionId);
    if (!archiveBuffer) throw new Error('No offline map archive stored on this device');
    const region = state.regions.find(({ id }) => id === state.activeRegionId);
    const { createMapAdapter } = await import('./map/mapAdapter.js');
    return createMapAdapter({
      container: mapContainer,
      archiveBuffer,
      glyphsUrl: glyphsUrl(import.meta.env.BASE_URL),
      // Raster regions get a wholly different style; the type travels with
      // the region so it survives the manifest being unreachable.
      tileType: region?.tileType ?? 'vector',
      tileSize: region?.tileSize,
      fit,
      view,
      onUserPan,
      onFeatureTap,
      // Map errors are diagnostics, not app failures: a missing tile must
      // never reach the fatal-error banner over a working capture page.
      onError: (error) => console.warn('map error', error),
    });
  }

  // Which regions exist, which are on the device, and which one the map
  // should open. Swallows its own failures: this runs at startup, and a
  // failed read must not land on the fatal-error banner over a working
  // capture page. statusKnown stays false in that case — "cannot tell" is
  // not "you have no map".
  async function refreshBasemapState() {
    try {
      const [{ regions, manifestAvailable }, selectedId] = await Promise.all([
        basemapService.listAvailable(),
        basemapService.getSelectedId(),
      ]);
      // The online pseudo-regions ride at the end of the list. They are not
      // part of what the service knows — nothing is stored, nothing is
      // downloaded — but the picker and the selection logic treat each as
      // one more region, which is what keeps it one mechanism instead of
      // two.
      state.regions = [...regions, ...ONLINE_BASEMAPS];
      state.manifestAvailable = manifestAvailable;
      state.selectedRegionId = selectedId;
      state.statusKnown = true;
      applySelection();
    } catch {
      state.statusKnown = false;
      renderApp();
    }
  }

  // Which region the map opens. The live fix isn't known here — it lives in
  // the capture page's sensor hook — so the position-based *suggestion* is
  // computed there; this is the remembered choice, or the only downloaded
  // region, and never changes on its own.
  function applySelection() {
    const { activeId } = chooseActive({
      regions: state.regions,
      selectedId: state.selectedRegionId,
    });
    state.activeRegionId = activeId;
    renderApp();
  }

  async function selectRegion(id) {
    await basemapService.select(id);
    state.selectedRegionId = id;
    state.dismissedSuggestionId = null;
    applySelection();
  }

  async function downloadRegion(id, onProgress) {
    await basemapService.download(id, onProgress);
    // First region downloaded becomes the one in use; later ones wait to be
    // chosen, so a download never moves the map out from under anyone.
    const hadNone = !state.activeRegionId;
    await refreshBasemapState();
    if (hadNone) await selectRegion(id);
  }

  async function removeRegion(id) {
    await basemapService.remove(id);
    await refreshBasemapState();
  }

  // Which layers exist, and the data for the ones switched on. Swallows its
  // own failures for the same reason refreshBasemapState does: this runs at
  // startup, and a failed read must not put the fatal-error banner over a
  // working capture page. An overlay that fails to load costs an overlay.
  async function refreshFeatureLayers() {
    try {
      const [{ layers, manifestAvailable }, loaded] = await Promise.all([
        featureLayerService.listAvailable(),
        featureLayerService.loadEnabled(),
      ]);
      state.featureLayerCatalogue = layers;
      state.featureLayersAvailable = manifestAvailable;
      state.featureLayers = loaded;
    } catch {
      // Leave whatever was already loaded in place.
    }
    renderApp();
  }

  // Errors deliberately propagate: FeatureLayerPanel catches them and shows
  // the reason on the row that failed, which is where the surveyor is looking.
  async function enableLayer(id) {
    await featureLayerService.enable(id);
    await refreshFeatureLayers();
  }

  async function disableLayer(id) {
    await featureLayerService.disable(id);
    await refreshFeatureLayers();
  }

  async function removeLayer(id) {
    await featureLayerService.remove(id);
    await refreshFeatureLayers();
  }

  function dismissSuggestion(id) {
    state.dismissedSuggestionId = id;
    applySelection();
  }

  // The display mode is a persisted, deliberate choice — never inferred from
  // the OS (that's what Auto's prefers-color-scheme handling is for; Light
  // and Dark force a scheme, Night keeps dark adaptation). Applied to
  // <html data-mode> before first render so a night — or forced-dark —
  // launch never flashes the daylight palette at a dark-adapted eye.
  const storedDisplayMode = (await getSetting(db, 'displayMode')) ?? 'auto';
  applyDisplayMode(storedDisplayMode, document);

  async function setDisplayMode(mode) {
    state.displayMode = mode;
    applyDisplayMode(mode, document);
    renderApp();
    await putSetting(db, 'displayMode', mode);
  }

  // Which end of the session the observations list leads with — a persisted
  // preference like displayMode (render-then-persist, same chain). 'oldest'
  // is the order the store returns and what shipped before the toggle.
  const storedObservationOrder = (await getSetting(db, 'observationOrder')) ?? 'oldest';

  async function setObservationOrder(order) {
    state.observationOrder = order;
    renderApp();
    await putSetting(db, 'observationOrder', order);
  }

  // What the OS scheme currently resolves to, for Auto's footer caption
  // ("Following the system — dark"). Owned here and passed down as a prop,
  // the sensor-adapter rule: components never read matchMedia themselves.
  const darkSchemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  darkSchemeQuery?.addEventListener?.('change', (event) => {
    state.systemScheme = event.matches ? 'dark' : 'light';
    renderApp();
  });

  const container = document.getElementById('app');

  // Mutable render state, re-rendered in place (Preact diffs) rather than a
  // one-shot render() call — two things need to update the page after first
  // paint, independent of any user action: an update becoming available, and
  // the offline-readiness reading settling. See the state fields' own
  // comments below for why each exists.
  const state = {
    service,
    sensors,
    downscale,
    exportSession,
    // Starts null (banner hidden) rather than reading synchronously at
    // startup: right after registration, precaching hasn't finished, so
    // precachedCount is genuinely 0 for an instant on *every* load — not
    // just a broken build. subscribeOfflineStatus below reports once that's
    // actually settled, which is what makes the banner mean something.
    offlineStatus: null,
    updateAvailable: false,
    // Tri-state, and it starts 'unknown' rather than 'absent' for the same
    // reason offlineStatus starts null: before the read resolves we cannot
    // tell, and claiming "no offline map" would offer a redundant
    // multi-megabyte download to someone who already has one.
    // statusKnown false until the stored regions have actually been read:
    // "cannot tell yet" must not render as "you have no map".
    statusKnown: false,
    regions: [],
    manifestAvailable: false,
    selectedRegionId: null,
    activeRegionId: null,
    dismissedSuggestionId: null,
    online: navigator.onLine,
    // Two views of the same thing: the catalogue is every published layer
    // with its state, for the picker; featureLayers is the loaded data for
    // the ones switched on, for the map. Kept apart because the catalogue
    // carries no geometry and the loaded set carries nothing about what else
    // exists.
    featureLayerCatalogue: [],
    featureLayersAvailable: false,
    featureLayers: [],
    displayMode: storedDisplayMode,
    systemScheme: darkSchemeQuery?.matches ? 'dark' : 'light',
    observationOrder: storedObservationOrder,
  };

  function renderApp() {
    render(
      html`<${App}
        service=${state.service}
        sensors=${state.sensors}
        downscale=${state.downscale}
        exportSession=${state.exportSession}
        importSession=${importSession}
        recordAudio=${recordAudio}
        offlineStatus=${state.offlineStatus}
        updateAvailable=${state.updateAvailable}
        onReload=${() => updateSW()}
        activeRegionId=${state.activeRegionId}
        statusKnown=${state.statusKnown}
        dismissedSuggestionId=${state.dismissedSuggestionId}
        regions=${state.regions}
        manifestAvailable=${state.manifestAvailable}
        createMap=${createMap}
        onSelectRegion=${selectRegion}
        onDownloadRegion=${downloadRegion}
        onRemoveRegion=${removeRegion}
        onDismissSuggestion=${dismissSuggestion}
        online=${state.online}
        featureLayers=${state.featureLayers}
        featureLayerCatalogue=${state.featureLayerCatalogue}
        featureLayersAvailable=${state.featureLayersAvailable}
        onEnableLayer=${enableLayer}
        onDisableLayer=${disableLayer}
        onRemoveLayer=${removeLayer}
        gridRef=${gridRef}
        displayMode=${state.displayMode}
        onSetDisplayMode=${setDisplayMode}
        systemScheme=${state.systemScheme}
        observationOrder=${state.observationOrder}
        onSetObservationOrder=${setObservationOrder}
      />`,
      container,
    );
  }

  // registerType: 'prompt' (vite.config.js) — src/sw/sw.js deliberately
  // waits rather than self-activating, so a new version sits idle until the
  // surveyor chooses to reload. updateSW(), called with no args from the
  // banner's Reload button, sends the skip-waiting message and reloads the
  // page once the new worker takes control (vite-plugin-pwa's register.js).
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      state.updateAvailable = true;
      renderApp();
    },
  });

  renderApp();

  subscribeOfflineStatus(
    {
      serviceWorker: navigator.serviceWorker,
      cacheStorage: window.caches,
      isSecureContext: window.isSecureContext,
      standalone: navigator.standalone,
    },
    (offlineStatus) => {
      state.offlineStatus = offlineStatus;
      renderApp();
    },
  );

  // Ask the browser to exempt this origin's storage from eviction. Best
  // effort and fire-and-forget: iOS grants it silently to installed PWAs,
  // and nothing prompts. Without it, storage pressure can evict IndexedDB —
  // every session gone — which in the field reads as "the update deleted my
  // data" (report, 2026-08-14). The probe page's storage row shows whether
  // it stuck.
  navigator.storage?.persist?.().catch(() => {});

  // Phase 4 stored a single archive under the fixed id 'basemap'. Nothing
  // references it now, so left alone it would sit on the device forever as
  // an invisible hundred megabytes.
  deleteLegacyBasemap(db).catch(() => {});

  refreshBasemapState();
  refreshFeatureLayers();

  // Precached, so this normally resolves offline and instantly. Failing is
  // survivable by design: no grid references, everything else unaffected —
  // which is why it is fetched rather than bundled into the startup chunk.
  fetch(`${import.meta.env.BASE_URL}geodesy/ostn15-lite.json`)
    .then((response) => (response.ok ? response.json() : null))
    .then((grid) => {
      if (!grid) return;
      osgbGrid = grid;
      renderApp();
    })
    .catch(() => {});

  for (const event of ['online', 'offline']) {
    window.addEventListener(event, () => {
      state.online = navigator.onLine;
      renderApp();
    });
  }
}

main().catch(showFatalError);
