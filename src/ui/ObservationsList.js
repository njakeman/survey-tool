import { html } from 'htm/preact';
import {
  formatLatLon,
  formatAccuracy,
  formatHeading,
  formatTime,
  accuracyQuality,
} from '../sensors/format.js';
import { useEffect, useState } from 'preact/hooks';
import { ExportBadge } from './ExportBadge.js';

// A saved voice note, loaded only when the surveyor asks to hear it — the
// bytes stay in IndexedDB until the tap. Native <audio controls> once
// loaded: play/pause/scrub for free, touch-sized on iOS.
function SavedVoiceNote({ audioId, loadAudio }) {
  const [url, setUrl] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | ready | error

  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);

  if (!loadAudio) return html`<p class="observations-audio">Voice note</p>`;

  async function open() {
    setState('loading');
    try {
      const record = await loadAudio(audioId);
      if (!record) {
        setState('error');
        return;
      }
      setUrl(URL.createObjectURL(record.blob));
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

// Read-only, live-updating record of what's been saved this session — a
// visual indicator of accumulated observations, not a review/edit screen
// (that's Phase 6). No thumbnail fetch: a plain indicator avoids pulling
// storage access into a presentational component.
//
// A card list rather than the six-column table this replaced. Six columns
// cannot be read one-handed, and the two values a surveyor checks straight
// after a save — the time and the accuracy — were the two the table pushed
// furthest apart. The card also has room for the whole note, which retires
// the clip-to-40-characters-and-hope-for-a-tooltip workaround: touch has no
// hover, so that text was effectively unreachable.
export function ObservationsList({ observations, gridRef, loadAudio }) {
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
        return html`
          <li key=${obs.id} class="observations-row">
            <p class="observations-row-head">
              <span class="observations-time">${formatTime(obs.fixAt)}</span>
              <${ExportBadge} exported=${obs.exported} />
            </p>
            ${gridReference ? html`<p class="observations-gridref">${gridReference}</p>` : null}
            <p class="observations-meta">${meta}</p>
            ${obs.note ? html`<p class="observations-note">${obs.note}</p>` : null}
            ${
              obs.photoId
                ? html`<p class="observations-photo">
                    <span class="glyph-camera" aria-hidden="true"></span>Photo
                  </p>`
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
