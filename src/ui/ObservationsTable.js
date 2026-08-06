import { html } from 'htm/preact';
import { formatLatLon, formatAccuracy, formatHeading, formatTime } from '../sensors/format.js';

const NOTE_PREVIEW_LENGTH = 40;

function truncateNote(note) {
  if (!note) return '';
  if (note.length <= NOTE_PREVIEW_LENGTH) return note;
  return `${note.slice(0, NOTE_PREVIEW_LENGTH)}…`;
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
            <th>Time</th>
            <th>Position</th>
            <th>Accuracy</th>
            <th>Heading</th>
            <th>Note</th>
            <th>Photo</th>
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
                <td title=${obs.note || undefined}>${truncateNote(obs.note)}</td>
                <td>${obs.photoId ? '📷' : ''}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}
