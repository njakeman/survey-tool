import { html } from 'htm/preact';
import { lensBand } from '../photo/exif.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BodyPortal } from './BodyPortal.js';
import { ChevronGlyph } from './chevronGlyph.js';
import { PHOTO_CAP_MESSAGE } from './format.js';
import { distanceM, bearingDeg } from '../geo/distance.js';
import { compassPoint, formatDateLong, formatDistance } from '../sensors/format.js';

// The framing step (design 8c): the one moment the reference photo has to
// be on screen at size — full-screen through BodyPortal on the photo
// lightbox's skeleton (near-black scrim in every mode, 44px control inside
// the safe-area insets, dvh sizing). The camera is the native one via the
// file-input path (user decision — no getUserMedia, no ghost overlay; the
// design is built so this is complete), so with no live view to share the
// height, the reference takes it. Nothing here ever gates the shutter.
//
// A station holding several reference photos is paged through here (‹ › and
// a horizontal swipe, the lightbox's pager), and the shot reports which one
// it framed — the parent never re-derives that.

// A page turn by finger: at least this far across, and more across than
// down. The lightbox's rule, restated rather than shared — the two stages
// are different elements with different dismissal semantics.
const SWIPE_MIN_PX = 40;

// Built in JS, not across htm line breaks (the describeCrosshair rule). The
// bearing and accuracy are station facts, so every reference photo of the
// station carries them; "done" is per photo — this one has already been
// re-framed into the compose strip.
function captionFor(station, photo, done) {
  const parts = [];
  if (station.headingDeg != null) {
    parts.push(`${String(Math.round(station.headingDeg)).padStart(3, '0')}°`);
  }
  if (station.gpsAccuracyM != null) parts.push(`±${Math.round(station.gpsAccuracyM)} m`);
  // The lens the reference was shot on — per photo, and only when the
  // reference carried it (a library pick; a direct capture never does).
  const lens = describeLens(photo);
  if (lens) parts.push(lens);
  if (done) parts.push('done');
  return parts.join(' · ');
}

// "14 mm ultra-wide": the 35 mm-equivalent with its band; the physical
// focal length alone when that is all the file had. Null when unknown.
function describeLens(photo) {
  if (!photo) return null;
  if (photo.focalLength35mm != null) {
    const band = lensBand(photo.focalLength35mm);
    return `${Math.round(photo.focalLength35mm)} mm${band ? ` ${band}` : ''}`;
  }
  if (photo.focalLengthMm != null) return `${photo.focalLengthMm} mm`;
  return null;
}

// After a shot on a different lens than the reference: one plain line
// naming both, so the surveyor can reshoot on the matching lens if they
// want to. Words, not colour, and never a gate — the app measures, it does
// not gate. Only when both lenses are known and their bands differ.
function lensMismatch(photo, shotFocalLength35mm) {
  if (!photo || photo.focalLength35mm == null || shotFocalLength35mm == null) return null;
  const referenceBand = lensBand(photo.focalLength35mm);
  const shotBand = lensBand(shotFocalLength35mm);
  if (!referenceBand || !shotBand || referenceBand === shotBand) return null;
  return `Your shot: ${Math.round(shotFocalLength35mm)} mm ${shotBand} — the reference was ${Math.round(photo.focalLength35mm)} mm ${referenceBand}`;
}

function walkLine(position, station) {
  const away = distanceM(position, station);
  const compass = compassPoint(bearingDeg(position, station));
  if (away == null || !compass) return null;
  return `${formatDistance(away)} ${compass}`;
}

