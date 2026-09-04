import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import {
  canRequestOrientationPermission,
  canShareFiles,
  supportedRecordingTypes,
} from './capabilities.js';
import { formatBytes, formatDuration, describeRecording, describeCameraExif } from './format.js';
import { appendLogEntry, readLog, clearLog } from './log.js';
import { benchmarkPbkdf2 } from './pbkdf2-benchmark.js';
import { readOfflineStatus } from '../app/offlineStatus.js';
import { isStandalone } from '../app/standalone.js';
import { RECORDING_MIME_CANDIDATES } from '../audio/recordingTypes.js';
import { jpegSegmentMap, parseCameraExif } from '../photo/exif.js';

// The on-device diagnostic page, reachable from the capture footer. Built in
// Phase 1 to answer whether this architecture was viable on the maintainer's
// actual phone, and kept since: it is now the permanent home of any check that
// has to be answerable on the device itself — offline readiness (there is no
// console on an installed iOS PWA), and the microphone question that decides
// whether voice notes get built. New capability doubts get a row here before
// any feature is built on the assumption.

// The same candidate list the real recorder uses (audio/recordingTypes.js),
// so the probe can never report support for a list the feature doesn't ask.
const RECORDING_MS = 3000;

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
  const [micResult, setMicResult] = useState(null);
  const [offlineStatusResult, setOfflineStatusResult] = useState(null);
  const [cameraExifResult, setCameraExifResult] = useState(null);
  const [entries, setEntries] = useState(() => readLog(localStorage));

  // Does this device's camera input hand over the lens tags? The photo
  // pipeline strips every byte of EXIF on the canvas re-encode, so the lens
  // per photo (2026-09) can only come from the original File — and whether
  // iOS Safari keeps FocalLength / FocalLengthIn35mmFilm / LensModel on a
  // camera capture is a device fact, not a documented one. Same input
  // attributes as the real shutter, so the finding is the finding.
  //
  // First live result (2026-09-04): a direct capture came back as a 2.3 MB
  // JPEG with no Exif block found. Two readings of that — WebKit's camera UI
  // re-encodes and strips, or the reader missed a real file's layout — so
  // the row now logs the file name (image.jpg is the camera UI, IMG_nnnn a
  // library pick), the segment map of the head, and offers a library pick
  // alongside the capture to compare the two paths on the same phone.
  async function checkCameraExif(event, check) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setCameraExifResult('reading…');
    let head;
    try {
      head = await file.slice(0, 256 * 1024).arrayBuffer();
    } catch (error) {
      const result = `could not read the file: ${error.name} — ${error.message}`;
      setCameraExifResult(result);
      record(check, result);
      return;
    }
    const camera = parseCameraExif(head);
    const segments = jpegSegmentMap(head);
    const result = describeCameraExif({ file, camera, segments });
    setCameraExifResult(result);
    record(check, {
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      ...camera,
      segments: segments.segments.map((s) => `${s.marker} ${s.length}`),
      exifString: segments.exifString,
    });
  }

  function refreshLog() {
    setEntries(readLog(localStorage));
  }

  // Every check funnels through here: one call both persists the finding
  // (localStorage survives a relaunch, which the on-screen state does not)
  // and refreshes the visible log, so a check cannot record without showing
  // or show without recording.
  function record(check, result) {
    appendLogEntry(localStorage, { at: new Date().toISOString(), check, result });
    refreshLog();
  }

  async function checkOfflineStatus(standaloneNow = standalone ?? false) {
    const result = await readOfflineStatus({
      serviceWorker: navigator.serviceWorker,
      cacheStorage: window.caches,
      isSecureContext: window.isSecureContext,
      standalone: standaloneNow,
    });
    setOfflineStatusResult(result);
    record('offline-status', result);
  }

  useEffect(() => {
    const standaloneNow = isStandalone({
      standalone: navigator.standalone,
      matchMedia: window.matchMedia,
    });
    setStandalone(standaloneNow);
    record('standalone', standaloneNow);

    navigator.storage?.estimate?.().then((estimate) => {
      setStorageEstimate(estimate);
      record('storage-estimate', estimate);
    });

    // Auto-run, not gated behind a button — no permission prompt involved,
    // and this is exactly the check that needs to be seen without an extra
    // tap, since "is this build actually offline-capable" is the question
    // device-testing kept getting wrong answers to by inference.
    checkOfflineStatus(standaloneNow);
    // Mount only: a diagnostic snapshot, re-run on demand by Recheck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkPersist() {
    const already = await navigator.storage?.persisted?.();
    const granted = already || (await navigator.storage?.persist?.());
    setPersisted(granted);
    record('storage-persist', granted);
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
        record('geolocation', result);
      },
      (error) => {
        const result = { error: error.message, code: error.code };
        setGeoResult(result);
        record('geolocation', result);
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
    record('orientation-permission', result);
  }

  async function checkShare() {
    const file = new File(['field-survey probe test file'], 'probe-test.txt', {
      type: 'text/plain',
    });
    if (!canShareFiles(navigator, [file])) {
      setShareResult('canShare() says no for this file/browser');
      record('share', 'unsupported');
      return;
    }
    try {
      await navigator.share({ files: [file], title: 'Survey tool probe' });
      setShareResult('share sheet completed');
      record('share', 'completed');
    } catch (error) {
      const result = error.name === 'AbortError' ? 'dismissed by user' : `error: ${error.message}`;
      setShareResult(result);
      record('share', result);
    }
  }

  function checkDownload() {
    const blob = new Blob(['field-survey probe test file'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'probe-test.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    record('download-triggered', true);
  }

  // Could an observation carry a voice note? Storage says yes easily — AAC
  // mono at 24 kbps is about half a photo per minute. The doubt is entirely
  // about whether an *installed, standalone* iOS PWA can get a microphone at
  // all: WebKit bug 185448 says apps added to the home screen see no device,
  // Apple's forums carry reports of recording working once and then failing
  // until the phone is restarted, and iOS 26.1 was reported to break audio
  // input outright. So this is measured on the device before anything is
  // built on it — the same reason geolocation and compass were probed first.
  //
  // Press it twice. Working once and then not is the specific failure.
  async function checkMicrophone() {
    const types = supportedRecordingTypes(window.MediaRecorder, RECORDING_MIME_CANDIDATES);
    if (types.length === 0) {
      const result =
        typeof window.MediaRecorder === 'function'
          ? 'MediaRecorder present but supports none of the candidate types'
          : 'no MediaRecorder on this device';
      setMicResult(result);
      record('microphone', result);
      return;
    }

    setMicResult('recording…');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      // Denied and "resolved but gave me nothing" point at completely
      // different problems, so they must not collapse into one message.
      const result = `getUserMedia failed: ${error.name} — ${error.message}`;
      setMicResult(result);
      record('microphone', result);
      return;
    }

    try {
      const mimeType = types[0];
      const recorder = new window.MediaRecorder(stream, {
        mimeType,
        // Voice, not music. If the encoder honours it, a minute is tens of
        // kilobytes; the measured figure below says whether it did.
        audioBitsPerSecond: 24_000,
      });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };

      const started = performance.now();
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, RECORDING_MS));
      recorder.stop();
      await stopped;

      const bytes = chunks.reduce((total, chunk) => total + chunk.size, 0);
      const result = describeRecording({ mimeType, bytes, ms: performance.now() - started });
      setMicResult(`${result} · offered: ${types.join(', ')}`);
      record('microphone', result);
    } catch (error) {
      const result = `recording failed: ${error.name} — ${error.message}`;
      setMicResult(result);
      record('microphone', result);
    } finally {
      // Every track, always. A capture left running keeps the iOS recording
      // indicator lit and is the likeliest cause of the reported "works once,
      // then never again until you restart the phone".
      for (const track of stream.getTracks()) track.stop();
    }
  }

  async function runPbkdf2Benchmark() {
    setPbkdf2Result('running…');
    const result = await benchmarkPbkdf2({
      subtle: crypto.subtle,
      getRandomValues: (arr) => crypto.getRandomValues(arr),
      iterations: 600_000,
    });
    setPbkdf2Result(result);
    record('pbkdf2-600k', result);
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

      <${ResultRow} label="Offline-ready">
        <button onClick=${() => checkOfflineStatus()}>Recheck</button>
        ${
          offlineStatusResult === null
            ? ' …'
            : html`
                <span>
                  ${
                    offlineStatusResult.offlineReady
                      ? ' yes'
                      : ' NO — this build will not work offline'
                  }
                  (secure context: ${String(offlineStatusResult.secureContext)}, SW controlling:
                  ${String(offlineStatusResult.controlled)}, precached entries:
                  ${offlineStatusResult.precachedCount})
                </span>
              `
        }
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

      <${ResultRow} label="Microphone (voice notes)">
        <button onClick=${checkMicrophone}>Record 3 s</button>
        ${micResult ? ` ${micResult}` : ' run it twice — working once then failing is the bug'}
      <//>

      <${ResultRow} label="Camera EXIF (lens per photo)">
        <label class="probe-file">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange=${(event) => checkCameraExif(event, 'camera-exif')}
          />
          Take a photo
        </label>
        ${' '}
        <label class="probe-file">
          <input
            type="file"
            accept="image/*"
            onChange=${(event) => checkCameraExif(event, 'camera-exif-library')}
          />
          Choose from library
        </label>
        ${
          cameraExifResult
            ? ` ${cameraExifResult}`
            : ' take one directly, then pick one shot in the Camera app on the same lens — compare the two lines'
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
