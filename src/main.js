import { render } from 'preact';
import { html } from 'htm/preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App.js';
import { formatError } from './error-display.js';
import { openDatabase } from './storage/db.js';
import { createCaptureService } from './app/captureService.js';
import { newId, nowIso } from './domain/id.js';
import { watchPosition } from './sensors/position.js';
import { watchHeading, requestHeadingPermission } from './sensors/heading.js';
import { downscaleImageBlob } from './photo/encode.js';
import { buildSessionExport } from './export/buildSessionExport.js';
import { zipEntries } from './export/zip.js';
import { shareOrDownload } from './export/share.js';
import { subscribeOfflineStatus } from './app/offlineStatus.js';
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

window.addEventListener('error', (event) => showFatalError(event));
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

  async function exportSession(sessionId) {
    const { filename, entries } = await buildSessionExport(db, {
      sessionId,
      appVersion: __APP_VERSION__,
    });
    const zipBlob = await zipEntries(entries);
    const file = new File([zipBlob], filename, { type: 'application/zip' });
    return shareOrDownload(file, { title: filename });
  }

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
  };

  function renderApp() {
    render(
      html`<${App}
        service=${state.service}
        sensors=${state.sensors}
        downscale=${state.downscale}
        exportSession=${state.exportSession}
        offlineStatus=${state.offlineStatus}
        updateAvailable=${state.updateAvailable}
        onReload=${() => updateSW()}
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
}

main().catch(showFatalError);
