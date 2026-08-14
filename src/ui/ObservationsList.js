import { html } from 'htm/preact';
import {
  formatLatLon,
  formatAccuracy,
  formatHeading,
  formatTime,
  formatDistance,
  accuracyQuality,
} from '../sensors/format.js';
import { lineLengthM } from '../geo/lineMetrics.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ExportBadge } from './ExportBadge.js';
import { TraceGlyph } from './traceGlyphs.js';

// A saved voice note, loaded only when the surveyor asks to hear it — the
// bytes stay in IndexedDB until the tap. Native <audio controls> once
// loaded: play/pause/scrub for free, touch-sized on iOS.
function SavedVoiceNote({ audioId, loadAudio }) {
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
    return html`<audio controls src=${url} class="observations-audio-player"></audio>`;
  }
  if (state === 'error') {
    return html`<p class="observations-audio">Voice note could not be loaded</p>`;
  }
  return html`
    <button
      type="button"
      class="link observations-audio"
      onClick=${open}
      disabled=${state === 'loading'}
    >
      ${state === 'loading' ? 'Loading voice note…' : '▶ Voice note'}
    </button>
  `;
}

// A saved photo, loaded only when the surveyor asks to see it — the bytes
// stay in IndexedDB until the tap, the SavedVoiceNote rule: a session can
// hold dozens of ~200 KB JPEGs and an installed iOS PWA has little memory
// headroom for decoding rows nobody is looking at. The stored 1600px JPEG is
// the only size that exists, so one fetch and one object URL serve both the
// thumbnail and the full-screen view; the URL is revoked on unmount.
function SavedPhoto({ photoId, loadPhoto }) {
  const [url, setUrl] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | thumb | full | error

  // Revoke via a ref-read at unmount rather than a [url]-dependent effect: a
  // deps-keyed effect registered after the async load may still be pending
  // when the row unmounts, and a pending effect's cleanup never runs — the
  // URL would leak. The mount-time cleanup reads whatever the ref holds.
  const urlRef = useRef(null);
  useEffect(() => () => urlRef.current && URL.revokeObjectURL(urlRef.current), []);

  if (!loadPhoto) {
    return html`<p class="observations-photo">
      <span class="glyph-camera" aria-hidden="true"></span>Photo
    </p>`;
  }

  async function open() {
    setState('loading');
    try {
      const record = await loadPhoto(photoId);
      if (!record) {
        setState('error');
        return;
      }
      const objectUrl = URL.createObjectURL(record.blob);
      urlRef.current = objectUrl;
      setUrl(objectUrl);
      setState('thumb');
    } catch {
      setState('error');
    }
  }

  if (state === 'error') {
    return html`<p class="observations-photo">Photo could not be loaded</p>`;
  }

  if (state === 'thumb' || state === 'full') {
    return html`
      <img
        class="observations-photo-thumb"
        src=${url}
        alt="Photo for this observation"
        onClick=${() => setState('full')}
      />
      ${
        // The full-screen view is plain row state, not a route — there is no
        // router (see CLAUDE.md), and the overlay dies with its row. Backdrop
        // taps close it; taps on the photo itself do not (target check), so a
        // mis-hit while peering at the image can't dismiss it.
        state === 'full'
          ? html`<div
              class="photo-lightbox"
              role="dialog"
              aria-label="Photo"
              onClick=${(event) => {
                if (event.target === event.currentTarget) setState('thumb');
              }}
            >
              <img class="photo-lightbox-image" src=${url} alt="" />
              <button
                type="button"
                class="button-inverse photo-lightbox-close"
                onClick=${() => setState('thumb')}
              >
                Close
              </button>
            </div>`
          : null
      }
    `;
  }

  return html`
    <button
      type="button"
      class="link observations-photo"
      onClick=${open}
      disabled=${state === 'loading'}
    >
      <span class="glyph-camera" aria-hidden="true"></span>
      ${state === 'loading' ? 'Loading photo…' : 'Show photo'}
    </button>
  `;
}

