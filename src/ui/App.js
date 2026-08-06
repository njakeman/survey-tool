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
export function App({ service, sensors, downscale, exportSession }) {
  const [view, setView] = useState('capture');

  if (view === 'probe') {
    return html`
      <div>
        <button type="button" onClick=${() => setView('capture')}>Back to capture</button>
        <${ProbePage} />
      </div>
    `;
  }

  if (view === 'history') {
    return html`
      <${SessionHistoryPage}
        service=${service}
        exportSession=${exportSession}
        onBack=${() => setView('capture')}
      />
    `;
  }

  return html`
    <${CapturePage}
      service=${service}
      sensors=${sensors}
      downscale=${downscale}
      exportSession=${exportSession}
      onOpenProbe=${() => setView('probe')}
      onOpenHistory=${() => setView('history')}
    />
  `;
}
