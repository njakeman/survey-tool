import { html } from 'htm/preact';

// Large, single-purpose save control. Disabled while saving (double-tap
// with gloves is a real hazard) or when the caller says there's no fix / no
// open session yet — that reason is shown next to the button, not hidden.
const REASON_ID = 'save-button-reason';

export function SaveButton({ disabled = false, disabledReason = '', saving = false, onClick }) {
  const isDisabled = disabled || saving;
  const showReason = !saving && disabled && Boolean(disabledReason);

  return html`
    <div class="save-button">
      <button
        type="button"
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
            html`<p class="save-button-reason" id=${REASON_ID}>${disabledReason}</p>`
          : null
      }
    </div>
  `;
}
