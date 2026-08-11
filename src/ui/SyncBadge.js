import { html } from 'htm/preact';

// Pending versus synced, wherever observations are shown. Three signals, not
// one: the word itself, a solid fill against a dashed outline, and a tick.
// It has to survive greyscale, both colour schemes and red-green colour
// blindness — the map's old red/green pair survived none of them.
//
// Sync is unbuilt (Phase 5), so today everything renders Pending, which is
// accurate rather than a placeholder.
export function SyncBadge({ synced }) {
  if (synced) {
    return html`<span class="chip badge-synced"><span aria-hidden="true">✓</span> Synced</span>`;
  }
  return html`<span class="chip badge-pending">Pending</span>`;
}