// The note on a saved row, editable in place when the parent offers
// onEditNote (the capture page, for the open session — history never passes
// it, which is what keeps that view read-only). Row-local state like
// SavedVoiceNote: the editor's draft belongs to this row alone, and a
// failed save stays open with its error so the surveyor can retry.
function EditableNote({ observation, onEditNote }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState('idle'); // idle | saving | error
  const [error, setError] = useState('');

  if (!editing) {
    return html`
      ${observation.note ? html`<p class="observations-note">${observation.note}</p>` : null}
      <button
        type="button"
        class="link observations-note-edit"
        onClick=${() => {
          setDraft(observation.note ?? '');
          setState('idle');
          setError('');
          setEditing(true);
        }}
      >
        ${observation.note ? 'Edit note' : 'Add note'}
      </button>
    `;
  }

  async function save() {
    setState('saving');
    setError('');
    try {
      await onEditNote(observation.id, draft);
      setEditing(false);
      setState('idle');
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
        <button type="button" class="link" onClick=${() => setEditing(false)}>Cancel</button>
      </div>
      ${state === 'error' ? html`<p class="panel-danger" role="alert">${error}</p>` : null}
    </div>
  `;
}

// Live-updating record of what's been saved this session — a visual
// indicator of accumulated observations, not a review screen (that's Phase
// 6); the in-place edits are the note and the photo view, above, and only
// when the parent offers the loader — storage access stays injected, never
// imported into a presentational component.
//
// A card list rather than the six-column table this replaced. Six columns
// cannot be read one-handed, and the two values a surveyor checks straight
// after a save — the time and the accuracy — were the two the table pushed
// furthest apart. The card also has room for the whole note, which retires
// the clip-to-40-characters-and-hope-for-a-tooltip workaround: touch has no
// hover, so that text was effectively unreachable.
export function ObservationsList({ observations, gridRef, loadAudio, loadPhoto, onEditNote }) {
  if (observations.length === 0) {
    return html`<p class="observations-empty">No observations saved yet</p>`;
  }

  return html`
    <ul class="observations-list">
      ${observations.map((obs) => {
        const poor = accuracyQuality(obs.gpsAccuracyM) === 'poor';
        // One string rather than three interpolations: htm drops the
        // whitespace around a line break between expressions, so a wrapped
        // template loses the spaces around the separators.
        const meta = [
          formatLatLon(obs.lat, obs.lon),
          formatAccuracy(obs.gpsAccuracyM),
          obs.headingDeg == null ? '—' : formatHeading(obs.headingDeg),
        ].join(' · ');
        // Its own line rather than a fourth item on the metadata run: the
        // grid reference is the part a surveyor reads out or copies into a
        // report, and it should not need picking out of a list.
        const gridReference = gridRef?.(obs.lat, obs.lon) ?? null;
        // One string for the same htm-whitespace reason as `meta`. The
        // lat/lon above is a representative point; the record is the walked
        // line — say so, with how much of it there is.
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
        return html`
          <li key=${obs.id} class="observations-row">
            <p class="observations-row-head">
              <span class="observations-time">${formatTime(obs.fixAt)}</span>
              <${ExportBadge} exported=${obs.exported} />
            </p>
            ${
              // Directly under the head, glyph-led: this line is the row's
              // identity — it says what the record IS, and everything below
              // it describes that thing. The caveat and warning lines keep
              // their place at the bottom.
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
            ${
              onEditNote
                ? html`<${EditableNote} observation=${obs} onEditNote=${onEditNote} />`
                : obs.note
                  ? html`<p class="observations-note">${obs.note}</p>`
                  : null
            }
            ${
              obs.photoId
                ? html`<${SavedPhoto} photoId=${obs.photoId} loadPhoto=${loadPhoto} />`
                : null
            }
            ${
              obs.audioId
                ? html`<${SavedVoiceNote} audioId=${obs.audioId} loadAudio=${loadAudio} />`
                : null
            }
            ${
              // Worth surfacing per row, not just live: a fix this loose is
              // the one thing worth walking back and re-taking.
              poor ? html`<p class="observations-poor warns">Accuracy poor</p>` : null
            }
            ${
              // The accuracy shown above is a map precision for these, not a
              // satellite fix. Saying so on the card is the difference
              // between "±12 m, measured" and "±12 m, eyeballed from 300 m
              // away" — the same number meaning two very different things.
              obs.positionSource === 'map'
                ? html`<p class="observations-picked">Marked on the map, not measured</p>`
                : null
            }
          </li>
        `;
      })}
    </ul>
  `;
}