// Where the screen opens, and where it goes after a shot: the next reference
// not yet re-framed, searched forward from `after` and wrapping, so a
// station's photos are worked through in order without the surveyor having
// to remember which are left. Nothing left → null (stay put).
function nextUnframed(photos, framed, after, exclude) {
  for (let step = 1; step <= photos.length; step += 1) {
    const i = (after + step) % photos.length;
    const { filename } = photos[i];
    if (!framed.has(filename) && filename !== exclude) return i;
  }
  return null;
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
  atCap = false,
  framed = new Set(),
  // The shot's 35 mm-equivalent per reference filename it framed (from the
  // compose strip), for the lens-mismatch line. Null entries mean the shot
  // carried no lens — a direct capture — and draw no line.
  framedLens = new Map(),
}) {
  // The station's reference photos, in export order; one on screen at a time.
  // "Done" is the parent's `framed` (what the compose strip holds) plus the
  // shots taken here that the parent has not reported back yet — a shot
  // lands in the strip only after its downscale, and a quick second shutter
  // press must not wrap back to a reference just framed.
  const photos = station.photos ?? [];
  const [shot, setShot] = useState(() => new Set());
  const done = new Set([...framed, ...shot]);
  const [index, setIndex] = useState(() => nextUnframed(photos, done, -1) ?? 0);
  useEffect(() => {
    setShot(new Set());
    setIndex(nextUnframed(station.photos ?? [], framed, -1) ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station.id]);
  const shown = photos[Math.min(index, Math.max(photos.length - 1, 0))] ?? null;
  const entryName = shown?.entryName ?? null;

  // Lazy reads out of the stored zip, one per entry, cached by entry name so
  // paging back is instant; the shown photo's neighbours are warmed too.
  // Revoke via a ref read at unmount, not a [url]-keyed effect — a pending
  // effect's cleanup never fires (the SavedPhotos rule). `states` mirrors the
  // cache for rendering.
  const urlsRef = useRef(new Map());
  const [states, setStates] = useState({});
  useEffect(
    () => () => {
      for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
      urlsRef.current.clear();
    },
    [],
  );
  useEffect(() => {
    let cancelled = false;
    const wanted = [entryName, photos[index + 1]?.entryName, photos[index - 1]?.entryName].filter(
      Boolean,
    );
    for (const name of wanted) {
      if (urlsRef.current.has(name) || states[name]) continue;
      setStates((current) => ({ ...current, [name]: 'loading' }));
      (async () => {
        try {
          const bytes = await readPhoto(name);
          if (cancelled) return;
          const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
          urlsRef.current.set(name, url);
          setStates((current) => ({ ...current, [name]: 'ready' }));
        } catch {
          if (!cancelled) setStates((current) => ({ ...current, [name]: 'error' }));
        }
      })();
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryName]);

  const photoState = !entryName ? 'none' : (states[entryName] ?? 'loading');
  const photoUrl = entryName ? urlsRef.current.get(entryName) : null;

  function show(next) {
    if (next < 0 || next >= photos.length) return;
    setIndex(next);
  }

  const swipeRef = useRef(null);
  function handleStagePointerDown(event) {
    swipeRef.current = { x: event.clientX, y: event.clientY };
  }
  function handleStagePointerCancel() {
    swipeRef.current = null;
  }
  function handleStagePointerUp(event) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // A vertical drag is someone steadying themselves, not turning a page.
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;
    show(index + (dx < 0 ? 1 : -1));
  }

  function handleShot(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const filename = shown?.filename ?? null;
    onPhoto?.(file, filename);
    if (filename) setShot((current) => new Set([...current, filename]));
    // Move on to the next reference still to do; the parent closes the step
    // when this shot was the last.
    const next = nextUnframed(photos, done, index, filename);
    if (next != null) setIndex(next);
  }

  const walk = walkLine(position, station);
  const shownDone = Boolean(shown && done.has(shown.filename));
  const caption = captionFor(station, shown, shownDone);
  const mismatch = shownDone ? lensMismatch(shown, framedLens.get(shown.filename) ?? null) : null;
  const paged = photos.length > 1;
  const label = paged ? `Reference ${index + 1} of ${photos.length}` : 'Reference';

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
      <p class="framing-screen-label" aria-live="polite">
        ${`${label} · ${formatDateLong(referenceStartedAt)}`}
      </p>
      <div class="framing-screen-reference">
        <div
          class="framing-screen-stage"
          onPointerDown=${handleStagePointerDown}
          onPointerUp=${handleStagePointerUp}
          onPointerCancel=${handleStagePointerCancel}
        >
          ${
            photoState === 'ready'
              ? html`<img
                  class="framing-screen-photo"
                  src=${photoUrl}
                  alt="Reference photo"
                  draggable="false"
                />`
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
            paged
              ? html`<button
                    type="button"
                    class="framing-screen-nav framing-screen-nav-prev"
                    aria-label="Previous reference"
                    disabled=${index <= 0}
                    onClick=${() => show(index - 1)}
                  >
                    <${ChevronGlyph} direction="prev" />
                  </button>
                  <button
                    type="button"
                    class="framing-screen-nav framing-screen-nav-next"
                    aria-label="Next reference"
                    disabled=${index >= photos.length - 1}
                    onClick=${() => show(index + 1)}
                  >
                    <${ChevronGlyph} direction="next" />
                  </button>`
              : null
          }
        </div>
        ${
          photoState === 'ready' && caption
            ? html`<p class="framing-screen-caption">${caption}</p>`
            : null
        }
        ${mismatch ? html`<p class="framing-screen-lens-hint">${mismatch}</p>` : null}
      </div>
      <div class="framing-screen-foot">
        <label class="framing-screen-shutter button-primary">
          ${busy ? 'Processing…' : 'Take photo'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            class="visually-hidden"
            disabled=${busy || atCap}
            onChange=${handleShot}
          />
        </label>
        ${
          // A Camera-app shot picked from the library pairs to the reference
          // exactly like a direct one — same handler — and, unlike the direct
          // one, carries its lens (photo/exif.js). An option under the
          // shutter, which stays the surface's only accent control.
          html`<label class="framing-screen-library link">
            From library
            <input
              type="file"
              accept="image/*"
              class="visually-hidden"
              disabled=${busy || atCap}
              onChange=${handleShot}
            />
          </label>`
        }
        <p class="framing-screen-hint">
          ${
            atCap
              ? PHOTO_CAP_MESSAGE
              : 'Close enough is your call. The app measures, it does not gate.'
          }
        </p>
      </div>
    </div>
  <//>`;
}
