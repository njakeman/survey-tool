# Styling: the implemented design

The stylesheet is no longer interim. It implements the mobile design pass in `docs/design/` — open
`docs/design/mockups.dc.html` in a browser for the visual reference, and `docs/design/README.md`
for the handoff brief it came with. The colours, type scale, spacing and border treatments here
are the design's; where this document and the mockups disagree, the mockups are the intent and
this file is what was built.

Two surfaces postdate the handoff and have no mockup: the **feature layer** rows in the picker
view and the **feature sheet** under the map. Both were built from the design's existing
vocabulary — the picker row shape, the surface/rule/accent-border treatment, the eyebrow — rather
than inventing anything, so they should read as part of the same system. Nobody has checked that
on a device.

Everything lives in one file — `src/style.css`, imported once from `src/main.js`. There is no
framework, no build step for CSS, and no component-scoped styles. Markup is
[htm](https://github.com/developit/htm) tagged templates inside Preact components, so classes are
plain strings in `src/ui/*.js`.

## Constraints the design keeps

These are not preferences. Each comes from the device, the field conditions, or a bug that already
happened — and each is still binding on anything added later.

1. **Portrait iOS Safari, installed to the home screen.** No desktop layout is needed. `body`
   carries `env(safe-area-inset-*)` padding and `index.html` sets `viewport-fit=cover`; anything
   fixed or edge-anchored has to respect the insets or it lands under the notch or the home bar.
   Nothing in the built design is fixed or edge-anchored, so nothing new depends on this yet.
2. **Operable one-handed, wearing gloves.** Every interactive element has a 44px minimum
   (`--touch-target`), enforced by the global `button` rule. Several controls are deliberately
   larger: 48px for the photo label and the secondary row, 52px for Export, 56px for Save. This is
   a floor, not a starting point.
3. **Readable in direct sunlight.** Body ink is 13.4:1 on paper. Nothing goes below 12.5px
   anywhere, or below 14px in the capture flow. The readings panel and the save button are the
   largest things on screen.
4. **Fully offline, forever.** No CDN, no remote images, no external icon set. Two font families
   are vendored into `public/fonts/` and precached (see _Assets_). Every glyph in the interface —
   camera, chevron, warning triangle, tick, state squares, progress track, map hatching — is CSS
   boxes and borders, so there is nothing to download and nothing to 404 offline.
5. **ARIA attributes double as styling hooks and must not be dropped.** `aria-current="true"`
   marks the basemap region in use and is also its visual selector; `role="alert"` and `aria-live`
   regions carry error and status text; `aria-describedby` ties the save button to its blocked
   reason. Restyling must not replace them with class-only equivalents.
6. **Colour is never the only signal.** Every state carries a word and a shape as well as a hue:
   not-exported is a dashed outline against exported's solid fill, the blocked save button is dashed,
   warnings are led by a triangle, the in-use region is filled and bordered and labelled. This was
   a live defect before the design pass — see _Map markers_ below.
7. **The map is a panel, not a screen.** 300px inside a scrolling page, full-bleed to the screen
   edges, with overlay controls positioned over it. Cooperative gestures: one finger scrolls the
   page, two fingers pan the map. Overlay controls sit at `z-index` 1 (`.capture-map-controls`),
   2 (region suggestion, and the picking crosshair) and 3 (the picking confirm panel, which must
   stay tappable above the crosshair) — keep that ordering or the suggestion can be obscured.

   The handoff specified **236px** and it was built at that. Marking a distant point broke it: the
   confirm panel takes the bottom ~94px, and a crosshair centred in 236px had its target _behind_
   that panel, with nothing to aim at. 300px, with the reticle a third of the way down, leaves
   77px of clear map above and below it. This is a deliberate divergence from `docs/design/`,
   which is kept verbatim as received — it is not a mockup that has been superseded so much as a
   density the design could not have anticipated, since picking did not exist then.

   **Every control on the map lives in one flex row.** Pinned individually to left, centre and
   right, "Change map", "Mark a distant point" and "Re-centre" came to roughly 380px across a
   320px map and overlapped.

## The colour system

`:root` sets `color-scheme: light dark` and defines the full light palette. Paper, ink and accent
are literal values, which is why the sheet has a `@media (prefers-color-scheme: dark)` block — the
first in its history. That block overrides **only the literals**; everything derived from them
through `rgba()` and `color-mix(… currentColor …)` follows automatically, so there is no second
palette to maintain.

| Token              | Light                | Dark                    | Used for                                    |
| ------------------ | -------------------- | ----------------------- | ------------------------------------------- |
| `--paper`          | `#f4f0e8`            | `#16171c`               | page ground                                 |
| `--surface`        | `#fbf9f4`            | `#1e2027`               | inputs, overlay buttons, confirmation strip |
| `--ink`            | `#1e2433`            | `#ece7dd`               | body text, exported markers and badges      |
| `--accent`         | `#c2611f`            | `#e07b33`               | save fill, active region, focus ring        |
| `--accent-ink`     | `#a8511a`            | `#e07b33`               | accent as text (links, Undo), accent border |
| `--accent-deep`    | `#8a4a12`            | `#f2a05a`               | warnings, the saving state's fill           |
| `--on-accent`      | `#fff`               | `#16171c`               | a label on an accent fill                   |
| `--danger-strong`  | `#7d2208`            | —                       | error text                                  |
| `--danger-bg`      | `#fdece4`            | —                       | error panel fill                            |
| `--danger-rule`    | `#b3300b`            | —                       | error panel border                          |
| `--suggestion-bg`  | `#fdf6e3`            | —                       | region suggestion banner                    |
| `--map-backdrop`   | `#e8e4dc`            | `#23252b`               | map panel behind tiles                      |
| `--rule`           | `rgba(30,36,51,.14)` | `rgba(236,231,221,.16)` | section dividers                            |
| `--rule-faint`     | `rgba(30,36,51,.09)` | `rgba(236,231,221,.10)` | row dividers within a section               |
| `--control-rule`   | `rgba(30,36,51,.30)` | `rgba(236,231,221,.30)` | outlined control borders                    |
| `--text-secondary` | `rgba(30,36,51,.62)` | `rgba(236,231,221,.62)` | secondary metadata                          |
| `--text-muted`     | `rgba(30,36,51,.55)` | `rgba(236,231,221,.55)` | labels, hints                               |

**The alert surfaces have no dark variant on purpose.** The error panel and the region-suggestion
banner keep their light ground in both schemes, so they read as a slip of paper laid over the
interface — which is what an alert is for. `.capture-map-suggestion` therefore pins its text
colour to the light ink literal rather than the token, which would invert out from under it. This
follows the handoff, and it is the one part of the palette worth a second look on a real device at
night.

## Type

Atkinson Hyperlegible, 400 and 700, vendored locally. Stack:
`'Atkinson Hyperlegible', system-ui, sans-serif`. No italic face is loaded — the two italic uses
(the empty-observations line, hints) take the browser's synthetic oblique rather than a third
file. Every number keeps `font-variant-numeric: tabular-nums`, so digits do not jitter at 1 Hz.

| Token               | Value  | Used for                                                |
| ------------------- | ------ | ------------------------------------------------------- |
| `--type-label`      | 10px   | field labels (700 / .14em / uppercase / `--font-label`) |
| `--type-badge`      | 9.5px  | chips and badges (700 / .08em / uppercase)              |
| `--type-fine`       | 12.5px | annotations, map captions                               |
| `--type-meta`       | 13.5px | secondary metadata                                      |
| `--type-small`      | 14px   | outlined control labels                                 |
| `--type-body`       | 15px   | list rows, body copy                                    |
| `--type-control`    | 17px   | inputs, note field, row titles                          |
| `--type-title`      | 19px   | screen headings                                         |
| `--type-save`       | 20px   | the save button                                         |
| `--type-heading-xl` | 25px   | session detail title, first-launch headline             |
| `--type-readout`    | 27px   | the coordinate readout                                  |

`--font-label` is `ui-monospace`. It is the only second family in the design, it needs no
download, and it is what makes a label read as a label rather than as small body text.

## Other tokens

- Spacing: `--space-1` … `--space-4` (4 / 8 / 12 / 16px). Screen gutter is 16px.
- `--radius` (4px) — still the only radius in use.
- `--touch-target` (44px, see constraint 2).
- `--shell` (32rem) and `--shell-wide` (40rem, probe page only).

## Interaction states

- **Focus**: `:focus-visible` on every control — 2px `--accent` outline, 2px offset. Not `:focus`,
  so a gloved tap does not leave a ring behind on a touch-only device. Before the design pass
  there was no focus styling at all, which was the largest single gap for keyboard and switch
  users.
- **Press**: 92% opacity on `:active`. There is no hover to design on touch.
- **Motion**: a 120ms `ease-out` entry on the update and suggestion banners, and nothing else.
  Both sit under `@media (prefers-reduced-motion: reduce)`, which kills all transitions and
  animations. There are no box-shadows anywhere in the design; dividers are 1px rules.

## Shared primitives

Adding a fifth button treatment is usually a sign a screen is drifting from the system.

| Class             | Treatment                                                     |
| ----------------- | ------------------------------------------------------------- |
| `.button-primary` | accent fill, `--accent-ink` border, `--on-accent` label       |
| `.button-outline` | transparent, 1px `--control-rule`                             |
| `.button-surface` | `--surface` fill — for controls floating over the map         |
| `.button-inverse` | paper fill with ink label — for a control on an accent fill   |
| `.chip`           | uppercase state word: GOOD/FAIR/POOR, PENDING, SYNCED, IN USE |
| `.field-label`    | small uppercase field label                                   |
| `.warns`          | leading CSS triangle, for anything that is a problem          |
| `.panel-danger`   | the error surface                                             |
| `.glyph-camera`   | the camera, drawn in CSS                                      |

Chips and labels carry **natural case in the DOM** and are uppercased by CSS, so a screen reader
reads "good" rather than spelling out four capitals. Assert on the DOM text in tests, not on the
rendered case.

## Screens and their classes

| Surface         | Root class                                                                                                                                                                  | Notes                                                                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture page    | `.capture-page`                                                                                                                                                             | The main view. Stays mounted (hidden) when an overlay is open, so an in-progress observation survives navigation.                                                                                                                                                                             |
| Session bar     | `.session-bar` + `-live-dot`; `.session-start` + `-headline`, `-note` for first launch                                                                                      | Start form, or open-session name + count + two-tap End.                                                                                                                                                                                                                                       |
| Readings        | `.readings-panel` + `-coords`, `-accuracy`, `-heading`, `-waiting`                                                                                                          | Largest type in the app. The GOOD/FAIR/POOR chip comes from `accuracyQuality()` in `sensors/format.js`.                                                                                                                                                                                       |
| Map panel       | `.capture-map` + `-canvas`, `-placeholder`, `-caption`, `-region`, `-recentre`, `-change`, `-suggestion`, `-error`                                                          | Overlay controls are absolutely positioned within.                                                                                                                                                                                                                                            |
| Photo           | `.photo-field` + `-button`, `-preview`, `-error`, `-busy`; row is `.capture-actions`                                                                                        | The "button" is a `<label>` wrapping a visually-hidden file input. Do not flatten it.                                                                                                                                                                                                         |
| Save            | `.save-button` + `-ready`, `-blocked`, `-saving`, `-reason`; `.save-confirmation` + `-tick`, `-text`                                                                        | Five states, each with a word and a shape.                                                                                                                                                                                                                                                    |
| Observations    | `.observations-list` + `-row`, `-row-head`, `-time`, `-meta`, `-note`, `-photo`, `-poor`, `.observations-empty`                                                             | A card list. Replaced a six-column table that scrolled sideways.                                                                                                                                                                                                                              |
| Export state    | `.chip.badge-not-exported` / `.chip.badge-exported` (`src/ui/ExportBadge.js`)                                                                                               | Dashed outline versus solid fill with a tick.                                                                                                                                                                                                                                                 |
| Session history | `.session-history` + `-list`, `-row`, `-body`, `-name`, `-date`, `-chevron`, `-unsynced`, `-empty`, `-export`, `-export-message`; detail is `.session-detail-title`/`-meta` | Read-only list of past sessions.                                                                                                                                                                                                                                                              |
| Basemap picker  | `.basemap-picker` + `-list`, `-row`, `-glyph`, `-body`, `-name`, `-size`, `-progress`, `-state`, `-remove`, `-error`, `-note`, `-empty`                                     | `aria-current` marks the region in use, alongside four other signals.                                                                                                                                                                                                                         |
| Feature layers  | `.feature-layer-panel` + `-list`, `-row`, `-swatch`, `-body`, `-name`, `-meta`, `-state`                                                                                    | Second section of the picker view. `aria-pressed`, not `aria-current`: independent toggles, not one choice.                                                                                                                                                                                   |
| Feature sheet   | `.feature-sheet` + `-header`, `-heading`, `-title`, `-fields`, `-field`, `-empty`, `-record`; the strip above Save is `.linked-feature` + `-label`                          | A panel in the flow under the map, deliberately not a modal. Added after the design pass.                                                                                                                                                                                                     |
| Picking         | `.capture-map-crosshair` (CSS arms with a centre gap, `pointer-events: none`, positioned from an inline `--crosshair-y`), `.capture-map-picking` + `-readout`, `-actions`   | The crosshair belongs to the viewport, not the ground, so it is CSS rather than a map layer. `--crosshair-y` comes from `CROSSHAIR_Y_FRACTION` in `CaptureMap.js`, which is also what the adapter unprojects — do not set it in CSS alone or the mark and the saved coordinates part company. |
| Grid references | `.readings-gridref`, `.observations-gridref`; the OS notice is `.attribution`                                                                                               | Monospaced, letter-spaced, tabular: this is the line that gets read aloud a digit at a time.                                                                                                                                                                                                  |
| Map controls    | `.capture-map-controls`                                                                                                                                                     | One wrapping flex row; the buttons carry no positioning of their own.                                                                                                                                                                                                                         |
| Shared header   | `.page-header`                                                                                                                                                              | Back control + title over a rule, on both list screens.                                                                                                                                                                                                                                       |
| Update banner   | `.update-banner`                                                                                                                                                            | Rendered above every view; a waiting service worker never activates without this tap.                                                                                                                                                                                                         |
| Probe page      | `.probe` + `-row`, `-label`, `-result`, `-log`                                                                                                                              | Developer diagnostics. Tokenised but not designed — see below.                                                                                                                                                                                                                                |

## Map markers

The one place the design could not be implemented as drawn. Observation markers were `#00703c`
when synced and `#d4351c` otherwise — green and red, distinguishable by hue alone, which fails in
greyscale, fails in sunlight where saturation collapses, and fails outright for red-green colour
blindness.

They are now **filled for exported, hollow with a 2px stroke for not-exported**, built in
`src/map/overlays.js` (`observationPaint()`) so the distinction is asserted by a node test rather
than only visible on a real archive. The colours are literals keyed to the map's own light
flavour: MapLibre paints on a canvas and cannot read CSS custom properties, and the basemap style
does not follow the OS colour scheme.

The handoff specifies a **rotated square with a dashed stroke**. Neither is expressible in a
MapLibre circle layer — there is no dashed circle stroke, and a rotated square needs a symbol
layer with two bundled sprite images, which would be new binary assets to vendor and precache.
Fill-versus-hollow satisfies constraint 6 on its own, so the sprites are unbuilt. If the dash
turns out to matter at map scale over real imagery, that is the route.

## Assets

- **Atkinson Hyperlegible**, 400 and 700, Latin subset, ~34 KB total, in `public/fonts/atkinson/`
  with its `OFL.txt`. Fetched by `node scripts/fetch-fonts.mjs`; the result is committed. SIL OFL
  1.1, the same licence as the map glyphs beside it.
- **Noto Sans glyph ranges** in `public/fonts/noto-sans-regular/`, for map labels
  (`scripts/fetch-glyphs.mjs`). Unrelated to the UI font and not interchangeable with it.
- Both are covered by the `woff2`/`pbf` entries in `vite.config.js`'s precache glob. **Check the
  precache count after adding any asset** — an unprecached font is invisible on a laptop and
  missing in a field.
- No other assets. Every icon is CSS.

## What this pass did not do

Honest gaps, not oversights:

- **No install prompt.** The handoff designs one (`1k`) — a pinned card explaining Share → Add to
  Home Screen, shown when `navigator.standalone` is false, with a persisted dismissal. It was the
  pass's only new piece of state and was deliberately left out of scope. The design is there if it
  is wanted.
- **The probe page still runs at `--shell-wide`** while every other screen runs at `--shell`, so
  switching to it changes the page width. The handoff excludes it from scope, and it is developer
  diagnostics reached from a footer link.
- **The dashed marker stroke**, above.
- **Nothing here has been seen on a device.** Colour, contrast and touch comfort in sunlight are
  exactly what a passing test says nothing about. `docs/ios-manual-checklist.md` is the gate.
