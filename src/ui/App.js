import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { CapturePage } from './CapturePage.js';
import { SessionHistoryPage } from './SessionHistoryPage.js';
import { ProbePage } from '../probe/ProbePage.js';

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
  offlineStatus,
  updateAvailable,
  onReload,
  basemap,
  createMap,
  downloadBasemap,
  online,
  remoteSizeBytes,
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
        onBack=${() => setView('capture')}
      />
    `;
  }

  return html`
    <div>
      ${
        updateAvailable
          ? html`<p class="update-banner">
              New version available.
              <button type="button" onClick=${onReload}>Reload</button>
            </p>`
          : null
      }
      <div hidden=${view !== 'capture'}>
        <${CapturePage}
          service=${service}
          sensors=${sensors}
          downscale=${downscale}
          exportSession=${exportSession}
          offlineStatus=${offlineStatus}
          basemap=${basemap}
          createMap=${createMap}
          downloadBasemap=${downloadBasemap}
          online=${online}
          remoteSizeBytes=${remoteSizeBytes}
          visible=${view === 'capture'}
          onOpenProbe=${() => setView('probe')}
          onOpenHistory=${() => setView('history')}
        />
      </div>
      ${overlay}
    </div>
  `;
}
