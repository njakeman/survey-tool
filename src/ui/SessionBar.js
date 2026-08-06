import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

// Session lifecycle control: start a new named session, or show the open
// one with a two-tap End (a mis-tapped End would silently stop capture).
export function SessionBar({
  session,
  defaultName = '',
  observationCount = 0,
  busy = false,
  onStart,
  onEnd,
}) {
  const [name, setName] = useState(defaultName);
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  if (!session) {
    function handleStart() {
      const trimmed = name.trim();
      if (!trimmed) return;
      onStart?.(trimmed);
    }

    return html`
      <div class="session-bar">
        <label>
          Session name
          <input
            type="text"
            value=${name}
            onInput=${(event) => setName(event.target.value)}
            disabled=${busy}
          />
        </label>
        <button type="button" disabled=${busy} onClick=${handleStart}>Start session</button>
      </div>
    `;
  }

  return html`
    <div class="session-bar">
      <span class="session-name">${session.name}</span>
      <span class="session-count">${observationCount} saved</span>
      ${
        confirmingEnd
          ? html`<button type="button" disabled=${busy} onClick=${() => onEnd?.()}>
              Confirm end session
            </button>`
          : html`<button type="button" disabled=${busy} onClick=${() => setConfirmingEnd(true)}>
              End session
            </button>`
      }
    </div>
  `;
}
