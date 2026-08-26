import { html } from 'htm/preact';

// The pager arrows' chevron, shared by the saved-photo lightbox and the
// revisit framing screen. Drawn rather than typed: a glyph font is one more
// thing to precache, and "‹" renders at wildly different weights across the
// two platforms.
export function ChevronGlyph({ direction }) {
  return html`<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
    <polyline
      points=${direction === 'next' ? '2,1 8,8 2,15' : '8,1 2,8 8,15'}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>`;
}
