import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { isStandalone, canRequestOrientationPermission, canShareFiles } from './capabilities.js';
import { formatBytes, formatDuration } from './format.js';
import { appendLogEntry, readLog, clearLog } from './log.js';
import { benchmarkPbkdf2 } from './pbkdf2-benchmark.js';

// Throwaway on-device diagnostic (plan Phase 1). Answers the open questions
// that decide whether this app's architecture is viable on the maintainer's
// actual phone before any real feature is built on top of the assumption.
// Delete once every check has a confirmed answer recorded in the plan.

function log(check, result) {
  appendLogEntry(localStorage, { at: new Date().toISOString(), check, result });
}

function ResultRow({ label, children }) {
  return html`<div class="probe-row">
    <span class="probe-label">${label}</span>
    <span class="probe-result">${children}</span>
  </div>`;
}

export function ProbePage() {
  const [standalone, setStandalone] = useState(null);
  const [storageEstimate, setStorageEstimate] = useState(null);
  const [persisted, setPersisted] = useState(null);
  const [geoResult, setGeoResult] = useState(null);
  const [orientationResult, setOrientationResult] = useState(null);
  const [shareResult, setShareResult] = useState(null);
  const [pbkdf2Result, setPbkdf2Result] = useState(null);
  const [entries, setEntries] = useState(() => readLog(localStorage));

  function refreshLog() {
    setEntries(readLog(localStorage));
  }

  useEffect(() => {
    const standaloneNow = isStandalone({
      standalone: navigator.standalone,
      matchMedia: window.matchMedia,
    });
    setStandalone(standaloneNow);
    log('standalone', standaloneNow);
    refreshLog();

    navigator.storage?.estimate?.().then((estimate) => {
      setStorageEstimate(estimate);
      log('storage-estimate', estimate);
      refreshLog();
    });
  }, []);

  async function checkPersist() {
    const already = await navigator.storage?.persisted?.();
    const granted = already || (await navigator.storage?.persist?.());
    setPersisted(granted);
    log('storage-persist', granted);
    refreshLog();
  }

  function checkGeolocation() {
    setGeoResult('requesting…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const result = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        };
        setGeoResult(result);
        log('geolocation', result);
        refreshLog();
      },
      (error) => {
        const result = { error: error.message, code: error.code };
        setGeoResult(result);
        log('geolocation', result);
        refreshLog();
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function checkOrientationPermission() {
    if (!canRequestOrientationPermission(window.DeviceOrientationEvent)) {
      setOrientationResult('no requestPermission() — not iOS, or already unprompted');
      return;
    }
    // Must be called synchronously from this gesture handler.
    const result = await window.DeviceOrientationEvent.requestPermission();
    setOrientationResult(result);
    log('orientation-permission', result);
    refreshLog();
  }

  async function checkShare() {
    const file = new File(['field-survey probe test file'], 'probe-test.txt', {
      type: 'text/plain',
    });
    if (!canShareFiles(navigator, [file])) {
      setShareResult('canShare() says no for this file/browser');
      log('share', 'unsupported');
      refreshLog();
      return;
    }
    try {
      await navigator.share({ files: [file], title: 'Survey tool probe' });
      setShareResult('share sheet completed');
      log('share', 'completed');
    } catch (error) {
      const result = error.name === 'AbortError' ? 'dismissed by user' : `error: ${error.message}`;
      setShareResult(result);
      log('share', result);
    }
    refreshLog();
  }

  function checkDownload() {
    const blob = new Blob(['field-survey probe test file'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'probe-test.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    log('download-triggered', true);
    refreshLog();
  }

  async function runPbkdf2Benchmark() {
    setPbkdf2Result('running…');
    const result = await benchmarkPbkdf2({
      subtle: crypto.subtle,
      getRandomValues: (arr) => crypto.getRandomValues(arr),
      iterations: 600_000,
    });
    setPbkdf2Result(result);
    log('pbkdf2-600k', result);
    refreshLog();
  }

  return html`
    <main class="probe">
      <h1>Device capability probe</h1>
      <p>
        Run every check below, then relaunch the app from the home screen (not a reload) and run the
        orientation and storage-persist checks again — several iOS behaviours only differ across a
        cold relaunch.
      </p>

      <${ResultRow} label="Standalone (installed) mode">
        ${standalone === null ? '…' : standalone ? 'yes' : 'no — open from the home screen icon'}
      <//>

      <${ResultRow} label="Storage quota">
        ${
          storageEstimate
            ? html`${formatBytes(storageEstimate.usage)} used of
              ${formatBytes(storageEstimate.quota)}`
            : '…'
        }
      <//>

      <${ResultRow} label="Storage persist() granted">
        <button onClick=${checkPersist}>Check</button>
        ${persisted === null ? '' : persisted ? ' yes' : ' no'}
      <//>

      <${ResultRow} label="Geolocation fix">
        <button onClick=${checkGeolocation}>Get fix</button>
        ${geoResult ? html`<pre>${JSON.stringify(geoResult, null, 2)}</pre>` : ''}
      <//>

      <${ResultRow} label="Compass permission">
        <button onClick=${checkOrientationPermission}>Request</button>
        ${orientationResult ? ` ${orientationResult}` : ''}
      <//>

      <${ResultRow} label="Web Share with files">
        <button onClick=${checkShare}>Share test file</button>
        ${shareResult ? ` ${shareResult}` : ''}
      <//>

      <${ResultRow} label="Blob download">
        <button onClick=${checkDownload}>Download test file</button>
        <span>watch for a trapped preview sheet with no way back</span>
      <//>

      <${ResultRow} label="PBKDF2-SHA256, 600k iterations">
        <button onClick=${runPbkdf2Benchmark}>Benchmark</button>
        ${
          pbkdf2Result && pbkdf2Result !== 'running…'
            ? ` ${formatDuration(pbkdf2Result.elapsedMs)}`
            : pbkdf2Result === 'running…'
              ? ' running…'
              : ''
        }
      <//>

      <h2>Log (survives relaunch)</h2>
      <button
        onClick=${() => {
        clearLog(localStorage);
        refreshLog();
      }}
      >
        Clear log
      </button>
      <pre class="probe-log">${JSON.stringify(entries, null, 2)}</pre>
    </main>
  `;
}
