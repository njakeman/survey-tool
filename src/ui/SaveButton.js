import { html } from 'htm/preact';

// Large, single-purpose save control. Disabled while saving (double-tap
// with gloves is a real hazard) or when the caller says there's no fix / no
// open session yet — that reason is shown next to the button, not hidden.
export function SaveButton({ disabled = false, disabledReason = '', saving = false, onClick }) {
  const isDisabled = disabled || saving;

  return html`
    <div class="save-button">
      <button type="button" disabled=${isDisabled} onClick=${onClick}>
        ${saving ? 'Saving…' : 'Save observation'}
      </button>
      ${
        !saving && disabled && disabledReason
          ? html`<p class="save-button-reason">${disabledReason}</p>`
          : null
      }
    </div>
  `;
}
