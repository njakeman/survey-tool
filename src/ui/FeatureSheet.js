import { html } from 'htm/preact';

// What a tapped map feature says about itself, and the offer to record an
// observation against it.
//
// A panel below the map, not a modal. A dialog would trap focus, block the
// page from scrolling, and — the reason that matters here — put a
// dismiss-on-outside-tap layer over a map the surveyor is still reading. The
// sheet sits in the flow, the map stays live behind it, and the attributes
// stay visible while the note is being typed.
//
// role="status" because it appears from a tap on a canvas: there is no
// focusable element to land on and nothing else would tell a screen-reader
// user that anything happened.

export function FeatureSheet({ feature, canRecord, onRecord, onDismiss }) {
  if (!feature) return null;

  return html`
    <section class="feature-sheet" role="status">
      <div class="feature-sheet-header">
        <div class="feature-sheet-heading">
          <p class="eyebrow">${feature.layerName}</p>
          <h2 class="feature-sheet-title">${feature.title}</h2>
        </div>
        <button type="button" class="button-outline" onClick=${onDismiss}>Close</button>
      </div>

      ${
        feature.fields.length === 0
          ? html`<p class="feature-sheet-empty">No attributes recorded on this feature</p>`
          : html`<dl class="feature-sheet-fields">
              ${feature.fields.map(
                (field) => html`
                  <div key=${field.key} class="feature-sheet-field">
                    <dt>${field.key}</dt>
                    <dd>${field.value}</dd>
                  </div>
                `,
              )}
            </dl>`
      }
      ${
        // Withheld rather than disabled when there is no open session or no
        // fix: a control that cannot work is worse than no control, because
        // the surveyor taps it and nothing happens. The attributes are still
        // worth reading, so the sheet itself stays.
        canRecord
          ? html`<button
              type="button"
              class="button-primary feature-sheet-record"
              onClick=${() => onRecord(feature)}
            >
              Record here
            </button>`
          : null
      }
    </section>
  `;
}
