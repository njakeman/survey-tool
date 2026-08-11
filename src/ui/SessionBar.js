import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

// Session lifecycle control: start a new named session, or show the open
// one with a two-tap End (a mis-tapped End would silently stop capture).
//
// The no-session branch is also the app's first-launch screen — for a new
// install it is the whole of what is on offer — so it carries the eyebrow,
// the headline and the one thing a surveyor cannot discover by looking:
// that tapping Start is what buys compass access on iOS.
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
      <div class="session-bar session-start">
        <p class="eyebrow">Field survey</p>
        <h2 class="session-start-headline">Start a session to begin capturing</h2>
        <label class="field">
          <span class="field-label">Session name</span>
          <input
            type="text"
            value=${name}
            onInput=${(event) => setName(event.target.value)}
            disabled=${busy}
          />
        </label>
        <button type="button" class="button-primary" disabled=${busy} onClick=${handleStart}>
          Start session
        </button>
        ${
          // handleStart calls enableCompass() synchronously before any await
          // precisely because of this; saying so means a denied prompt is not
          // a mystery later.
          html`<p class="session-start-note">
            Starting also asks for compass access — iOS only grants it from a tap.
          </p>`
        }
      </div>
    `;
  }

  return html`
    <div class="session-bar">
      <span class="session-live-dot" aria-hidden="true"></span>
      <span class="session-name">${session.name}</span>
      <span class="session-count">${observationCount} saved</span>
      ${
        confirmingEnd
          ? html`<button
              type="button"
              class="button-outline"
              disabled=${busy}
              onClick=${() => onEnd?.()}
            >
              Confirm end session
            </button>`
          : html`<button
              type="button"
              class="button-outline"
              disabled=${busy}
              onClick=${() => setConfirmingEnd(true)}
            >
              End session
            </button>`
      }
    </div>
  `;
}
