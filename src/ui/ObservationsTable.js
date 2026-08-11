import { html } from 'htm/preact';
import { formatLatLon, formatAccuracy, formatHeading, formatTime } from '../sensors/format.js';

const NOTE_PREVIEW_LENGTH = 40;

function isTruncated(note) {
  return Boolean(note) && note.length > NOTE_PREVIEW_LENGTH;
}

// Read-only, live-updating record of what's been saved this session — a
// visual indicator of accumulated observations, not a review/edit screen
// (that's Phase 6). No thumbnail fetch: a plain indicator avoids pulling
// storage access into a presentational component.
export function ObservationsTable({ observations }) {
  if (observations.length === 0) {
    return html`<p class="observations-empty">No observations saved yet</p>`;
  }

  return html`
    <div class="observations-table-scroll">
      <table class="observations-table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Position</th>
            <th scope="col">Accuracy</th>
            <th scope="col">Heading</th>
            <th scope="col">Note</th>
            <th scope="col">Photo</th>
          </tr>
        </thead>
        <tbody>
          ${observations.map(
            (obs) => html`
              <tr key=${obs.id}>
                <td>${formatTime(obs.fixAt)}</td>
                <td>${formatLatLon(obs.lat, obs.lon)}</td>
                <td>${formatAccuracy(obs.gpsAccuracyM)}</td>
                <td>${obs.headingDeg == null ? '—' : formatHeading(obs.headingDeg)}</td>
                ${
                  // A title attribute was the only way to read a long note,
                  // and touch has no hover — so the full text is always in
                  // the document, with CSS doing the truncating.
                  html`<td class=${isTruncated(obs.note) ? 'observations-note-clipped' : null}>
                    ${obs.note}
                  </td>`
                }
                <td>${obs.photoId ? html`<span aria-hidden="true">📷</span> Photo` : ''}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}
