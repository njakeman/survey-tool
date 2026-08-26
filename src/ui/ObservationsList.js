import { html } from 'htm/preact';
import {
  formatLatLon,
  formatAccuracy,
  formatHeading,
  formatTime,
  formatDistance,
  accuracyQuality,
} from '../sensors/format.js';
import { formatDuration, PHOTO_CAP_MESSAGE } from './format.js';
import { lineLengthM } from '../geo/lineMetrics.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ExportBadge } from './ExportBadge.js';
import { TraceGlyph } from './traceGlyphs.js';
import { VoiceTransport } from './VoiceTransport.js';
import { BodyPortal } from './BodyPortal.js';
import { ChevronGlyph } from './chevronGlyph.js';
import { MAX_PHOTOS } from '../photo/dimensions.js';

const cameraGlyph = html`<span class="glyph-camera" aria-hidden="true"></span>`;

// How far a finger must travel across the photo before it counts as a page
// turn rather than a tap that slid. Gloves and a moving boat both wobble;
// 40px is short enough to feel willing and long enough not to fire on a
// steadying touch. The gesture is measured at pointerup alone — nothing
// moves under the finger, so there is no animation to fight, and nothing for
// reduced-motion to suppress.
const SWIPE_MIN_PX = 40;

// A saved voice note, loaded only when the surveyor asks to hear it — the
// bytes stay in IndexedDB until the tap. The chip states the duration when
// the record carries one (audioDurationMs, stored at save time) — the one
// fact that decides play-now-or-later — and once loaded it becomes the
// shared VoiceTransport row. No delete here (design pass 4, 7b): removing a
// voice note off a saved observation is not offered on a row being scanned.
function SavedVoiceNote({ audioId, durationMs, loadAudio }) {
  const [url, setUrl] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | ready | error

  // Revoke via a ref-read at unmount, not a [url]-dependent effect — the
  // same pending-effect race SavedPhotos documents below: an effect
  // registered after the async load may never run before unmount, and a
  // pending effect's cleanup never fires, leaking the URL.
  const urlRef = useRef(null);
  useEffect(() => () => urlRef.current && URL.revokeObjectURL(urlRef.current), []);

  if (!loadAudio) return html`<p class="observations-audio">Voice note</p>`;

  async function open() {
    setState('loading');
    try {
      const record = await loadAudio(audioId);
      if (!record) {
        setState('error');
        return;
      }
      const objectUrl = URL.createObjectURL(record.blob);
      urlRef.current = objectUrl;
      setUrl(objectUrl);
      setState('ready');
    } catch {
      setState('error');
    }
  }

  if (state === 'ready') {
    return html`<${VoiceTransport} src=${url} durationMs=${durationMs ?? null} />`;
  }
  if (state === 'error') {
    return html`<p class="observations-audio">Voice note could not be loaded</p>`;
  }
  // The loading chip keeps its content (and so its width) so the strip does
  // not jump under the thumb; the dashed border is the pending treatment.
  const label = durationMs != null ? formatDuration(durationMs) : 'Voice note';
  return html`
    <button
      type="button"
      class="attachment-chip ${state === 'loading' ? 'attachment-chip-loading' : ''}"
      onClick=${open}
      disabled=${state === 'loading'}
      aria-busy=${state === 'loading'}
      aria-label=${durationMs != null ? `Voice note · ${label}` : 'Voice note'}
    >
      <svg viewBox="0 0 14 16" width="11" height="13" aria-hidden="true">
        <polygon points="2,1 13,8 2,15" fill="currentColor" />
      </svg>
      ${label}
    </button>
  `;
}

