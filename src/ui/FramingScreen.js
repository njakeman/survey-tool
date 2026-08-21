import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BodyPortal } from './BodyPortal.js';
import { distanceM, bearingDeg } from '../geo/distance.js';
import { compassPoint, formatDateLong, formatDistance } from '../sensors/format.js';

// The framing step (design 8c): the one moment the reference photo has to
// be on screen at size — full-screen through BodyPortal on the photo
// lightbox's skeleton (near-black scrim in every mode, 44px control inside
// the safe-area insets, dvh sizing). The camera is the native one via the
// file-input path (user decision — no getUserMedia, no ghost overlay; the
// design is built so this is complete), so with no live view to share the
// height, the reference takes it. Nothing here ever gates the shutter.

// Built in JS, not across htm line breaks (the describeCrosshair rule).
function captionFor(station) {
  const parts = [];
  if (station.headingDeg != null) {
    parts.push(`${String(Math.round(station.headingDeg)).padStart(3, '0')}°`);
  }
  if (station.gpsAccuracyM != null) parts.push(`±${Math.round(station.gpsAccuracyM)} m`);
  return parts.join(' · ');
}

function walkLine(position, station) {
  const away = distanceM(position, station);
  const compass = compassPoint(bearingDeg(position, station));
  if (away == null || !compass) return null;
  return `${formatDistance(away)} ${compass}`;
}

export function FramingScreen({
  station,
  stationCount,
  position,
  referenceStartedAt,
  readPhoto,
  onPhoto,
  onClose,
  busy = false,
}) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoState, setPhotoState] = useState(station.photoEntryName ? 'loading' : 'none');

  // One lazy read of one entry, straight out of the stored zip. Revoke via
  // a ref read at unmount, not a [url]-keyed effect — a pending effect's
  // cleanup never fires (the SavedPhoto rule).
  const urlRef = useRef(null);
  useEffect(() => () => urlRef.current && URL.revokeObjectURL(urlRef.current), []);
  useEffect(() => {
    let cancelled = false;
    if (!station.photoEntryName) {
      setPhotoState('none');
      return undefined;
    }
    setPhotoState('loading');
    (async () => {
      try {
        const bytes = await readPhoto(station.photoEntryName);
        if (cancelled) return;
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setPhotoUrl(url);
        setPhotoState('ready');
      } catch {
        if (!cancelled) setPhotoState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station.photoEntryName]);

  const walk = walkLine(position, station);
  const caption = captionFor(station);

  return html`<${BodyPortal}>
    <div class="framing-screen" role="dialog" aria-label="Frame the photo">
      <div class="framing-screen-head">
        <button
          type="button"
          class="framing-screen-back"
          aria-label="Back to capture"
          onClick=${() => onClose?.()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <polyline
              points="10,2.5 4,8 10,13.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <span class="framing-screen-title">
          ${station.name}
          <span class="framing-screen-count">· ${station.index + 1} of ${stationCount}</span>
        </span>
        ${walk ? html`<span class="framing-screen-walk">${walk}</span>` : null}
      </div>
      <p class="framing-screen-label">Reference · ${formatDateLong(referenceStartedAt)}</p>
      <div class="framing-screen-reference">
        ${
          photoState === 'ready'
            ? html`<img class="framing-screen-photo" src=${photoUrl} alt="Reference photo" />`
            : null
        }
        ${
          photoState === 'loading'
            ? html`<p class="framing-screen-note">Loading reference photo…</p>`
            : null
        }
        ${
          photoState === 'none'
            ? html`<p class="framing-screen-note">
                No reference photo for this station — the note is the guide.
              </p>`
            : null
        }
        ${
          photoState === 'error'
            ? html`<p class="framing-screen-note" role="alert">
                Could not read the reference photo. The note is the guide.
              </p>`
            : null
        }
        ${
          photoState === 'ready' && caption
            ? html`<p class="framing-screen-caption">${caption}</p>`
            : null
        }
      </div>
      <div class="framing-screen-foot">
        <label class="framing-screen-shutter button-primary">
          ${busy ? 'Processing…' : 'Take photo'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            class="visually-hidden"
            disabled=${busy}
            onChange=${(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onPhoto?.(file);
            }}
          />
        </label>
        <p class="framing-screen-hint">
          Close enough is your call. The app measures, it does not gate.
        </p>
      </div>
    </div>
  <//>`;
}
