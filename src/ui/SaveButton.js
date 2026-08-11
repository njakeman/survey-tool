import { html } from 'htm/preact';

// Large, single-purpose save control. Disabled while saving (double-tap
// with gloves is a real hazard) or when the caller says there's no fix / no
// open session yet — that reason is shown next to the button, not hidden.
const REASON_ID = 'save-button-reason';

export function SaveButton({ disabled = false, disabledReason = '', saving = false, onClick }) {
  const isDisabled = disabled || saving;
  const showReason = !saving && disabled && Boolean(disabledReason);
  // Blocked is dashed and grey, ready is the accent fill, saving is visibly
  // darker — a shape or a weight change in every case, never hue alone, so a
  // second tap during a save is obviously a no-op.
  const state = saving ? 'saving' : disabled ? 'blocked' : 'ready';

  return html`
    <div class="save-button">
      <button
        type="button"
        class=${`save-button-${state}`}
        disabled=${isDisabled}
        aria-describedby=${showReason ? REASON_ID : undefined}
        onClick=${onClick}
      >
        ${saving ? 'Saving…' : 'Save observation'}
      </button>
      ${
        showReason
          ? // Tied to the button rather than left as a loose sibling: a
            // disabled control is unfocusable, so an unassociated reason is
            // never reached.
            html`<p class="save-button-reason warns" id=${REASON_ID}>${disabledReason}</p>`
          : null
      }
    </div>
  `;
}
