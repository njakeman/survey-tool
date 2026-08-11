# Styling: current state and design handoff

The stylesheet is **interim**. It was written to make the app legible and operable, not to look
like anything in particular, and every colour in it is a placeholder. This document is for
whoever does the real design pass: what exists, what it must keep doing, and where to change
things.

Everything lives in one file — `src/style.css`, ~380 lines, imported once from `src/main.js`.
There is no framework, no build step for CSS, and no component-scoped styles. Markup is
[htm](https://github.com/developit/htm) tagged templates inside Preact components, so classes are
plain strings in `src/ui/*.js`.

## Constraints the design must keep

These are not preferences. Each one comes from the device, the field conditions, or a bug that
already happened.

1. **Portrait iOS Safari, installed to the home screen.** No desktop layout is needed. `body`
   carries `env(safe-area-inset-*)` padding and `index.html` sets `viewport-fit=cover`; anything
   fixed or edge-anchored has to respect the insets or it lands under the notch or the home bar.
2. **Operable one-handed, wearing gloves.** Every interactive element has a 44px minimum
   (`--touch-target`). This is a floor, not a starting point. A design that shrinks controls to
   look tidier makes the app unusable for its one purpose.
3. **Readable in direct sunlight.** Favour high contrast and larger type over subtlety. The
   readings panel and the save button are deliberately the largest things on screen.
4. **Fully offline, forever.** No webfonts, no CDN, no remote images, no external icon set. A
   strict offline requirement plus a service-worker precache means any asset must be local and
   listed in the build. `system-ui` is the font for this reason.
5. **ARIA attributes double as styling hooks and must not be dropped.** `aria-current="true"`
   marks the basemap region in use and is also its visual selector; `role="alert"` and
   `aria-live` regions carry error and status text. Restyling must not replace them with
   class-only equivalents.
6. **Colour must never be the only signal.** Pending versus synced observations, and the active
   region, all need a non-colour cue as well (text, weight, icon). The map's pending/synced
   markers are currently red/green only — that is a known defect, and the right place to fix it
   is the design pass.
7. **The map is a panel, not a screen.** `40vh` inside a scrolling page, with overlay controls
   positioned over it. It uses cooperative gestures: one finger scrolls the page, two fingers pan
   the map. Overlay controls sit at `z-index` 1 (re-centre, change map) and 2 (region
   suggestion) — keep that ordering or the suggestion can be obscured.

## How the colour system currently works

Worth understanding before replacing it, because it buys dark mode almost for free.

`:root` sets `color-scheme: light dark`, so the browser supplies text and control colours for the
OS setting. Most of the palette is then derived from `currentColor` via `color-mix()` — dividers,
muted text, faint surfaces — which means those adapt automatically and there is no second palette
to maintain. There are **no media queries at all** in the sheet, including no
`prefers-color-scheme` block, and none are needed for that part.

The exceptions are three literal values that do **not** adapt, and they are the first thing worth
revisiting:

| Token             | Value     | Used for                                                    |
| ----------------- | --------- | ----------------------------------------------------------- |
| `--danger-strong` | `#b00`    | map and picker error text                                   |
| `--accent`        | `#2b2620` | active-region border; matches `theme-color` in `index.html` |
| `--map-backdrop`  | `#e8e4dc` | the map panel behind tiles                                  |

The suggestion banner also hardcodes a light-mode cream/tan pair inline in its rule.

## Tokens

Defined on `:root` at the top of `src/style.css`. A retheme should mostly mean editing these
rather than hunting values through the sheet.

- Spacing: `--space-1` … `--space-4` (0.25 / 0.5 / 0.75 / 1rem)
- `--radius` (0.25rem — the only radius in use)
- `--touch-target` (2.75rem = 44px, see constraint 2)
- `--shell` (32rem) and `--shell-wide` (40rem, probe page only)
- Colour: `--rule`, `--rule-faint`, `--surface-faint`, `--text-muted`, `--text-secondary`,
  `--warning`, `--danger`, `--danger-strong`, `--accent`, `--map-backdrop`

Not yet tokenised, and reasonable candidates: the type scale (0.75 / 0.85 / 0.9 / 1 / 1.05 / 1.1 /
1.25rem, all literal) and font weight (only `600` and default are used).

## What is not styled at all

Deliberate gaps, not oversights — nobody has designed them yet:

- **No focus styling.** There are no `:focus`, `:focus-visible`, `:hover` or `:active` rules
  anywhere; focus rings are whatever the browser draws. On a touch-only target this has been
  survivable, but it is the largest single gap for keyboard and switch users.
- **No transitions, animations or shadows.** Nothing moves. If the design introduces motion,
  add a `prefers-reduced-motion` guard at the same time.
- **No visually-hidden utility.** The pattern exists once, inline, on the photo input. If more
  screen-reader-only text is added, extract it to a class.
- **No print styles**, and none needed.

## Screens and their classes

| Surface         | Root class                                                                                  | Notes                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Capture page    | `.capture-page`                                                                             | The main view. Stays mounted (hidden) when an overlay is open, so an in-progress observation survives navigation. |
| Session bar     | `.session-bar`                                                                              | Start form, or open-session name + count + two-tap End.                                                           |
| Readings        | `.readings-panel`                                                                           | Largest type in the app. `tabular-nums` so digits don't jitter at 1 Hz.                                           |
| Map panel       | `.capture-map` + `-canvas`, `-placeholder`, `-recentre`, `-change`, `-suggestion`, `-error` | Overlay controls are absolutely positioned within.                                                                |
| Photo           | `.photo-field` + `-button`, `-preview`, `-error`                                            | The "button" is a `<label>` wrapping a visually-hidden file input.                                                |
| Save            | `.save-button` + `-reason`                                                                  | Deliberately taller than the 44px floor (3.5rem).                                                                 |
| Observations    | `.observations-table` + `-scroll`, `.observations-empty`                                    | Scrolls horizontally rather than overflowing portrait.                                                            |
| Session history | `.session-history` + `-list`, `-name`, `-date`, `-count`, `-empty`, `-export-message`       | Read-only list of past sessions.                                                                                  |
| Basemap picker  | `.basemap-picker` + `-list`, `-name`, `-size`, `-state`, `-error`, `-note`, `-empty`        | `aria-current` marks the region in use.                                                                           |
| Update banner   | `.update-banner`                                                                            | Rendered above every view; a waiting service worker never activates without this tap.                             |
| Probe page      | `.probe` + `-row`, `-label`, `-result`, `-log`                                              | Developer diagnostics, reached from a footer link. Lower priority for design.                                     |

## Things a redesign will want to decide

Listed because they are real questions the current sheet dodges rather than answers:

- Focus states (see above) — the biggest gap.
- A non-colour cue for pending versus synced (constraint 6).
- Whether the observations table stays a horizontally-scrolling table on a phone, or becomes a
  card list. It currently scrolls, which works but is not pleasant.
- The footer links (`.link`) are buttons drawn as links; they keep a full-height hit area while
  the visible ink is small. Worth confirming that reads as intended.
- The suggestion banner overlays the top of the map and can cover the imagery; it is dismissible
  but sits over content.
- The probe page runs at `--shell-wide` while everything else is `--shell`, so switching to it
  changes the page width.
