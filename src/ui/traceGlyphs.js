import { html } from 'htm/preact';

// The path/boundary distinction drawn as the thing itself: an open polyline
// for a path, an irregular five-sided polygon for a boundary — deliberately
// not a square, which would read as a drawing tool; nothing in a field is
// square. One shape pair used in the chooser and on list rows (the map draws
// the real walked geometry), in currentColor so each surface's ink applies.
// Geometry is from the design-pass mockups (2b/2d) verbatim.
export function TraceGlyph({ mode, width = 22, height = 16 }) {
  return html`<svg
    viewBox="0 0 22 16"
    width=${width}
    height=${height}
    class="trace-glyph"
    aria-hidden="true"
  >
    ${
      mode === 'boundary'
        ? html`<polygon
            points="2,6 9,1 20,4 18,14 5,13"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />`
        : html`<polyline
            points="1,13 6,4 13,10 21,2"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />`
    }
  </svg>`;
}
