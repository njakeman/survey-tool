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
import { readOfflineStatus } from './app/offlineStatus.js';
import './style.css';

// A blank screen with no console access (no Mac nearby for Web Inspector) is
// undiagnosable in the field. Anything that throws during startup — or later,
// uncaught — renders here instead of leaving #app empty.
function showFatalError(errorLike) {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space: pre-wrap; padding: 1rem; color: #b00; font-size: 0.85rem;';
  pre.textContent = `Something went wrong loading the app:\n\n${formatError(errorLike)}`;
  app.appendChild(pre);
}

window.addEventListener('error', (event) => showFatalError(event));
window.addEventListener('unhandledrejection', (event) => showFatalError(event.reason));

// Composition root: open storage, build the capture service, bind sensor
// adapters to real browser globals, and render. Deliberately dumb — any
// conditional here belongs in a tested module instead (see plan Phase 3).
async function main() {
  registerSW({ immediate: true });

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

  // Not gated on `navigator.serviceWorker.ready` — that can hang if
  // activation never completes, and this diagnostic must never be able to
  // block the app rendering at all. On the very first-ever install it may
  // transiently under-report before the SW claims the page; ProbePage's
  // "Recheck" covers that, and the checklist already calls for a relaunch
  // before trusting a cold-launch reading either way.
  const offlineStatus = await readOfflineStatus({
    serviceWorker: navigator.serviceWorker,
    cacheStorage: window.caches,
    isSecureContext: window.isSecureContext,
    standalone: navigator.standalone,
  });

  render(
    html`<${App}
      service=${service}
      sensors=${sensors}
      downscale=${downscale}
      exportSession=${exportSession}
      offlineStatus=${offlineStatus}
    />`,
    document.getElementById('app'),
  );
}

main().catch(showFatalError);
