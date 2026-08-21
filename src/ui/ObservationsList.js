import { html } from 'htm/preact';
import {
  formatLatLon,
  formatAccuracy,
  formatHeading,
  formatTime,
  formatDistance,
  accuracyQuality,
} from '../sensors/format.js';
import { formatDuration } from './format.js';
import { lineLengthM } from '../geo/lineMetrics.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ExportBadge } from './ExportBadge.js';
import { TraceGlyph } from './traceGlyphs.js';
import { VoiceTransport } from './VoiceTransport.js';
import { BodyPortal } from './BodyPortal.js';

const cameraGlyph = html`<span class="glyph-camera" aria-hidden="true"></span>`;

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
  // same pending-effect race SavedPhoto documents below: an effect
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

// A saved photo, loaded only when the surveyor asks to see it — a session
// can hold dozens of ~200 KB JPEGs and an installed iOS PWA has little
// memory headroom for decoding rows nobody is looking at. The stored 1600px
// JPEG is the only size that exists, so one fetch and one object URL serve
// both the 64px thumbnail and the full-screen view; the URL is revoked on
// unmount, and re-fetched if a retake repoints photoId under us.
//
// The full-screen view portals to document.body (design pass 4 §7c): a
// row-owned position:fixed overlay is one ancestor filter/transform away
// from laying out inside its own <li>, and night mode adds filters to this
// app for a living. State stays here — there is still no router, and the
// overlay still dies with its row.
function SavedPhoto({ observation, gridReference, loadPhoto, onSetPhoto, onDeletePhoto }) {
  const photoId = observation.photoId;
  const [url, setUrl] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | thumb | full | error
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false); // a retake's downscale in flight

  // Revoke via a ref-read at unmount rather than a [url]-dependent effect: a
  // deps-keyed effect registered after the async load may still be pending
  // when the row unmounts, and a pending effect's cleanup never runs — the
  // URL would leak. The mount-time cleanup reads whatever the ref holds.
  const urlRef = useRef(null);
  useEffect(() => () => urlRef.current && URL.revokeObjectURL(urlRef.current), []);

  async function fetchPhoto() {
    const record = await loadPhoto(photoId);
    if (!record) {
      setState('error');
      return;
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const objectUrl = URL.createObjectURL(record.blob);
    urlRef.current = objectUrl;
    setUrl(objectUrl);
  }

  // A retake writes a new photo record and repoints photoId (fresh id by
  // design — same id would serve the stale cached URL). If the image is on
  // screen, swap it for the new bytes; the view stays open so the second
  // attempt can be judged against the first.
  const shownIdRef = useRef(null);
  useEffect(() => {
    if (state !== 'thumb' && state !== 'full') return;
    if (shownIdRef.current === photoId) return;
    shownIdRef.current = photoId;
    fetchPhoto().catch(() => setState('error'));
    // Refetch is keyed on the repointed id alone; state joins the deps only
    // to catch a load that finished between renders. fetchPhoto is a fresh
    // closure each render over the stable loadPhoto — deliberately not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoId, state]);

  async function open() {
    setState('loading');
    try {
      await fetchPhoto();
      shownIdRef.current = photoId;
      setState('thumb');
    } catch {
      setState('error');
    }
  }

  function close() {
    setConfirmingDelete(false);
    setState('thumb');
  }

  async function handleRetake(event) {
    const file = event.target.files?.[0];
    // Clearing the value is what lets the same file be picked twice — a
    // repeated selection otherwise fires no change event.
    event.target.value = '';
    if (!file || !onSetPhoto) return;
    setBusy(true);
    try {
      await onSetPhoto(observation.id, file);
    } finally {
      setBusy(false);
    }
  }

  // Adding after the fact rides the retake machinery: this component now
  // owns the empty slot too, so it never unmounts across the add — the
  // parent refresh repoints photoId and the effect above fetches it, which
  // is what makes the new thumbnail appear without another tap (field
  // report, 2026-08-14).
  async function handleAdd(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      await onSetPhoto(observation.id, file);
      setState('thumb');
    } finally {
      setBusy(false);
    }
  }

  if (!photoId) {
    // 7e: a link, not a chip — the chips mean "there is something here to
    // open", and an empty slot is not that. Offered only where the parent
    // passes onSetPhoto (the open session); history renders nothing.
    if (!onSetPhoto) return null;
    return html`<label class="attachment-add-photo link">
      ${cameraGlyph} ${busy ? 'Adding…' : 'Add photo'}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        disabled=${busy}
        onChange=${handleAdd}
      />
    </label>`;
  }

  if (!loadPhoto) {
    return html`<p class="observations-photo">${cameraGlyph}Photo</p>`;
  }

  async function handleDelete() {
    await onDeletePhoto(observation.id);
    // Nothing left to look at: the view closes and the row (parent-refreshed
    // to photoId: null) returns to offering Add photo.
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setConfirmingDelete(false);
    setState('idle');
  }

  if (state === 'error') {
    return html`<p class="observations-photo">Photo could not be loaded</p>`;
  }

  if ((state === 'thumb' || state === 'full') && !url) {
    // The fetch for a just-added (or just-repointed) photo is in flight —
    // hold the chip shape rather than a broken <img>.
    return html`<button type="button" class="attachment-chip attachment-chip-loading" disabled>
      ${cameraGlyph} Photo
    </button>`;
  }

  if (state === 'thumb' || state === 'full') {
    const caption = [formatTime(observation.fixAt), gridReference].filter(Boolean).join(' · ');
    return html`
      <img
        class="observations-photo-thumb"
        src=${url}
        alt="Photo for this observation"
        onClick=${() => setState('full')}
      />
      ${
        state === 'full'
          ? html`<${BodyPortal}>
              <div
                class="photo-lightbox"
                role="dialog"
                aria-label="Photo"
                onClick=${(event) => {
                  // Backdrop taps close; taps on the photo itself do not, so
                  // a mis-hit while peering at the image can't dismiss it.
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
                <img class="photo-lightbox-image" src=${url} alt="" />
                <p class="photo-lightbox-caption">${caption}</p>
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
                            ${busy ? 'Retaking…' : 'Retake'}
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              disabled=${busy}
                              onChange=${handleRetake}
                            />
                          </label>
                          <button
                            type="button"
                            class="photo-lightbox-link"
                            onClick=${() => setConfirmingDelete(true)}
                          >
                            Delete
                          </button>
                        </div>`
                    : null
                }
              </div>
            <//>`
          : null
      }
    `;
  }

  return html`
    <button
      type="button"
      class="attachment-chip ${state === 'loading' ? 'attachment-chip-loading' : ''}"
      onClick=${open}
      disabled=${state === 'loading'}
      aria-busy=${state === 'loading'}
    >
      ${cameraGlyph} Photo
    </button>
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
// pass 4 §7a) — the photo chip or thumbnail, the voice chip, and Edit note
// pushed right, on one line whose height no longer varies with how many
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

  // 7e: Add photo is a link, not a chip — the chips mean "there is something
  // here to open", and an empty slot is not that. Offered only where the
  // parent passes onSetPhoto (the open session); a voice note is
  // deliberately not addable here — recording one somewhere else, minutes
  // later, describes the wrong place.
  const hasStrip = Boolean(
    obs.photoId || obs.audioId || onEditNote || (onSetPhoto && !obs.photoId),
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
                // SavedPhoto owns the empty slot too (it renders Add photo
                // when photoId is null), so it never unmounts across an add
                // and the fresh thumbnail appears without another tap.
                obs.photoId || onSetPhoto
                  ? html`<${SavedPhoto}
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
