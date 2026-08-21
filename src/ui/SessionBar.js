import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { RevisitSetup } from './RevisitSetup.js';
import { loadReferenceFile } from '../import/referenceZip.js';

// Session lifecycle control: start a new named session — a blank survey or
// a revisit of a previous export — or show the open one with a two-tap End
// (a mis-tapped End would silently stop capture).
//
// The no-session branch is also the app's first-launch screen — for a new
// install it is the whole of what is on offer — so it carries the brand
// lockup, the headline and the one thing a surveyor cannot discover by
// looking: that tapping Start is what buys compass access on iOS.
export function SessionBar({
  session,
  defaultName = '',
  observationCount = 0,
  busy = false,
  position = null,
  revisitProgress = null,
  onStart,
  onEnd,
  // Injected like the sensor adapters, so tests hand in a fake; the real
  // one is a pure import-layer module the UI may reach directly.
  loadReference = loadReferenceFile,
}) {
  const [name, setName] = useState(defaultName);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [sessionType, setSessionType] = useState('survey');
  // The picked reference lives only here until Start — a force-quit during
  // the chooser costs a re-pick, exactly the in-memory-until-Save rule.
  const [loaded, setLoaded] = useState(null);
  const [loadBusy, setLoadBusy] = useState(false);
  const [loadError, setLoadError] = useState(null);

  if (!session) {
    const revisit = sessionType === 'revisit';

    function handleStart() {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (revisit && !loaded) return;
      onStart?.(trimmed, revisit ? loaded : null);
    }

    // The zip is read here, on its own tap at pick time — never inside
    // Start, whose handler must call enableCompass() synchronously before
    // any await (the iOS gesture rule, CapturePage.handleStart).
    async function handlePickFile(file) {
      setLoadBusy(true);
      setLoadError(null);
      try {
        setLoaded(await loadReference(file));
      } catch (error) {
        setLoaded(null);
        setLoadError(error.message || 'Could not load the reference export');
      } finally {
        setLoadBusy(false);
      }
    }

    const typeButton = (type, title, hint) =>
      html`<button
        type="button"
        class="session-type-choice"
        aria-pressed=${sessionType === type}
        disabled=${busy}
        onClick=${() => setSessionType(type)}
      >
        <span class="session-type-title">${title}</span>
        <span class="session-type-hint">${hint}</span>
      </button>`;

    return html`
      <div class="session-bar session-start">
        <p class="brand-lockup">
          <img class="brand-mark" src="/icons/icon.svg" alt="" width="28" height="28" />
          <span class="brand-word">field<span class="brand-word-accent">Works</span></span>
          <span class="brand-suffix">Survey</span>
        </p>
        <h2 class="session-start-headline">Start a session to begin capturing</h2>
        <div class="session-type-chooser" role="group" aria-label="Session type">
          ${typeButton('survey', 'New survey', 'Blank sheet. Observations as you find them.')}
          ${typeButton(
            'revisit',
            'Revisit a survey',
            'Load a previous export and re-photograph its stations.',
          )}
        </div>
        ${
          revisit
            ? html`<${RevisitSetup}
                loaded=${loaded}
                busy=${loadBusy}
                error=${loadError}
                position=${position}
                onPickFile=${handlePickFile}
              />`
            : null
        }
        <label class="field">
          <span class="field-label">Session name</span>
          <input
            type="text"
            value=${name}
            onInput=${(event) => setName(event.target.value)}
            disabled=${busy}
          />
        </label>
        <button
          type="button"
          class="button-primary"
          disabled=${busy || loadBusy || (revisit && !loaded)}
          onClick=${handleStart}
        >
          ${revisit ? 'Start revisit session' : 'Start session'}
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
      ${
        // The one header change a revisit makes: what this session is, and
        // how far through the stations it is. Natural case; CSS uppercases
        // the chip.
        revisitProgress
          ? html`<span class="chip session-revisit-chip">Revisit</span>
              <span class="session-revisit-progress"
                >${revisitProgress.done} of ${revisitProgress.total} stations</span
              >`
          : null
      }
      <span class="session-count">${observationCount} saved</span>
      ${
        confirmingEnd
          ? html`<button
              type="button"
              class="button-outline"
              disabled=${busy}
              onClick=${() => onEnd?.()}
            >
              ${
                // An empty session is deleted on end, not closed
                // (captureService.endSession) — the confirm tap is where the
                // surveyor learns that, before it happens.
                observationCount === 0
                  ? 'Nothing recorded — discard session'
                  : 'Confirm end session'
              }
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
