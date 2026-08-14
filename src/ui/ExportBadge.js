import { html } from 'htm/preact';

// Exported versus not, wherever observations are shown — the answer to "is
// this safely off the device". Three signals, not one: the word itself, a
// solid fill against a dashed outline, and a tick. It has to survive
// greyscale, both colour schemes and red-green colour blindness — the map's
// old red/green pair survived none of them.
//
// This replaced SyncBadge when GitHub sync was dropped (2026-08-11) in
// favour of export + import: the state a surveyor actually needs before
// walking away is whether the data has left the phone, and an export is now
// the only way it does.
// `changed` (design pass 4): the record was edited after the export that
// carried it — the copy that left the device is stale. It outranks
// `exported`, because "exported" would be a lie about the bytes on someone's
// laptop; the dashed (pending) shape says work remains, and the word says
// which kind.
export function ExportBadge({ exported, changed = false }) {
  if (changed) {
    return html`<span class="chip badge-not-exported">Changed since export</span>`;
  }
  if (exported) {
    return html`<span class="chip badge-exported"
      ><span aria-hidden="true">✓</span> Exported</span
    >`;
  }
  return html`<span class="chip badge-not-exported">Not exported</span>`;
}