// One slot in the strip: a 64px thumbnail once its bytes are in, a dashed
// pending box until then, an inline failure if the record has gone. The
// pending box is what the observer watches — the fetch is deliberately not
// started at mount but when the slot comes within 200px of the viewport, so
// a session's worth of rows costs nothing to scroll past.
function SavedPhotoThumb({ photoId, url, state, alt, onVisible, onOpen }) {
  const boxRef = useRef(null);

  useEffect(() => {
    if (state !== 'pending') return undefined;
    // No IntersectionObserver (older WebKit, and any test that says so):
    // fetch at once rather than leave a box that never resolves.
    if (typeof IntersectionObserver === 'undefined') {
      onVisible(photoId);
      return undefined;
    }
    const element = boxRef.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        // Once, then stop watching: the bytes only need fetching the first
        // time the slot is seen.
        observer.disconnect();
        onVisible(photoId);
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
    // Keyed on the id and its state alone; onVisible is a fresh closure over
    // the parent's stable fetcher each render — deliberately not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoId, state]);

  if (state === 'error') {
    return html`<p class="observations-photo">Photo could not be loaded</p>`;
  }

  if (state === 'ready') {
    return html`<img class="observations-photo-thumb" src=${url} alt=${alt} onClick=${onOpen} />`;
  }

  return html`<div
    ref=${boxRef}
    class="observations-photo-thumb observations-photo-thumb-pending"
    aria-busy="true"
  />`;
}

// Every photo on a saved observation, as a strip of thumbnails. A session
// can hold dozens of ~200 KB JPEGs and an installed iOS PWA has little
// memory headroom for decoding rows nobody is looking at, so a thumb fetches
// its bytes when it scrolls into view (SavedPhotoThumb above) rather than at
// mount. The stored 1600px JPEG is the only size that exists, so one fetch
// and one object URL serve both the 64px thumbnail and the full-screen view.
//
// The URLs live in `urls` (photoId → url | 'error'), mirrored in `urlsRef`:
// a deps-keyed revoke effect registered after an async load may still be
// pending when the row unmounts, and a pending effect's cleanup never runs —
// the URL would leak. The mount cleanup reads whatever the ref holds, and
// the reconcile effect drops the URL of any id that has left photos[] (a
// retake repoints one id; a delete removes one).
//
// The full-screen view portals to document.body (design pass 4 §7c): a
// row-owned position:fixed overlay is one ancestor filter/transform away
// from laying out inside its own <li>, and night mode adds filters to this
// app for a living. State stays here — there is still no router, and the
// overlay still dies with its row.
//
// That view is a pager: it opens on the photo tapped and walks the rest with
// the arrows or a swipe. It is keyed by photo **id**, not by index — a
// parent refresh can renumber photos[] under an open view (a retake repoints
// one id, a delete removes one, an earlier photo can go), and an index would
// silently slide the surveyor onto a different photo. The reconcile effect
// below is the one place that decides where the view lands when the id it
// was holding disappears.
function SavedPhotos({ observation, gridReference, loadPhoto, onSetPhoto, onDeletePhoto }) {
  const photos = observation.photos ?? [];
  const ids = photos.map((photo) => photo.id);
  const idsKey = ids.join('|');

  const [urls, setUrls] = useState({});
  const [openId, setOpenId] = useState(null); // the photo the lightbox shows; null = closed
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(null); // null | 'retake' | 'add' | 'delete' — a write in flight
  // A row edit that failed, shown inside the view. CapturePage's shared
  // save-error line is the surface for every other write failure, but it
  // renders behind this scrim — from in here it may as well not exist, and
  // Delete is the worst of the three: the confirm just sits there.
  const [error, setError] = useState('');

  const urlsRef = useRef({});
  const pendingRef = useRef(new Set()); // fetches in flight, so a re-render can't double one
  const mountedRef = useRef(true);
  const liveIdsRef = useRef(idsKey); // what photos[] holds now, for reads in flight
  const prevIdsRef = useRef(ids); // the shape before this refresh, to place the open view
  const pendingShowLastRef = useRef(false); // an add from the view: land on what it appends
  const swipeRef = useRef(null); // where a pointer went down on the stage
  const swipedRef = useRef(false); // the gesture just ended was a swipe, not a tap

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const value of Object.values(urlsRef.current)) {
        if (value !== 'error') URL.revokeObjectURL(value);
      }
      urlsRef.current = {};
    };
  }, []);

  // photos[] changed shape: revoke what no id points at any more, and settle
  // where an open view now sits. Keyed on the joined ids so a re-render with
  // the same photos does nothing.
  //
  // Layout, not passive: on the render that delivers a retake, the open id is
  // momentarily absent from photos[], so the view has no photo to show. The
  // overlay itself does not go anywhere — it is mounted on `openId != null`,
  // never on the photo, so the portal survives the gap and the stand-in
  // covers it. Running before paint is what keeps that gap off the screen:
  // the replacement id is settled while the DOM is still uncommitted, so the
  // browser paints the new photo rather than a frame of "Loading…".
  useLayoutEffect(() => {
    liveIdsRef.current = idsKey;
    const nextIds = idsKey === '' ? [] : idsKey.split('|');
    const live = new Set(nextIds);
    const next = {};
    let dropped = false;
    for (const [id, value] of Object.entries(urlsRef.current)) {
      if (live.has(id)) {
        next[id] = value;
        continue;
      }
      if (value !== 'error') URL.revokeObjectURL(value);
      dropped = true;
    }
    if (dropped) {
      urlsRef.current = next;
      setUrls(next);
    }

    const prevIds = prevIdsRef.current;
    prevIdsRef.current = nextIds;
    // Consumed by whichever refresh arrives first: if the add failed, the
    // next change of shape is some other edit and must not jump the view.
    const showLast = pendingShowLastRef.current;
    pendingShowLastRef.current = false;

    setOpenId((current) => {
      // An add appends (addObservationPhoto spreads [...photos, entry]), so
      // the photo just taken is the last one — go and look at it. Only while
      // the view is still open: a refresh landing after the surveyor closed
      // it must not throw the photo back over the list they moved on to.
      if (showLast && current != null && nextIds.length === prevIds.length + 1) {
        return nextIds[nextIds.length - 1];
      }
      if (current == null || live.has(current)) return current;
      const wasAt = prevIds.indexOf(current);
      if (wasAt < 0 || nextIds.length === 0) return null;
      // Same length: a retake put a fresh id in the same slot — stay on it.
      // Shorter: the photo was deleted elsewhere, so take its neighbour, the
      // next one where there is one, the previous where there is not.
      return nextIds[Math.min(wasAt, nextIds.length - 1)] ?? null;
    });
  }, [idsKey]);

  function remember(photoId, value) {
    urlsRef.current = { ...urlsRef.current, [photoId]: value };
    setUrls(urlsRef.current);
  }

  // Nothing arriving late may be kept: the row can unmount, or the id can
  // leave photos[] (a retake, a delete), while a read is in flight — the
  // unmount cleanup and the reconcile effect have both already run by then,
  // so neither would ever revoke what this read is about to create.
  function stillWanted(photoId) {
    if (!mountedRef.current) return false;
    return liveIdsRef.current.split('|').includes(photoId);
  }

  async function ensure(photoId) {
    if (!loadPhoto) return;
    if (urlsRef.current[photoId] || pendingRef.current.has(photoId)) return;
    pendingRef.current.add(photoId);
    try {
      const record = await loadPhoto(photoId);
      if (!record) {
        if (stillWanted(photoId)) remember(photoId, 'error');
        return;
      }
      const objectUrl = URL.createObjectURL(record.blob);
      if (!stillWanted(photoId)) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      remember(photoId, objectUrl);
    } catch {
      if (stillWanted(photoId)) remember(photoId, 'error');
    } finally {
      pendingRef.current.delete(photoId);
    }
  }

  function close() {
    setConfirmingDelete(false);
    setError('');
    // Closing spends any add-then-show intent: a write still in flight must
    // not throw the view back open, nor drag a reopened view onto the photo
    // it appends.
    pendingShowLastRef.current = false;
    setOpenId(null);
  }

  const openIndex = openId == null ? -1 : ids.indexOf(openId);
  const shown = openIndex < 0 ? null : photos[openIndex];
  const atCap = ids.length >= MAX_PHOTOS;

  // The shown photo and the two either side of it: the next tap or swipe
  // must not wait on a read that could have happened while the surveyor was
  // looking. Only those three — pre-fetching the whole strip is the memory
  // cost the thumbs are lazy to avoid.
  useEffect(() => {
    if (openIndex < 0) return;
    ensure(ids[openIndex]);
    if (openIndex > 0) ensure(ids[openIndex - 1]);
    if (openIndex + 1 < ids.length) ensure(ids[openIndex + 1]);
    // Keyed on which photo is open and what photos[] holds; ensure is a fresh
    // closure over the parent's stable reader each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, idsKey]);

  // Paging cancels a raised delete confirm: it was raised on the photo being
  // looked at, and carrying it to the next one would delete the wrong photo.
  function show(index) {
    if (index < 0 || index >= ids.length) return;
    setConfirmingDelete(false);
    setOpenId(ids[index]);
  }

  function handleStagePointerDown(event) {
    swipeRef.current = { x: event.clientX, y: event.clientY };
  }

  // The system took the gesture — a call, the app switcher, an edge swipe.
  // Whatever lifts afterwards is not a page turn.
  function handleStagePointerCancel() {
    swipeRef.current = null;
  }

  function handleStagePointerUp(event) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // Far enough, and more across than down — a vertical drag is someone
    // scrolling or steadying themselves, not turning a page.
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;
    // A finger keeps the stage's pointer stream (implicit pointer capture),
    // but the click that follows is dispatched to the nearest common
    // ancestor of where it went down and came up — the backdrop, whenever
    // the swipe travels off the photo. Without this the page turn would be
    // followed by a dismissal. Cleared by the next pointerdown anywhere in
    // the view, so the suppression lasts one gesture and no longer.
    swipedRef.current = true;
    show(openIndex + (dx < 0 ? 1 : -1));
  }

  async function handleRetake(event) {
    const file = event.target.files?.[0];
    // Clearing the value is what lets the same file be picked twice — a
    // repeated selection otherwise fires no change event.
    event.target.value = '';
    if (!file || !onSetPhoto || !shown) return;
    setBusy('retake');
    setError('');
    try {
      await onSetPhoto(observation.id, shown.id, file);
    } catch (err) {
      // Swallowed rather than rethrown — this handler's caller is the DOM,
      // which can only turn a rejection into an unhandled one — but stated
      // in the view the surveyor is actually looking at.
      setError(err.message || 'Could not update the photo');
    } finally {
      setBusy(null);
    }
  }

  // Adding after the fact rides the same writer with a null photo id. This
  // component owns the empty slot too, so it never unmounts across the add —
  // the parent refresh delivers the new id and the strip fetches it, which
  // is what makes the new thumbnail appear without another tap (field
  // report, 2026-08-14).
  async function handleAdd(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    // Added from inside the open view: the refresh should land on the photo
    // just taken, not leave the surveyor on the one they were looking at.
    // The flag must be set before the await — the parent refreshes inside
    // its own writer, so by the time this promise settles the refresh render
    // has already been and gone.
    if (shown) pendingShowLastRef.current = true;
    setBusy('add');
    setError('');
    try {
      await onSetPhoto(observation.id, null, file);
    } catch (err) {
      // Nothing landed, so there is nothing to jump to — and the intent must
      // not outlive the attempt, or some later append would drag the view
      // onto a photo the surveyor never took. Swallowed rather than
      // rethrown: this handler's caller is the DOM, which can only turn a
      // rejection into an unhandled one. From inside the view the message
      // below is what the surveyor sees; from the empty-slot Add photo link
      // (no view to render it in) CapturePage's save-error line still is.
      pendingShowLastRef.current = false;
      setError(err.message || 'Could not update the photo');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    // No photo under the view (a refresh landed mid-edit and the reconcile
    // has not settled the replacement id yet): there is nothing to delete,
    // and guessing at one would take the wrong photo.
    if (!shown) return;
    // A gloved double-tap on the commit is one delete, not two: the second
    // tap would otherwise ask for a photo the first has already taken.
    // Keyed on 'delete' alone, not on busy at all — Delete deliberately
    // stays live while an add is being written (a photo taken and not yet
    // landed is no reason to refuse the surveyor a delete).
    if (busy === 'delete') return;
    setBusy('delete');
    setError('');
    try {
      await onDeletePhoto(observation.id, shown.id);
    } catch (err) {
      // Stay on the confirm so the surveyor can retry, and say why here —
      // the shared save-error line is behind this scrim, so a delete that
      // failed would otherwise look like a tap that did nothing at all.
      setError(err.message || 'Could not update the photo');
      return;
    } finally {
      setBusy(null);
    }
    setConfirmingDelete(false);
    // Stay in the view on the neighbour — the next photo, or the previous
    // when the last one goes — so a run of bad photos can be cleared without
    // reopening the view each time. Nothing left to look at closes it. The
    // parent refresh then drops the id from photos[] and the reconcile
    // effect revokes its URL.
    setOpenId(ids[openIndex + 1] ?? ids[openIndex - 1] ?? null);
  }

  if (ids.length === 0) {
    // 7e: a link, not a chip — the chips mean "there is something here to
    // open", and an empty slot is not that. Offered only where the parent
    // passes onSetPhoto (the open session); history renders nothing.
    if (!onSetPhoto) return null;
    return html`<label class="attachment-add-photo link">
      ${cameraGlyph} ${busy === 'add' ? 'Adding…' : 'Add photo'}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        disabled=${busy != null}
        onChange=${handleAdd}
      />
    </label>`;
  }

  if (!loadPhoto) {
    // No reader passed: state the count, since the bytes can't be shown.
    return html`<p class="observations-photo">
      ${cameraGlyph}${ids.length === 1 ? 'Photo' : `${ids.length} photos`}
    </p>`;
  }

  // One string, not three interpolations — htm drops the whitespace around a
  // line break between expressions. " · i of n" only where there is a strip
  // to be lost in: one of one says nothing. And only while the view is
  // actually on a photo — mid-retake there is no i to state, and "0 of 3"
  // would be worse than the plain caption. The caption is also the view's
  // live region (aria-live="polite", set on the element below): the stage
  // image carries alt="" because this line is what describes it, so this is
  // the only thing that can announce a page turn. Polite, not assertive —
  // paging is the surveyor's own doing.
  const caption =
    [formatTime(observation.fixAt), gridReference].filter(Boolean).join(' · ') +
    (ids.length > 1 && openIndex >= 0 ? ` · ${openIndex + 1} of ${ids.length}` : '');
  const shownUrl = shown ? urls[shown.id] : null;

  return html`
    <ul class="attachment-strip-photos ${ids.length > 1 ? 'attachment-strip-multi' : ''}">
      ${photos.map((photo, index) => {
        const value = urls[photo.id];
        const state = value === undefined ? 'pending' : value === 'error' ? 'error' : 'ready';
        return html`<li class="attachment-strip-photo" key=${photo.id}>
          <${SavedPhotoThumb}
            photoId=${photo.id}
            url=${state === 'ready' ? value : null}
            state=${state}
            alt=${
              ids.length === 1
                ? 'Photo for this observation'
                : `Photo for this observation (${index + 1} of ${ids.length})`
            }
            onVisible=${ensure}
            onOpen=${() => setOpenId(photo.id)}
          />
        </li>`;
      })}
    </ul>
    ${
      // Mounted on "a view is open", not on the photo it is showing. A retake
      // repoints the id under the view, so for one render there is no photo
      // at this index at all — gating on that would unmount the portal
      // (BodyPortal's cleanup runs synchronously in the diff) and remount it
      // through a passive effect a frame later, blinking the full-screen
      // photo out and dropping focus with it. The stage's stand-in covers
      // the gap instead, and the reconcile settles the new id before paint.
      openId != null
        ? html`<${BodyPortal}>
            <div
              class="photo-lightbox"
              role="dialog"
              aria-label="Photo"
              onPointerDown=${() => {
                // A fresh gesture: whatever the last one was, it is over.
                swipedRef.current = false;
              }}
              onClick=${(event) => {
                // Backdrop taps close; taps on the photo itself do not, so
                // a mis-hit while peering at the image can't dismiss it. A
                // swipe that ended out here is a page turn that overshot,
                // not a tap — see handleStagePointerUp.
                if (swipedRef.current) {
                  swipedRef.current = false;
                  return;
                }
                if (event.target === event.currentTarget) close();
              }}
            >
              <button
                type="button"
                class="photo-lightbox-close"
                aria-label="Close"
                onClick=${close}
              >
                <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                  <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <line x1="2" y1="2" x2="12" y2="12" />
                    <line x1="12" y1="2" x2="2" y2="12" />
                  </g>
                </svg>
              </button>
              <div
                class="photo-lightbox-stage"
                onPointerDown=${handleStagePointerDown}
                onPointerUp=${handleStagePointerUp}
                onPointerCancel=${handleStagePointerCancel}
              >
                ${
                  // The arrows live in the stage, not against the backdrop:
                  // absolute against a fixed, full-screen box they hung at
                  // the viewport's centre, which is exactly where the actions
                  // row rises to when the photo is short. Bounded by the
                  // stage they keep today's screen edges — deliberately not
                  // anchored to the image, whose aspect ratio changes shot to
                  // shot (docs/styling.md) — and can never reach Close, the
                  // caption or the actions. DOM order is the order a finger
                  // meets them; only worth showing with somewhere to go.
                  ids.length > 1
                    ? html`<button
                        type="button"
                        class="photo-lightbox-nav photo-lightbox-nav-prev"
                        aria-label="Previous photo"
                        disabled=${openIndex <= 0}
                        onClick=${() => show(openIndex - 1)}
                      >
                        <${ChevronGlyph} direction="prev" />
                      </button>`
                    : null
                }
                ${
                  // draggable="false": a long press that drifts is a swipe on
                  // a phone and an image drag on a desktop, and the drag wins
                  // the pointer stream.
                  shownUrl && shownUrl !== 'error'
                    ? html`<img
                        class="photo-lightbox-image"
                        src=${shownUrl}
                        alt=""
                        draggable="false"
                      />`
                    : html`<p
                        class="photo-lightbox-loading"
                        aria-busy=${shownUrl === 'error' ? undefined : 'true'}
                      >
                        ${shownUrl === 'error' ? 'Photo could not be loaded' : 'Loading…'}
                      </p>`
                }
                ${
                  ids.length > 1
                    ? html`<button
                        type="button"
                        class="photo-lightbox-nav photo-lightbox-nav-next"
                        aria-label="Next photo"
                        disabled=${openIndex === ids.length - 1}
                        onClick=${() => show(openIndex + 1)}
                      >
                        <${ChevronGlyph} direction="next" />
                      </button>`
                    : null
                }
              </div>
              <p class="photo-lightbox-caption" aria-live="polite">${caption}</p>
              ${
                // On the scrim, where the shared save-error line cannot be
                // seen. Above the actions so a failed Delete explains the
                // confirm that stayed put.
                error ? html`<p class="photo-lightbox-error" role="alert">${error}</p>` : null
              }
              ${
                // Retake and Delete ride only where the parent passes the
                // callbacks (the capture page's open session) — history
                // passes neither, exactly as it declines onEditNote.
                onSetPhoto && onDeletePhoto
                  ? confirmingDelete
                    ? html`<div class="photo-lightbox-actions">
                        <button
                          type="button"
                          class="photo-lightbox-delete-commit"
                          disabled=${busy === 'delete'}
                          onClick=${handleDelete}
                        >
                          Delete photo
                        </button>
                        <button
                          type="button"
                          class="photo-lightbox-link"
                          onClick=${() => setConfirmingDelete(false)}
                        >
                          Keep it
                        </button>
                      </div>`
                    : html`<div class="photo-lightbox-actions">
                          <label class="photo-lightbox-retake">
                            <span class="glyph-camera" aria-hidden="true"></span>
                            ${busy === 'retake' ? 'Retaking…' : 'Retake'}
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              disabled=${busy != null}
                              onChange=${handleRetake}
                            />
                          </label>
                          ${
                            // Another photo of the same thing, taken from where
                            // the surveyor is standing now, without going back
                            // to the strip. At the cap it stays put and goes
                            // disabled, with the cap line beside it — the
                            // compose field's treatment exactly. Withholding it
                            // would change the row's width and explain nothing.
                            html`<label
                              class="photo-lightbox-add"
                              aria-disabled=${atCap ? 'true' : undefined}
                            >
                              <span class="glyph-camera" aria-hidden="true"></span>
                              ${busy === 'add' ? 'Adding…' : 'Add'}
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                disabled=${busy != null || atCap}
                                onChange=${handleAdd}
                              />
                            </label>`
                          }
                          <button
                            type="button"
                            class="photo-lightbox-link"
                            onClick=${() => setConfirmingDelete(true)}
                          >
                            Delete
                          </button>
                        </div>
                        ${
                          // Under the row, not in it: the same "say why the
                          // control went dead" line the compose field prints,
                          // in the on-scrim muted voice.
                          atCap
                            ? html`<p class="photo-lightbox-cap">${PHOTO_CAP_MESSAGE}</p>`
                            : null
                        }`
                  : null
              }
            </div>
          <//>`
        : null
    }
  `;
}

// The editor a note opens into (the trigger lives in the attachment strip).
// A failed save stays open with its error so the surveyor can retry.
function NoteEditor({ observation, onEditNote, onClose }) {
  const [draft, setDraft] = useState(observation.note ?? '');
  const [state, setState] = useState('idle'); // idle | saving | error
  const [error, setError] = useState('');

  async function save() {
    setState('saving');
    setError('');
    try {
      await onEditNote(observation.id, draft);
      onClose();
    } catch (err) {
      setState('error');
      setError(err.message || 'Could not save the note');
    }
  }

  return html`
    <div class="observations-note-editor">
      <label class="field">
        <span class="field-label">Note</span>
        <textarea value=${draft} onInput=${(event) => setDraft(event.target.value)} />
      </label>
      <div class="observations-note-editor-actions">
        <button type="button" class="button-outline" disabled=${state === 'saving'} onClick=${save}>
          ${state === 'saving' ? 'Saving…' : 'Save note'}
        </button>
        <button type="button" class="link" onClick=${onClose}>Cancel</button>
      </div>
      ${state === 'error' ? html`<p class="panel-danger" role="alert">${error}</p>` : null}
    </div>
  `;
}

// One row: the record's data first, then a single attachment strip (design
// pass 4 §7a) — the photo thumbnails, the voice chip, and Edit note pushed
// right, on one line whose height no longer varies with how many
// attachments the row happens to carry. Editing state is row-local.
function ObservationRow({
  obs,
  gridRef,
  loadAudio,
  loadPhoto,
  onEditNote,
  onSetPhoto,
  onDeletePhoto,
}) {
  const [editingNote, setEditingNote] = useState(false);

  const poor = accuracyQuality(obs.gpsAccuracyM) === 'poor';
  // One string rather than three interpolations: htm drops the whitespace
  // around a line break between expressions, so a wrapped template loses the
  // spaces around the separators.
  const meta = [
    formatLatLon(obs.lat, obs.lon),
    formatAccuracy(obs.gpsAccuracyM),
    obs.headingDeg == null ? '—' : formatHeading(obs.headingDeg),
  ].join(' · ');
  // Its own line rather than a fourth item on the metadata run: the grid
  // reference is the part a surveyor reads out or copies into a report.
  const gridReference = gridRef?.(obs.lat, obs.lon) ?? null;
  // One string for the same htm-whitespace reason as `meta`.
  const traced =
    obs.positionSource === 'trace' && obs.geometry
      ? `Traced ${obs.geometry.type === 'Polygon' ? 'boundary' : 'path'} · ${formatDistance(
          lineLengthM(
            obs.geometry.type === 'Polygon'
              ? obs.geometry.coordinates[0]
              : obs.geometry.coordinates,
          ),
        )}`
      : null;

  // A voice note is deliberately not addable here (7e) — recording one
  // somewhere else, minutes later, describes the wrong place. The empty
  // photo slot is SavedPhotos' own business; see its Add photo link.
  const hasStrip = Boolean(
    obs.photos?.length || obs.audioId || onEditNote || (onSetPhoto && !obs.photos?.length),
  );

  return html`
    <li class="observations-row">
      <p class="observations-row-head">
        <span class="observations-time">${formatTime(obs.fixAt)}</span>
        <${ExportBadge} exported=${obs.exported} changed=${obs.changed} />
      </p>
      ${
        // Directly under the head, glyph-led: this line is the row's
        // identity — it says what the record IS.
        traced
          ? html`<p class="observations-traced">
              <${TraceGlyph}
                mode=${obs.geometry.type === 'Polygon' ? 'boundary' : 'path'}
                width="20"
                height="15"
              />
              ${traced}
            </p>`
          : null
      }
      ${gridReference ? html`<p class="observations-gridref">${gridReference}</p>` : null}
      <p class="observations-meta">${meta}</p>
      ${!editingNote && obs.note ? html`<p class="observations-note">${obs.note}</p>` : null}
      ${
        editingNote
          ? html`<${NoteEditor}
              observation=${obs}
              onEditNote=${onEditNote}
              onClose=${() => setEditingNote(false)}
            />`
          : null
      }
      ${
        hasStrip && !editingNote
          ? html`<div class="attachment-strip">
              ${
                // SavedPhotos owns the empty slot too (it renders Add photo
                // when photos[] is empty), so it never unmounts across an add
                // and the fresh thumbnail appears without another tap.
                obs.photos?.length || onSetPhoto
                  ? html`<${SavedPhotos}
                      observation=${obs}
                      gridReference=${gridReference}
                      loadPhoto=${loadPhoto}
                      onSetPhoto=${onSetPhoto}
                      onDeletePhoto=${onDeletePhoto}
                    />`
                  : null
              }
              ${
                obs.audioId
                  ? html`<${SavedVoiceNote}
                      audioId=${obs.audioId}
                      durationMs=${obs.audioDurationMs ?? null}
                      loadAudio=${loadAudio}
                    />`
                  : null
              }
              ${
                onEditNote
                  ? html`<button
                      type="button"
                      class="link observations-note-edit"
                      onClick=${() => setEditingNote(true)}
                    >
                      ${obs.note ? 'Edit note' : 'Add note'}
                    </button>`
                  : null
              }
            </div>`
          : null
      }
      ${
        // Worth surfacing per row, not just live: a fix this loose is the
        // one thing worth walking back and re-taking.
        poor ? html`<p class="observations-poor warns">Accuracy poor</p>` : null
      }
      ${
        // The accuracy shown above is a map precision for these, not a
        // satellite fix — the same number meaning two very different things.
        obs.positionSource === 'map'
          ? html`<p class="observations-picked">Marked on the map, not measured</p>`
          : null
      }
    </li>
  `;
}

// Live-updating record of what's been saved this session. The in-place
// edits — the note, and the photo's retake/delete/add (design pass 4) —
// exist only when the parent passes the callbacks; storage access stays
// injected, never imported into a presentational component. History passes
// the loaders but no mutators, which is the whole read-only rule.
export function ObservationsList({
  observations,
  gridRef,
  loadAudio,
  loadPhoto,
  onEditNote,
  onSetPhoto,
  onDeletePhoto,
}) {
  if (observations.length === 0) {
    return html`<p class="observations-empty">No observations saved yet</p>`;
  }

  return html`
    <ul class="observations-list">
      ${observations.map(
        (obs) => html`
          <${ObservationRow}
            key=${obs.id}
            obs=${obs}
            gridRef=${gridRef}
            loadAudio=${loadAudio}
            loadPhoto=${loadPhoto}
            onEditNote=${onEditNote}
            onSetPhoto=${onSetPhoto}
            onDeletePhoto=${onDeletePhoto}
          />
        `,
      )}
    </ul>
  `;
}
