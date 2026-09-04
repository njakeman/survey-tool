# Styling: the implemented design

The stylesheet is no longer interim, and this file is the design record: the palette, type
scale, spacing, border treatments and every component's intent, in the order they were designed.
Two passes produced it — the original mobile design pass, then a second covering the trace
surfaces, **night mode**, the **locator marker** and the **app icon** (see _The second design
pass_ below, including the one deliberate deviation).

Two surfaces were built between the passes from the existing vocabulary alone — the **feature
layer** rows in the picker view and the **feature sheet** under the map — using the picker row
shape, the surface/rule/accent-border treatment and the eyebrow rather than inventing anything,
so they should read as part of the same system. Nobody has checked that on a device.

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
   edges, with overlay controls positioned over it. Standard gestures: one finger pans the map,
   pinch zooms it, and the page scrolls from outside the panel (cooperative gestures were tried
   and dropped — two-finger pan was unusable gloved, and the stray second touch pinch-zoomed the
   interface; the viewport meta now pins `maximum-scale=1` so the interface can never zoom).
   Overlay controls sit at `z-index` 1 (`.capture-map-controls`),
   2 (region suggestion, and the picking crosshair) and 3 (the picking confirm panel, which must
   stay tappable above the crosshair) — keep that ordering or the suggestion can be obscured.

   The design specified **236px** and it was built at that. Marking a distant point broke it: the
   confirm panel takes the bottom ~94px, and a crosshair centred in 236px had its target _behind_
   that panel, with nothing to aim at. 300px, with the reticle a third of the way down, leaves
   77px of clear map above and below it. A deliberate divergence — a density the original design
   could not have anticipated, since picking did not exist then.

   **Every control on the map lives in one flex row.** Pinned individually to left, centre and
   right, "Change map", "Mark a distant point" and "Re-centre" came to roughly 380px across a
   320px map and overlapped. The row now sits inside `.capture-map-foot`, the bottom-anchored
   column that also holds the station readout when the map is maximised.

   **Amended 2026-09-04: a panel by default, the screen on one tap.** Field use asked for a
   bigger map to navigate to a station by, switchable without disturbing the survey. "Expand
   map" (`.capture-map-expand`, top-right, its own corner rather than a fourth button in the
   row) sets `data-maximised="true"` on the **same** `.capture-map` node, which goes
   `position: fixed; inset: 0` at `z-index` 5 — above the picking confirm panel (3), below the
   lightbox tier (10) so the framing screen and the photo view still win — and the map is
   resized in place. Never a portal: the map is built once per region against its container
   ref, and re-parenting would destroy it mid-survey; a state attribute on the existing node
   leaves the GPS watch, a recording trace, the sticky station and the composed observation
   untouched by construction. The way back is visible text, "Close map", legible in sun through
   gloves. Two results collapse the map on their own because they land on the page beneath it: a
   feature tap (its sheet) and a confirmed "Use this point" (it arms Save). Only the maximised
   state pads its overlays by the safe-area insets; the scroll offset is stashed on the way in
   and restored on the way out, since taking 300px out of flow lets the browser clamp it. The
   history map keeps the 300px footprint — it has nothing to navigate to. See "The maximised
   map" below.

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
is deliberate, and it is the one part of the palette worth a second look on a real device at
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

| Surface         | Root class                                                                                                                                                                                                                                                                               | Notes                                                                                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture page    | `.capture-page`                                                                                                                                                                                                                                                                          | The main view. Stays mounted (hidden) when an overlay is open, so an in-progress observation survives navigation.                                                                                                                                                                             |
| Session bar     | `.session-bar` + `-live-dot`; `.session-start` + `-headline`, `-note` for first launch; `.brand-lockup` + `-mark`, `-word`, `-word-accent`, `-suffix`                                                                                                                                    | Start form, or open-session name + count + two-tap End. The brand lockup heads the start form only — gone once a session opens.                                                                                                                                                               |
| Readings        | `.readings-panel` + `-coords`, `-accuracy`, `-heading`, `-waiting`                                                                                                                                                                                                                       | Largest type in the app. The GOOD/FAIR/POOR chip comes from `accuracyQuality()` in `sensors/format.js`.                                                                                                                                                                                       |
| Map panel       | `.capture-map` + `-canvas`, `-placeholder`, `-caption`, `-region`, `-recentre`, `-change`, `-suggestion`, `-error`                                                                                                                                                                       | Overlay controls are absolutely positioned within.                                                                                                                                                                                                                                            |
| Photo           | `.photo-field` + `-button`, `-preview`, `-error`, `-busy`; row is `.capture-actions`                                                                                                                                                                                                     | The "button" is a `<label>` wrapping a visually-hidden file input. Do not flatten it.                                                                                                                                                                                                         |
| Save            | `.save-button` + `-ready`, `-blocked`, `-saving`, `-reason`; `.save-confirmation` + `-tick`, `-text`                                                                                                                                                                                     | Five states, each with a word and a shape.                                                                                                                                                                                                                                                    |
| Observations    | `.observations-list` + `-row`, `-row-head`, `-time`, `-meta`, `-note`, `-note-edit`, `-note-editor` (+ `-actions`), `-photo`, `-poor`, `.observations-empty`                                                                                                                             | A card list. Replaced a six-column table that scrolled sideways. The note edits in place on the capture page only (see below).                                                                                                                                                                |
| Export state    | `.chip.badge-not-exported` / `.chip.badge-exported` (`src/ui/ExportBadge.js`)                                                                                                                                                                                                            | Dashed outline versus solid fill with a tick.                                                                                                                                                                                                                                                 |
| Session history | `.session-history` + `-list`, `-row`, `-body`, `-name`, `-date`, `-chevron`, `-unsynced`, `-empty`, `-export`, `-export-message`, `-load`, `-load-hint`, `-delete` (+ `-confirm`, `-commit`, `-warning`, `-message`), `-purge` (+ `-message`); detail is `.session-detail-title`/`-meta` | Past sessions, read-only in place; Load session hands one back to capture, Delete/purge remove them (see below).                                                                                                                                                                              |
| Basemap picker  | `.basemap-picker` + `-list`, `-row`, `-glyph`, `-body`, `-name`, `-size`, `-progress`, `-state`, `-remove`, `-error`, `-note`, `-empty`                                                                                                                                                  | `aria-current` marks the region in use, alongside four other signals.                                                                                                                                                                                                                         |
| Feature layers  | `.feature-layer-panel` + `-list`, `-row`, `-swatch`, `-body`, `-name`, `-meta`, `-state`                                                                                                                                                                                                 | Second section of the picker view. `aria-pressed`, not `aria-current`: independent toggles, not one choice.                                                                                                                                                                                   |
| Feature sheet   | `.feature-sheet` + `-header`, `-heading`, `-title`, `-fields`, `-field`, `-empty`, `-record`; the strip above Save is `.linked-feature` + `-label`                                                                                                                                       | A panel in the flow under the map, deliberately not a modal. Added after the design pass.                                                                                                                                                                                                     |
| Picking         | `.capture-map-crosshair` (CSS arms with a centre gap, `pointer-events: none`, positioned from an inline `--crosshair-y`), `.capture-map-picking` + `-readout`, `-actions`                                                                                                                | The crosshair belongs to the viewport, not the ground, so it is CSS rather than a map layer. `--crosshair-y` comes from `CROSSHAIR_Y_FRACTION` in `CaptureMap.js`, which is also what the adapter unprojects — do not set it in CSS alone or the mark and the saved coordinates part company. |
| Grid references | `.readings-gridref`, `.observations-gridref`; the OS notice is `.attribution`                                                                                                                                                                                                            | Monospaced, letter-spaced, tabular: this is the line that gets read aloud a digit at a time.                                                                                                                                                                                                  |
| Map controls    | `.capture-map-foot` > `.capture-map-controls`; `.capture-map-expand`; `.capture-map-walk` + `-label`                                                                                                                                                                                     | One wrapping flex row inside the bottom-anchored foot; the buttons carry no positioning of their own. Expand/Close map is the top-right corner. The walk readout (`StationWalk`) appears in the foot only while maximised.                                                                    |
| Shared header   | `.page-header`                                                                                                                                                                                                                                                                           | Back control + title over a rule, on both list screens.                                                                                                                                                                                                                                       |
| Update banner   | `.update-banner`                                                                                                                                                                                                                                                                         | Rendered above every view; a waiting service worker never activates without this tap.                                                                                                                                                                                                         |
| Probe page      | `.probe` + `-row`, `-label`, `-result`, `-log`                                                                                                                                                                                                                                           | Developer diagnostics. Tokenised but not designed — see below.                                                                                                                                                                                                                                |

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

The design drew a **rotated square with a dashed stroke**. Neither is expressible in a
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
- One exception: the landing header's brand lockup (below) points `<img>` at `public/icons/icon.svg`
  — the app icon, not a redraw of it — rather than the CSS every other icon is. It's already covered
  by the `svg` entry in `vite.config.js`'s precache glob (it ships for the manifest regardless), so
  this adds no new precache weight.

## What this pass did not do

Honest gaps, not oversights:

- **No install prompt.** The design pass drew one — a pinned card explaining Share → Add to
  Home Screen, shown when `navigator.standalone` is false, with a persisted dismissal. It was the
  pass's only new piece of state and was deliberately left out of scope.
- **The probe page still runs at `--shell-wide`** while every other screen runs at `--shell`, so
  switching to it changes the page width. Excluded from the design's scope, and it is developer
  diagnostics reached from a footer link.
- **The dashed marker stroke**, above.
- **Nothing here has been seen on a device.** Colour, contrast and touch comfort in sunlight are
  exactly what a passing test says nothing about. `docs/ios-manual-checklist.md` is the gate.

## The second design pass (2026-08-12)

The second pass redesigned the trace surfaces and added night mode, the locator and the icon.
All of it is implemented; the notes below are what the stylesheet now encodes and what is
binding on later changes.

- **The one-accent rule.** At most one accent-filled button per surface, and it is always the
  action that moves the record toward being saved: Finish on a live trace strip, Resume on the
  recovery panel, Save everywhere else. **One deliberate deviation from the design text**: point
  capture (and photo/voice) stays live mid-trace — the settled capture-continues decision — so in
  the recording-with-a-good-fix state Finish and Save are both accent, each moving its own record.
  Every other state matches the design exactly.
- **The trace strip** is three stacked lines: status run (`--text-secondary`, elapsed pushed
  right), the walked total at `--type-save`/700 (waiting-for-a-fix borrows the same slot so the
  strip never changes height), then Finish (accent, 15px) / Pause / Discard. The discard confirm
  _replaces_ the action row — nothing may reflow mid-interaction at 320px — and `Discard trace`
  (`.trace-discard-commit`) wears the red treatment, which has exactly **two** instances in the
  app (the other is Delete permanently, `.session-history-delete-commit` — one grouped CSS
  rule): always the commit step of a two-step destruction, never a first tap. Paused drops the
  left border to 45% accent and freezes the dot at 0.4.
- **Two pulse tempi.** `voice-note-pulse` stays 1.2s (seconds-long recording, wants urgency);
  `.trace-strip-dot` breathes at 2.4s between 1 and 0.55 (tens of minutes, must not tire the
  peripheral vision). Paused's frozen 0.4 sits below the breathe's floor deliberately.
- **The suggestion ground now has three tenants**: the region suggestion, the trace chooser and
  the recovery panel — all moments where the app asks an unprompted question. They keep a light
  ground in light _and_ dark (the alert-surface rule, hence light-scheme literals for their ink),
  and all three go dark-with-accent-border in night mode, where a slip of white paper is exactly
  what must not happen.
- **The trace glyphs** (`src/ui/traceGlyphs.js`): an open polyline for a path, an irregular
  pentagon for a boundary — never a square. One drawing, used in the chooser and on list rows in
  `currentColor`. `.observations-traced` is the row's _identity_ line (bold ink, glyph-led,
  directly under the head); `.observations-picked` stays the caveat and `.observations-poor` the
  warning.
- **Trace-line casings** (`src/map/overlays.js`): 5px solid pale under every trace line, flipped
  near-black in night via the adapter's `setNightMode`. Solid under the dashed lines
  deliberately. Casing-directly-beneath-line is asserted in the browser tier; don't reorder.
  **One exception (2026-08-24): the inferred layers' casings are dotted in step with their
  lines** — a solid casing under a dotted line would read as a solid line with dots on top,
  erasing the very distinction the dots carry. Dasharray units are line-width multiples, so the
  casing's values are the line's scaled by the width ratio; asserted in the node tier.
- **Inferred trace segments draw dotted** (2026-08-24, from the design handoff's background-gap
  decision). The stretch of a walk the app did not measure — the platform suspended the page, a
  deliberate Pause, a force-quit recovered later — draws as fine dots (`[0.4, 1.6]` at width 3)
  in the same ink and width as the rest of the line, on both the saved shapes and the live
  accent walk. The handoff said "dashed"; **dash was already taken** (dashed = not exported at
  line scale, and the live walk is a dashed accent), so the grammar is now three-valued and
  survives greyscale: solid = exported, dashed = unexported, dotted = inferred. One dotted layer
  serves both export states — export-ness stays readable from the rest of the line and the
  marker fill. On return from the background the capture page shows a one-line
  `role="status"` notice (`.trace-gap-notice`, the skip-notice component): "Trace paused — the
  app was in the background. That stretch is drawn dotted." — dismissible, once per gap, never
  for a deliberate Pause. A screen **wake lock** (`src/sensors/wakeLock.js`) holds while a trace
  actually records, so the commonest cause of the gap — the screen auto-locking — mostly stops
  happening; it is an optimisation, never a requirement, and every refusal is swallowed.
- **Night mode** is a third mode, not a darker dark: `<html data-mode="night">`
  (`src/app/displayMode.js`, persisted in settings, Auto|Night switch in the capture footer)
  drives a one-hue token block, the map's grayscale+red-multiply filter, and the theme-color
  metas together. Hue is gone at night, so the whole signal budget is luminance and shape — the
  reason constraint 6 exists. The iOS status bar's white clock is the OS's own; the Red Filter
  shortcut is the field-notes answer.
- **The locator** (`src/map/locator.js` + the adapter's DOM marker) replaced the position-dot
  circle layer. Station mark: ring, four cardinal ticks, accent fix, every stroke on a 6px
  half-opacity casing. The beam's width _is_ the compass's uncertainty (60°→120°, fading);
  no compass means no beam at all; stale goes hollow-and-dashed at 55%. Colours ride
  `--locator-stroke`/`--locator-casing`, defined per mode. The accuracy ring stays the
  `position-accuracy` circle layer. No N label while the map never rotates.
- **The icon** (variant I, "the station, sighting") is the locator at rest, beam due north —
  `public/icons/` holds the SVG masters and every PNG the manifest needs, including the
  maskable variant; `index.html` points `apple-touch-icon` at the 180px cut. All precached.

## Additions after the second pass (2026-08-12)

- **Map attribution starts collapsed** to MapLibre's compact ⓘ toggle (the adapter collapses it
  after load — MapLibre opens it itself). The credit is one tap away, never covering ground.
- **Online basemap rows** carry a per-region description line ("imagery streamed over the
  network" / "streetmap streamed over the network") in the picker's existing `-size` slot; the
  online state text and dotted glyph are unchanged.
- **Load session** (`.session-history-load`) sits under Export in the history detail view as an
  outline button — Export keeps the detail view's one accent; continuing a past session is the
  rarer act. When a session is already open the button is disabled and
  `.session-history-load-hint` says why ("End the current session first…") instead of leaving a
  mute control. Failures land on the `panel-danger` surface.
- **Editing a note in place**: every row of the open session's list carries a quiet
  `.link`-styled Edit note / Add note affordance (`--type-meta` — every row has one, and a row of
  buttons would out-shout the observations). The open editor reuses the capture form's
  `.field`/`.field-label` + bare textarea pattern so amending a note looks like writing one;
  Save note is `.button-outline` (Save observation keeps the page accent), Cancel a `.link`,
  errors `panel-danger`. History never renders the affordance.
- **Deleting a session** sits last in the detail stack (Export accent → Load outline → a quiet
  Delete link): the confirm _replaces_ the trigger (the TraceStrip rule — nothing reflows
  mid-interaction), red commit left, "Keep session" escape pushed right under the finger that
  just tapped. An unexported count precedes the commit as a `.warns` line — warn, never block.
  This is the red treatment's second (and only other) instance; see the second-pass notes.
  **Delete exported sessions** on the list is a full-width outline in the Import slot, shown
  only when eligible, two-step via a label swap that names the count.

## Additions with photo viewing and the history map (2026-08-14)

- **Viewing a saved photo** (`src/ui/ObservationsList.js` `SavedPhoto`): the row's photo line
  becomes a quiet `.link`-styled "Show photo" trigger (`button.observations-photo`, the Edit-note
  rule — a read never competes with Save for the surface's accent). The bytes stay in IndexedDB
  until the tap (the SavedVoiceNote rule; memory, not politeness), then one fetch and one object
  URL serve both the inline `.observations-photo-thumb` (≤180px tall) and the full-screen view.
  The chip trigger and the ≤180px block are both gone — superseded first by the fourth pass's
  64px strip thumbnail, then by _Multiple photos_ (2026-08-25), below.
- **The photo lightbox** (`.photo-lightbox`): fixed near-black scrim in every mode, the photo
  `object-fit: contain`, one full-width `.button-inverse` Close (≥44px) — no accent fill on the
  overlay, and the existing night rule already turns `.button-inverse` into an accent hairline.
  Backdrop taps close it; taps on the photo don't (a mis-hit while peering must not dismiss).
  It is row state, not a route — there is no router, and it dies with its row. The full-width
  Close was replaced by the fourth pass's 44px ✕; the pager (nav buttons, multi-photo caption)
  is _Multiple photos_ (2026-08-25), below.
- **Photos at night are dimmed, not red-shifted** (`brightness(0.55)` on thumb and lightbox
  image): the map's grayscale+red multiply would make a photograph useless, but full brightness
  at 2am would reset the dark adaptation the mode exists to protect. Dim, don't recolour.
- **Accepted limitation:** the viewport meta pins `maximum-scale=1`, so the lightbox photo
  cannot be pinch-zoomed. The full-screen view is the zoom.
- **The history map** (`src/ui/HistoryMap.js`, `.history-map`): a past session's observations on
  a read-only map in the history detail, the capture panel's exact footprint (300px, full-bleed)
  so the two maps read as the same instrument — but stripped: no controls, no follow, no locator
  or accuracy ring, no feature layers (capture-time aids; here they would imply an interactivity
  the page refuses). Opens fitted to the session's data (trace vertices included) at
  construction, single-point sessions at survey zoom. Filled-vs-hollow markers and
  solid-vs-dashed trace lines carry the exported distinction unchanged. Rendered only when a
  region is active and the session has observations — no placeholder, because history offers no
  route to getting a basemap. Night mode's grayscale+red-multiply covers both map canvases via
  shared selectors; no accent is added to the detail surface (Export keeps it).

## Additions with the region-switch and empty-session fixes (2026-08-14)

- **A region switch keeps the view.** CaptureMap stashes the outgoing map's centre/zoom in the
  build effect's cleanup and the replacement opens there (`view` option through `createMap`;
  the adapter applies it at construction, `fit` outranks it). Offline archives still clamp an
  out-of-coverage view to their edge via the existing `minZoom`/`maxBounds`. Before this, every
  switch relocated the map to the incoming region's default — all four online regions share the
  GB centroid, which put the surveyor in the North Pennines.
- **Ending an empty session discards it** (user decision): the confirm tap re-labels to
  "Nothing recorded — discard session" — same outline button, same two-tap shape, the one-accent
  rule untouched. The wording is the warning; nothing else changes visually.
- **Export disabled at zero, with the reason beside it**: `button.capture-page-export` and the
  history detail's Export disable when the session has no observations, each with a muted
  centred hint (`.capture-page-export-hint`, `.session-history-export-hint` — one grouped rule
  with `.session-history-load-hint`, whose pattern this is). A mute disabled control is a
  question; the hint is the answer.

## The third design pass (2026-08-14): gating, the recorder, Path/Boundary, the display row

Design handoff pass 3, implemented with three decisions taken at the time: all five sections;
the voice recorder's **fallback** flavour (native player kept); Photo and Voice note stay
**live** while a trace records.

- **The capture block gates on the session** (§5a/5b). Without one, everything that writes into
  a session is _absent, not disabled_ — note field, Photo/Voice pair, trace pair, Save, the
  observations list, and their strips. One `--text-secondary` line under the map
  (`.capture-no-session-note`) explains the lot; the readings and map stay, because GPS works
  without a session and watching the fix settle is the reason to stand still. The shipped
  first-launch session bar (name input + Start) stays at the page top — pass 3's
  "controls under the map" sketch was not adopted over it.
- **The compose row is two-up** (`.capture-actions`): Photo (`Take Photo` → **Photo**) and
  Voice note side by side, both on `--surface` (`.photo-field-button` gained the surface
  ground); the voice field wraps to a full-width row of its own while recording or holding a
  recording (`:has()` on `.voice-note-recording`/`.voice-note-player`).
- **The voice note is a recorder, fallback flavour** (§5c): idle is a `--surface` control with
  a 14×19 inline-SVG mic glyph and the label **Voice note**; recording is a purpose-drawn 56px
  transport row (`.voice-note-recording` — 1px `--accent` border, 3px accent left edge, the
  existing pulsing dot, elapsed at 16px/700 `--font-label` tabular, **Stop** accent-filled with
  a filled-square glyph). Stop holds the accent only while recording — the one-accent rule.
  Playback keeps the native `<audio controls>`; delete is a 44px ✕ in `--danger-strong` with
  `aria-label="Delete voice note"`. The full custom transport (level bars, owned play/pause)
  was deliberately not built.
- **Path and Boundary replace Trace + chooser** (§5d): two stacked 56px `--surface` rows under
  a `TRACE A LINE ALONG THE GROUND` field label (`.trace-pair-option`), each the TraceGlyph +
  name 16px/700 + caption (`Open line, A to B` / `Closes back to the start`) at `--type-fine`
  — the handoff's 11.5px would break its own 12.5px floor, so the token won. While one
  records, the strip renders **in its slot** and the other stands down
  (`.trace-pair-standing-down`, 1px dashed at 42% ink, disabled) rather than disappearing —
  the pair never reflows under a thumb. `.trace-chooser*` and its night overrides are gone,
  and with them the sheet's hard-coded light literals.
- **Session history is a standing button** (§5e, no-session state only — with a session
  running it is a detour and is absent, per the handoff; the footer slot is the documented
  fallback if the field complains). `.session-history-button`: list glyph, 15.5px/700 label,
  right-aligned session count (`N sessions`, tabular), an unsent badge reusing
  `chip badge-not-exported` (dashed — the pending treatment) with the aggregate
  `countUnexported` across sessions, and the capture screen's only chevron. `Device probe`
  keeps its footer link.
- **The display switch is one exclusive row of four** (§6): `Auto · Light · Dark · Night`,
  `role="radiogroup"`/`aria-checked` under a `DISPLAY` field label. Selection is ink ground
  plus 700 weight, never colour alone; the focus ring goes inset (`outline-offset: -4px`) —
  a segmented row has no gap to spend. Auto alone captions itself with the resolved scheme
  ("Following the system — dark"; the handoff's "since 05:41" was dropped — the OS switch
  time is unknowable before launch). `data-mode` now takes `light`/`dark`/`night`;
  **the dark token block exists twice** — the `prefers-color-scheme` copy guarded with
  `:root:not([data-mode='light'])` and a verbatim `:root[data-mode='dark']` copy — and the
  two must stay in lockstep (commented at the block). Forced positions pin both `theme-color`
  metas to one colour (the night precedent); Auto restores the per-scheme pair. The map's
  night boolean stays derived (`displayMode === 'night'`).

## The fourth design pass (2026-08-14): the saved row, the transport, the photo view

Design handoff turn 7 plus 5c in full, from field screenshots. Three decisions taken with the
user at the time: a photo change on a saved observation marks the record **Changed since
export** (a third badge state, not a silent flip and not a lie); the recording bars are a
**predictable repeating animation, deliberately not live levels** — visibly a rhythm, not a
meter (no AnalyserNode, no stored peaks); and `audio_duration_ms` rides in the export on every
observation, `?? null`.

- **`box-sizing: border-box`, globally** (§7d). The sheet had none, so every `width: 100%`
  control with side padding overflowed its track — the Photo button's 34px overhang on device
  was exactly that, with `.session-history-button` (26px), `.basemap-picker-row` (24px) and
  `.voice-note-recording` (22px) quietly doing the same. One declaration at the top of the
  sheet, not per-component patches, so it cannot recur.
- **Landscape works rather than being refused** (§7d): iOS cannot lock orientation in an
  installed PWA, so `@media (orientation: landscape) and (max-height: 500px)` caps
  `.capture-map` at 180px and the readings, note and Save stay on the fold. The manifest's
  `orientation: portrait` was already present; `screen.orientation.lock()` was skipped — it
  benefits only Android, which already honours the manifest's portrait lock without it. (When
  this was written Android was not yet a target; it is now — 2026-08-17 — and the conclusion
  holds for the opposite reason.)
- **The attachment strip** (§7a): a saved row's three stacked orange links became one line —
  the photo as a 44px `--surface` chip (`.attachment-chip`), the voice note as a chip reading
  its stored duration (`0:12`) or `Voice note` for legacy records, and **Edit note staying a
  link pushed right** (it changes the record; the chips read it). Loading keeps the chip's own
  content so the strip's width never jumps; the dashed border is the pending treatment. A
  loaded photo chip becomes the **64px square thumbnail** (`object-fit: cover`) — the 180px
  block is gone; a saved list is an index. The single chip is superseded by the scroll-snap
  strip of _Multiple photos_ (2026-08-25), below, though the 64px thumbnail shape carries
  forward unchanged.
- **The voice transport** (`src/ui/VoiceTransport.js`, 5c states 3/4 + §7b): one component for
  the compose field (with the ✕) and the saved rows (without — deleting a saved voice note is
  a different act and is not offered). 44px play/pause, sixteen **fixed-pattern** bars whose
  darkening left-to-right is the playback position, elapsed bold / total regular in
  `--font-label` tabular. Delete is **withheld mid-playback** with a 44px spacer holding the
  row's width. No scrubber — the drawing has none. The recording state
  (`.voice-note-recording`) gains the same sixteen bars animated on a loop
  (`.voice-note-bars`, per-bar `animation-delay`, stilled by the reduced-motion guard) beside
  the dot, a `role="timer"` elapsed, and the accent Stop.
- **The photo view** (§7c): rendered through a **body portal** (`BodyPortal` in
  `ObservationsList.js` — hand-rolled with Preact's own `render`; `preact/compat`'s
  `createPortal` was tried and rejected, because importing compat re-aliases `onChange`
  app-wide as a side effect and broke every file input). The scrim is this app's near-black
  (`rgba(13,14,17,.94)`), Close is a **44px ✕ top-right** inside the safe-area inset (the
  full-width paper bar read as an iOS action sheet and outshone the photograph), the image
  takes the remaining box in `dvh` minus insets, and one caption line — time · grid reference
  — says which record is on screen. Backdrop-tap-to-close and night's `brightness(0.55)`
  stay. The containing-block bug the handoff inferred was **not found in the code** (no
  ancestor carries a filter/transform); the portal makes the question moot. The body portal,
  the 44px ✕, backdrop-tap-to-close and the night dimming all carry forward unchanged; the
  caption and the single-photo assumption are superseded by the pager in _Multiple photos_
  (2026-08-25), below.
- **Retake · Delete · Add photo** (§7e): in the full view only, and only where the parent
  passes `onSetPhoto`/`onDeletePhoto` — history passes neither, the same
  absence-is-the-flag rule as `onEditNote`. Retake is an outlined-on-dark label wrapping a
  `capture="environment"` input (the camera opens directly; the retaken file runs the same
  1600px downscale, and the view stays open to judge the second attempt). Delete is a quiet
  link pushed away from Retake; its confirm **replaces the action row** (the trace-discard
  shape) with the commit in `--danger-on-dark` (#ff8a66) — the danger pair's one
  light-on-dark value, used nowhere off the scrim — and `Keep it` under the finger.
  Deleting closes the view; the emptied slot offers **Add photo** as a link, not a chip
  ("an empty slot is not something to open"). A voice note is deliberately not addable after
  the fact — recorded somewhere else, minutes later, it describes the wrong place. Retake,
  Delete and the danger-on-dark commit all carry forward; deleting the _last_ photo still
  closes the view exactly as described, but deleting one of several no longer does — see
  _Multiple photos_ (2026-08-25), below, for what changed once there was a strip to land back
  on.
- **CHANGED SINCE EXPORT** — the badge's third state. A photo retake/delete/add or a note
  edit stamps `changedAt` on the observation and `changedSinceExportAt` on its session
  (one transaction, `storage/photoWrite.js` / `updateObservationNote`); the badge compares
  them against `lastExportedAt`. The dashed (pending) chip shape with the words doing the
  telling — never colour alone. A changed session refuses to purge as "fully exported" and
  drops out of the history page's fully-exported count; a completed re-export resolves the
  state by moving `lastExportedAt` past the stamp — nothing is ever cleared.

## Field fixes 2 (2026-08-14): the second round of device reports

Six reports against the deployed pass-4 build, three of them defects in it.

- **`box-sizing` postscript — the history map had no width.** `.session-history` is
  `align-items: flex-start`, and `.history-map` was the one child that never opted out of
  fit-content: it rendered as a zero-width, 300px-tall backdrop band — the reported
  "unnecessary whitespace" between the session name and the observations was the invisible
  map. `align-self: stretch` fixes it; the detail page now actually shows the read-only map.
- **The history pages' header sticks** (`.session-history .page-header`): paper ground,
  full-bleed across the shell padding, the negative-top-margin trick so scrolled content can't
  peek above it, `z-index: 2` (above the map, far below the lightbox's 10). BasemapPicker
  keeps the flow header — its list is short.
- **Add photo lands on the thumbnail, not a chip.** `SavedPhoto` now owns the empty slot
  (renders the Add photo link itself), so it never unmounts across an add — the parent
  refresh repoints `photoId` and the same effect that serves a retake fetches the new bytes.
  While a fetch is in flight the chip shape holds (`attachment-chip-loading`) rather than a
  broken `<img>`. Both file inputs clear their `value` (same file twice must still fire), and
  the add path gets the retake's busy treatment ("Adding…"). `SavedPhoto` (singular) is now
  `SavedPhotos` (the strip); the never-unmounts-across-an-add property is the one this
  paragraph exists to state, and it still holds — see _Multiple photos_ (2026-08-25), below.
- **Changed since export earns its highlight.** The predicate now requires the observation to
  have been _in_ the export (`isChangedSinceExport` includes `isExported` — a post-export save
  that gets edited is honestly still Not exported). The badge takes its own register:
  `badge-changed`, dashed (pending family) in `--accent-deep` warning ink instead of the muted
  secondary — an edit flags the row, it doesn't fade it. Map markers and trace lines follow:
  filled/solid only while `exported && !changed` (`SAFELY_EXPORTED` in `overlays.js`) — an
  edited-since-export marker goes hollow again, its trace dashed. The aggregates now agree
  with the purge predicate: the Session-history button shows a `Changed since export` chip
  when everything is "sent" but stale, the history page adds "N sessions changed since
  export" to its summary, and the capture footer hints "Changed since the last export —
  export again" under Export while the open session is stale.
- **The purge names its count on the first tap** ("Delete N exported sessions") — housekeeping
  wording was hiding a bulk delete. And `main.js` now requests
  **`navigator.storage.persist()`** at startup (fire-and-forget; the probe page's storage row
  reports whether it stuck): storage eviction was the one way sessions could vanish without a
  deliberate tap, and it reads in the field as "the update deleted my data".
- **The observations list is orderable** in a live session: an `OBSERVATIONS` field with a
  two-cell segmented row (the display row's shape), Oldest first · Newest first, withheld
  until there are two rows. A persisted preference (`observationOrder` in settings, the
  displayMode chain); the flip is a plain reverse of the store's chronological order — never
  a recordedAt sort, whose same-second ties the monotonic ULID order already resolves.
  History detail deliberately keeps chronological order.

## Touch hardening for Android (2026-08-17)

Three constructs Android needs that iOS never surfaced the absence of. Each is a considered
addition, not a drive-by — every one is iOS-visible to some degree.

- **`overscroll-behavior-y: contain`** on `html, body`, scoped to `@media (display-mode:
browser)`. Android Chrome has pull-to-refresh on a downward drag at document scroll top; iOS
  standalone never has. A stray drag on non-canvas chrome could reload the app and lose an
  in-progress note/photo, which live in memory until Save. Scoped to browser-tab mode only —
  pull-to-refresh doesn't exist in the installed app on either platform, so both platforms'
  installed apps, the actual target, keep their rubber-band bounce untouched.
- **`-webkit-tap-highlight-color: transparent`** on `html`. Android paints a highlight rectangle
  on tap that squares off every rounded control; press feedback is already the `:active { opacity:
0.92 }` above. This removes iOS's faint grey tap flash too — it makes iOS match this record more
  closely, not less.
- **`user-select: none`** on `button`, `label.photo-field-button`, `label.attachment-add-photo`,
  `label.photo-lightbox-retake`. Long-press on Android starts text selection on whatever it lands
  on; iOS suppresses most of this already. Deliberately **not** applied to `.readings-coords` /
  `.readings-gridref` — copying a grid reference off the screen is plausibly useful in the field,
  and a blanket rule would remove it.

Not fixed: `index.html`'s `maximum-scale=1, user-scalable=no` is ignored by Android Chrome, so the
stray-second-finger pinch it was added for can return there. `touch-action: manipulation` above
does the cross-browser work; blocking pinch outright would need `touch-action: pan-x pan-y` on
`html`, which risks the map. Left as a device-checklist observation rather than coded around.

No test covers CSS here — verification is the mobile-chrome e2e project and an eyes-on iOS pass
(press feedback, scroll/bounce feel, readout selectability) before merge.

## The landing header's brand lockup (2026-08-17)

From the Claude Design mock's first-launch screen (option `1k` of the _Field Survey — mobile
design pass_ project): the plain `.eyebrow` reading "Field survey" on the no-session screen is
replaced with a lockup — the app icon, the `fieldWorks` wordmark (accent on "Works"), and a
tracked-out `SURVEY` suffix (`.brand-lockup` + `-mark`, `-word`, `-word-accent`, `-suffix` in
`src/ui/SessionBar.js`'s no-session branch only; `.eyebrow` itself is untouched — `FeatureSheet.js`
still uses it).

Two numbers were changed from the mock rather than copied literally:

- `SURVEY` renders at `--type-label` (10px), not the mock's 11px — 11px has no token anywhere
  else in the app, and at `.16em` tracking in mono the difference isn't perceptible.
- The mark's `5px` corner radius is a literal, not `--radius` (4px) — an app-tile corner rather
  than a control corner, kept as a named exception rather than silently growing the radius table.

The mark is an `<img>` pointing at `public/icons/icon.svg` (see Assets, above) rather than a CSS
redraw — the one deliberate exception, so the header can't drift from the actual home-screen tile.
Its fixed ink/paper/accent colours don't follow the palette tokens, so night mode dims it to 72%
opacity rather than letting it become the brightest thing above the fold; dark mode needed nothing.

## Revisit mode (design pass t8, 2026-08-21)

A revisit session is a session _type_, chosen at start; the only screen that changes is the one
that composes an observation. New surfaces, all riding existing tokens — the pass added **no new
colour tokens** (nothing to keep in lockstep across the two dark blocks):

- **Session-type chooser** (`.session-type-chooser`/`-choice`, SessionBar's no-session branch):
  two 64px choice cards, title + one-line hint. Selected is a 2px accent border with a check
  appended to the title (`::after`) — weight and shape, never colour alone; padding drops 1px as
  the border grows so nothing reflows on selection. `aria-pressed` is the styling hook.
- **Reference block** (`.revisit-setup*`): filename in `--font-label` with a `Read only` chip;
  the two file pickers are labels wearing `.button-outline` (labels miss the global button
  min-height, so `.revisit-setup-pick` restates 44px — the PhotoField discipline). Nearest
  stations reuse the list-row shape (distance bold in a fixed column · name · compass point).
- **Station list** (`.station-list*`, the 8d vocabulary): every state is a shape **plus** a chip
  word. Glyphs are CSS boxes (9px rotated squares; no-access is two crossed bars, pseudo-element
  ×). Chips ride `.chip` with variants mapped onto the exported-badge registers: done fills like
  `badge-exported`, to-do/skipped stay dashed like `badge-not-exported`, current takes the accent
  border. Rows are wrapped in a button only when tappable (the Change chooser); Review renders
  them static.
- **Station block** (`.station-block*`, revised 2026-08-24 per the design's superseding `8b`):
  the arrow + distance are the whole walking instruction, and **the arrow rotates live** —
  screen-relative to the device heading (compass reading first, course-over-ground from
  consecutive fixes behind it, `sensors/course.js`), through the locator beam's own cumulative
  unwrap (`accumulateRotation`, `map/locator.js`) so the 200ms transform transition turns 2°
  across the 359→1 wrap, never the long way round. With **no** heading source the arrow stands
  at true bearing and the caption drops its ` · live` suffix — deliberately the opposite
  degradation from the locator beam (the beam's _width is_ the compass's uncertainty, so no
  compass = no beam; the arrow is an _instruction_, and an instruction must never vanish — it
  falls back to a labelled bearing instead). Sizes map to tokens by the block's own ×0.83
  mock-to-token factor (the brand-lockup precedent): mock 58px arrow → 3rem, mock 38px distance
  → `--type-guidance` (32px, a new token used only here), mock 19px cardinal → `--type-control`.
  The **no-access confirm replaces the action rows in place** (the house idiom) and its
  commit is **accent, not danger**: it records a claim about the world — moves a record toward
  saved — and destroys nothing; the danger register stays at exactly its two destructive
  confirms.
- **Plan diagram — dropped** (2026-08-24). The 86px orientation schematic beside the arrow was
  superseded by the design's own revision: static, and it duplicated the map panel directly
  above it. Module, tests and `.plan-diagram*` CSS deleted. Don't rebuild it.
- **Map**: station diamonds are runtime-rasterised symbol images (overlays.js — filled ink done,
  hollow to-do, accent + ring current; skipped/no-access draw hollow like to-do, the words live
  in the list), pale-cased like the trace lines, inserted above traces and below
  `position-accuracy`. The `◆ Stations · N` pill (`.capture-map-stations`) stacks under the
  region pill top-left — the mock put it bottom-left, but the bottom edge belongs to the control
  row.
- **Framing screen** (`.framing-screen*`): the photo lightbox's skeleton — fixed, z-index 10,
  near-black scrim in every mode, 44px back control inside the safe-area insets, dvh-capped
  image. With the native camera (no live view, no overlay — settled decision), the reference
  photo takes the whole middle: that _is_ the "at size" the step exists for. The shutter is a
  label wearing `.button-primary` at 64px — the one control the step exists for. The line
  "Close enough is your call. The app measures, it does not gate." is load-bearing copy.
  Since 2026-08-26 the screen pages through a station's reference photos — "Framing pages"
  under Multiple photos below.
- **Pairing strip**: the linked-feature strip verbatim ("Revisiting: West stile" · "Record
  something new instead") — same placement above Save, same reversibility rule.
- **End summary** (`.session-revisit-summary`, shown with the End confirm): segmented bar where
  the segments carry shape as well as colour — filled done, hatched no-access
  (repeating-gradient), dashed remaining.
- **History**: revisit rows wear a `Revisit` chip; the detail adds one `--text-secondary` line
  naming the referenced survey from the session record, so it survives the reference bytes being
  evicted.

Skip confirms **after** the fact (a dismissible status line with Undo); no-access confirms
before. Both per the design's reasoning: skip is cheap and reversible, no-access lands in the
export.

## Multiple photos (2026-08-25)

An observation carries up to `MAX_PHOTOS` (10) photos instead of one. Three surfaces change —
the compose strip, the saved strip, the lightbox — and none of them invent new tokens or a new
accent use; every new control reuses the disc/link/outline vocabulary already in the sheet.

- **The compose strip** (`.photo-field-strip`): thumbs wrap onto their own lines under the
  Photo button rather than scrolling — composing is a handful of shots at most, never the ten
  a saved row can carry, so there is no case here worth a scroller. Each 64px thumb
  (`.photo-field-thumb`) carries its own remove control: a 44px hit area laid over the thumb
  (`top: -8px; right: -8px`, so the touch target doesn't eat most of a 64px photo) but the
  visible mark is a 22px `--surface` disc so it doesn't blot out the shot it removes. The ✕
  itself is drawn, not an icon file or an inline SVG — two 11px `linear-gradient` bars crossed
  at 45°/-45° on the disc's `::after`, `currentColor` so it inks correctly in both modes. It is
  the same "every glyph is CSS" rule as `.glyph-camera`, extended to a case the original pass
  never needed: a glyph with a hit area bigger than the mark itself. Once a strip exists, the
  photo field takes the compose row's full width (`.capture-actions
.photo-field:has(.photo-field-strip)`) rather than fighting the voice field for half of it —
  the same move the loaded voice transport already makes.
- **The cap line** (`.photo-field-cap`, `PHOTO_CAP_MESSAGE`: "10 photos — the most one record
  holds", built from `MAX_PHOTOS` in `src/ui/format.js`) appears only
  at the cap, left-aligned under the button rather than centred like the export/load hints
  (the field stacks in a column; it isn't a row of its own). The button itself goes dashed and
  muted at the cap (`.photo-field-button-capped`, the save-button-blocked shape) so the field
  explains itself before the line underneath is even read, rather than presenting a plain
  disabled control with no reason attached.
- **The saved strip** (`.attachment-strip-photos`): a horizontally-scrolling, scroll-snapped
  row of 64px thumbs — no chrome, no scrollbar (`scrollbar-width: none` plus the WebKit
  pseudo-element, since `scrollbar-width` alone doesn't touch WebKit's bar), `scroll-snap-type:
x mandatory` so a swipe settles on a whole thumb rather than half of the next one. The chip
  is gone entirely: where the fourth pass put one loaded photo straight onto the row as a 64px
  thumbnail, several photos now render the same way, just scrollable. More than one photo
  takes the row's own full-width line (`.attachment-strip-photos.attachment-strip-multi`) —
  the same "a strip worth having gets the whole width" move the loaded voice transport and the
  compose strip both make. That selector is **compound, not descendant**: `-multi` and
  `-photos` land on the same `<ul>` (`ObservationsList.js` sets `class="attachment-strip-photos
${n > 1 ? 'attachment-strip-multi' : ''}"` on one element), so a descendant rule
  (`.attachment-strip-multi .attachment-strip-photos`) would never match anything — this shipped
  wrong once, in Task 8, and was caught in coordinator review before merge. Each thumb is
  **viewport-lazy**: it renders a dashed, `--surface-faint` placeholder
  (`.observations-photo-thumb-pending`) until an `IntersectionObserver` says it is within 200px
  of the viewport, then fetches its bytes once and disconnects. An installed iOS PWA has little
  memory headroom for decoding rows nobody is scrolled to, and a session can hold dozens of
  photos across its rows — fetching everything at mount was never affordable, and a strip of
  several photos on one row makes the saving larger, not smaller.
- **The lightbox pager**: Previous/Next (`.photo-lightbox-nav`, `-prev`/`-next`) live inside
  `.photo-lightbox-stage` and are absolute against it — **not** against the image, and no
  longer against the fixed backdrop. Not the image, because the stage centres a photo whose
  aspect ratio varies shot to shot: anchoring there would walk the arrows around the screen as
  the surveyor pages. Not the backdrop either, though that is where they started: `top: 50%`
  against a full-screen fixed box is the _viewport's_ centre, which is exactly where the
  actions row rises to when the photo is short — the arrows landed on Retake and Delete. The
  stage is now `position: relative` and takes the column's spare height (`flex: 1 1 auto` with
  `min-height: 0`, centring its image), so arrows absolute against it keep the same screen
  edges (`left`/`right: var(--space-2)`, `top: 50%` / `translateY(-50%)`) while being bounded
  by the photo's own band — they can never reach Close, the caption or the actions. Being
  inside the
  stage puts them in its pointer stream, which is harmless: `swipeRef` is set on `pointerdown`
  and a tap travels nowhere, so a nav tap stays a tap and the button's click pages as normal.
  They wear Close's translucent-disc treatment (`rgba(0,0,0,.45)` fill, a hairline
  border) rather than a new one, and `:disabled { opacity: .3 }` marks the ends — Previous dead
  at photo 1, Next dead at the last — rather than hiding the control and having the row of
  controls change width. The caption changed from a bare "time · grid reference" line to one
  string built the same way, with `· i of n` appended only when there is a strip to be lost in
  (`ids.length > 1`) — one of one says nothing worth reading. Paging also answers to a raw
  `pointerdown`/`pointerup` swipe on the stage (`.photo-lightbox-stage`,
  `touch-action: pan-y`): the horizontal axis is handed to the swipe handler, the vertical axis
  stays the browser's own scroll/pinch, and a drag has to clear a minimum distance and be more
  across than down before it counts as a page turn rather than someone scrolling or steadying a
  thumb.
- **The swipe-then-backdrop guard**: a swipe that starts on the photo and travels far enough
  can end past its edge, on the backdrop — and the backdrop's own `onClick` closes the view on
  anything that isn't a tap on the image. Without a guard, every page-turn swipe that overshot
  the image would be immediately followed by a dismissal. A ref (`swipedRef`) is set the moment
  a swipe's distance/direction test passes, consulted once by the very next click, and cleared
  either by that consultation or by the next `pointerdown` anywhere in the view — so the
  suppression lasts exactly one gesture, never longer.
- **The caption is the pager's live region** (`aria-live="polite"`), so "2 of 5" is read when
  the page turns. Polite rather than assertive: paging is the surveyor's own doing, and it
  belongs after whatever is being read, not over it. It is the only thing that can announce a
  turn — the stage image carries `alt=""` deliberately, because this line is what describes it
  and alt text would only double the announcement.
- **The overlay is mounted on "a view is open", not on the photo.** The portal's condition is
  `openId != null`, never "the photo that id names still exists" — because on the render that
  delivers a retake it briefly does not. Gating on the photo would tear the overlay off the
  body mid-edit: `BodyPortal`'s cleanup runs synchronously inside the diff, while its remount
  goes through a **passive** effect flushed after paint, so the surveyor would get at least one
  frame with the full-screen photo gone and the focus inside it dropped. Nothing else covers
  that gap; keeping it mounted is what makes the retake seamless. The stage's stand-in
  (`.photo-lightbox-loading`) already handles "open, but no bytes to show", so the momentary
  no-photo state has a treatment, and the caption drops its ` · i of n` while there is no `i`
  to state rather than reading "0 of 3".
- **The `useLayoutEffect` reconcile**: when `photos[]` changes shape — a retake repoints an id,
  a delete removes one, an add appends one — the open view has to decide, before the next
  paint, which photo it is now on. This runs as a layout effect, not a passive one, so the
  replacement id (or the neighbour, on a delete, or `null` when nothing is left) is settled
  while the DOM is still uncommitted: the browser paints the new photo, not a frame of the
  stand-in. It is the _content_ the layout timing protects — the overlay itself never goes
  anywhere, per the bullet above.
- **Writers on the shown photo**: Retake and Add both ride the same file input shape as the
  fourth pass described, but Add is not a new writer — it is the existing `onSetPhoto` called
  with a `null` photo id in place of the one being replaced, the identical call the empty-slot
  Add photo link already made. **Deleting the last photo still closes the view**, exactly as
  the fourth pass described; deleting one of several instead lands the view on a neighbour —
  the next photo where there is one, the previous where there is not — so a run of bad photos
  can be cleared without reopening the view each time.
- **A failure inside the view is stated inside the view** (`.photo-lightbox-error`,
  `role="alert"`, above the actions row). Row edits from the _strip_ still funnel through
  `CapturePage`'s shared `save-error` line — the one every other write failure uses — but that
  line renders behind a `position: fixed; z-index: 10` scrim, so from inside the full-screen
  view it may as well not exist. Delete was the worst of the three: on a failed write the
  confirm just sat there, saying nothing. The message is the thrown `error.message`, falling
  back to "Could not update the photo"; it clears at the start of the next attempt and on close,
  the same way `handleSave` clears its own. It inks in `--danger-on-dark`, the one light-on-dark
  danger value, used on this scrim and nowhere else — as `.photo-lightbox-delete-commit`
  already does.
- **The confirm is single-shot** (`disabled` while its own write is in flight, and the handler
  refuses a second call): a gloved double-tap on Delete photo is one delete, not two. Keyed on
  that write alone, never on `busy` generally — Delete deliberately stays live while an _add_
  is still being written.
- **At the cap the view's Add stays put and goes dead**, `aria-disabled` with its input
  disabled at the sheet's "unavailable" opacity, and `.photo-lightbox-cap` prints the same
  sentence the compose field does in the on-scrim muted voice. Withholding the control
  (which is what shipped first) changed the actions row's width and explained nothing. The
  sentence itself is `PHOTO_CAP_MESSAGE` in `src/ui/format.js`, built from `MAX_PHOTOS` and
  shared with `.photo-field-cap`, so the copy cannot drift from the cap it describes.
- **Night and touch extensions**: the night list picks up `.photo-field-thumb img` alongside
  the existing saved-thumb and lightbox-image dimming rules — a compose-time thumb dims exactly
  like a saved one, rather than staying full-brightness until the surveyor saves. The
  `user-select: none` list picks up `label.photo-lightbox-add`, matching Retake and every other
  label-wrapping-a-hidden-input control already on that list — Android's long-press text
  selection popup has no business appearing over a camera control.

### What this pass did not do

- **No reordering.** Photos file in the order they were taken; there is no drag-to-reorder and
  no "make this the cover photo." Nothing in the surfaced field reports asked for it.
- **The framing screen (revisit mode) did not page** in this pass — see "Framing pages
  (2026-08-26)" below, which added it.
- **Off-screen strip rows keep their `IntersectionObserver` running and their object URLs
  live.** A thumb that scrolls out of view is neither unobserved nor revoked; only the row's own
  unmount, or the id leaving `photos[]`, frees it. A long session's worth of scrolled-past rows
  each holding a handful of live object URLs was not measured against the memory ceiling that
  motivated the viewport-lazy fetch in the first place.
- **No richer pager semantics.** The caption's live region (above) is the whole of what a
  screen-reader user gets on a page turn: no roving focus, no `aria-roledescription` carousel
  wrapper, and nothing that describes the photograph itself.

## Framing pages (2026-08-26)

A reference station can carry several photos since the multi-photo pass, and the framing screen
was still showing its first with no way to reach the others — on the phone that read as "a random
photo". The screen now pages.

- **The stage** (`.framing-screen-stage`): a positioned box inside `.framing-screen-reference`
  that takes the reference's height budget (the dvh calc moved off the image, so the photo is no
  larger than before), `touch-action: pan-y`, and the swipe is read on it — the lightbox's rule,
  raw `pointerdown`/`pointerup`, ≥40px and more across than down, no `pointermove`, no transform.
  The image is `-webkit-user-drag: none` and `draggable="false"` so a swipe never lifts it.
- **The arrows** (`.framing-screen-nav`, `-prev`/`-next`) share every declaration with
  `.photo-lightbox-nav` — one selector list, one treatment (44px translucent disc at the stage's
  edges, `opacity: 0.3` disabled at the ends, no wrap). Rendered only with more than one photo.
  `aria-label`s are "Previous reference"/"Next reference", not "photo": the surveyor is choosing
  what to frame against, not browsing.
- **The label line** does the counting: `Reference 2 of 3 · 12 Apr 2025`, a polite live region
  (a page turn is announced without moving focus). With one photo it reads as before. The
  bearing/accuracy caption under the photo gains ` · done` for a reference already re-framed
  into the compose strip — plain text, no tick glyph, the same "state is a word" rule as the
  station chips.
- **Advance, then close.** The screen opens on the first reference not yet re-framed and, after
  a shot, moves to the next one (wrapping); the shot reports which reference it framed
  (`onPhoto(file, filename)`) and CapturePage pairs to that, never re-deriving `[0]`. "Done"
  derives from the compose strip's `referencePhoto`s plus the screen's own shots since it
  opened — a quick second press must not wrap back to the reference just framed while its
  downscale is still landing. CapturePage closes the step only when that shot was the last
  reference outstanding; paging back and reshooting is allowed and appends.
- **The shutter respects the cap**: at `MAX_PHOTOS` it disables and the hint line becomes the
  shared `PHOTO_CAP_MESSAGE` — the third place the sentence appears, still from one constant.
- **`StationBlock`'s button** reads "Frame the photos" when the station holds several. Nothing
  else on the station card changed — no thumbnails, no per-photo count; the framing screen is
  where the photos are.
- One-accent rule: unchanged — the shutter is the surface's only accent-filled control.

### What this pass did not do

- **No filmstrip** of the station's references under the stage, and no jump-to-N — ‹ ›, swipe
  and the count are the whole pager, as in the lightbox.
- **No reordering** of what a shot pairs to after the fact; the pairing is fixed at composition
  (remove the thumb and reshoot).
- **Reference traces are still not drawn** on the map, and history is still not offered as a
  reference source — the deferrals from the revisit pass stand.

## Field fixes 3 (2026-09-04): the beam in sunlight

Field report: the locator's bearing beam was often too faint to see — in bright sunlight
generally, not against any one basemap.

- **The beam has a silhouette now.** The wedge was a radial wash of accent from half opacity at
  the pivot to nothing at the rim, with no edge at all; sunlight kills a low-alpha fill and
  spares an edge. It now gets the ring's own treatment — a 6px half-opacity casing in
  `--locator-casing`, then a 3px stroke in `--locator-stroke` — drawn from one geometry in
  `<defs>` via three `<use>`s inside the rotating group, so the adapter still updates a single
  `d` and the outline turns with the fill. The fill's rim stop is `.28`, not `0` (an outline
  with nothing behind it reads hollow), the pivot `.6`, and the accuracy fade bottoms out at
  half rather than a third. The fade itself stands: a confident narrow beam on a bad compass is
  still a lie. `docs/locator.svg` is updated to match; the app icon is not — it is the mark at
  rest and re-rastering it is its own job.
- The silhouette rides its own classes (`locator-beam-casing`/`-stroke`), not
  `locator-casing`/`locator-stroke`: the stale rule quiets those, and staleness is the position
  ageing — the beam has never reflected it, since the compass is a separate sensor.
- **Night's canvas filter now targets the canvas element, not its container.** MapLibre parents
  DOM markers inside the same container as the canvas, so the filter on the container
  greyscaled and dimmed the locator with the tiles — the night tokens it was given never
  showed, and two comments claiming it escaped the filter were wrong. The red multiply overlay
  still covers the marker, which is what keeps it red-only. Guarded in the e2e tier (a filter
  on any ancestor of `.locator` fails it).
- **Colouring the beam dynamically for contrast was considered and rejected.** The canvas is
  created without `preserveDrawingBuffer`, so sampling the pixels under the marker means a
  GPU→CPU stall on every fix, or flipping that flag app-wide; and the night filter and multiply
  are compositor effects applied after anything `readPixels` returns, so a sampled decision
  would be made against colours the surveyor never sees at night. A silhouette is
  basemap-independent by construction — the same reason the ring, the ticks and the trace lines
  ride casings. Don't re-propose it.

## The maximised map (2026-09-04)

Field report: navigating to a station needs more map than the 300px panel, and switching to a
bigger one must not interrupt the survey. Constraint 7 is amended above; this records the parts.

- **One node, one attribute.** `data-maximised="true"` on `.capture-map` is the whole state;
  CSS makes it `position: fixed; inset: 0` and `CaptureMap` calls `resize()` once the attribute
  is committed (the same effect that remeasures on return from Session history). The map is
  never rebuilt — `BodyPortal`, the app's full-screen idiom, re-parents into a fresh div and
  would destroy it, so it is the wrong tool here. Not persisted; survives a view switch because
  CapturePage stays mounted and a `hidden` ancestor hides a fixed child too.
- **`.capture-map-expand`**: top-right, `button-surface`, 44px. Collapsed it is the ⤢ glyph
  with `aria-label="Expand map"`; maximised it reads **Close map** in words. Available while
  picking — the crosshair is a fraction of the panel's height and stays right at any size.
- **`.capture-map-foot`** is the bottom-anchored column that the control row already lived in
  spirit; it now holds the row and, while maximised, **`.capture-map-walk`**: the current
  station's `StationWalk` (arrow, distance, compass point — extracted from `StationBlock`, which
  renders the same component) under a small uppercase label, `Station 3 of 8 · <name>`, on a
  near-opaque paper card. Hidden while picking, when the confirm panel owns the bottom. This is
  not the dropped plan diagram: that was a second map beside the instruction; this is the
  instruction over the map that now covers it.
- **Collapses on a result that lands beneath it**: a feature tap (the sheet is in the page) and
  a confirmed "Use this point" (it arms Save). Region suggestion and Re-centre are inside the
  panel and need nothing.
- **Safe areas** are padded only in the maximised state — the in-flow panel never reaches the
  screen edges, and `env()` would push its controls up for nothing. `touch-action: none` on the
  maximised panel so no overlay can scroll the page beneath; the scroll offset is stashed before
  the state commits (the browser may clamp it as soon as the panel leaves the flow) and restored
  in the effect cleanup, once the collapsed layout is back.
- **z-index 5**, in the tier list under constraint 7.

### What this pass did not do

- **No fit-to-station or zoom-to-me-and-the-target** — follow mode and Re-centre are the whole
  viewport control, and the adapter gained no method.
- **No trace readout** over the maximised map; `TraceStrip` stays on the page, the live line keeps
  drawing on the map.
- **The history map does not maximise.**

## The lens per photo (2026-09-04)

Asked in the field: capture the focal length so a revisit can compare lenses (0.5×, 1×, 3×)
against the reference. The finding first, because it shaped everything below.

- **The photos carried no EXIF at all.** `photo/encode.js` redraws every photo through a canvas
  and `canvas.toBlob` emits a fresh JPEG with no metadata; the original `File` was dropped
  straight after. So the lens is read from the original file, before the downscale, by
  `photo/exif.js` — a ~150-line APP1 reader (Make, Model, FocalLength, FocalLengthIn35mmFilm,
  LensModel, both byte orders, every access bounds-checked, never throwing) — and stored as three
  fields on the observation's `photos[]` entry: `focalLength35mm`, `focalLengthMm`, `lensModel`.
  They ride the export as `focal_length_35mm` / `focal_length_mm` / `lens` on every entry
  (`?? null`, the column-set rule; every existing session's bytes changed once) and come back
  through both import parsers. **Re-embedding EXIF into the exported JPEGs was deliberately not
  done** — the structured field is what a comparison or a GIS consumer can use, and
  `canonical-json` stays in charge of the bytes.
- **A direct capture never has it.** On the phone (iPhone 17 Pro Max, 2026-09-04), WebKit's
  camera UI returned the shot as `image.jpg`, a 2.8 MB JFIF re-encode with a 140-byte Exif
  block holding orientation and resolution only; the same shot taken in the Camera app and
  picked from the library came back as `IMG_6634.jpeg` with `14 mm eq. (ultra-wide) · 2.22 mm ·
iPhone 17 Pro Max back triple camera 2.22mm f/2.2`. The probe page's Camera EXIF row (two
  controls, a segment map, and three distinct verdicts — block-with-no-tags, bytes-but-no-block,
  nothing) is what settled it.
- **"From library" as an option, never a step.** The compose field and the framing screen each
  gain `label.photo-field-library` / `label.framing-screen-library` — the link vocabulary, no
  new accent, 44px floor, the same input without `capture`, the same handler, the same cap. The
  camera control is unchanged and first in the DOM, so nothing that finds "the" file input
  moved. The three post-save edit paths (empty-row Add photo, lightbox Retake and Add) stay
  camera-only — a fourth item on the lightbox's 24rem actions row is its own layout change.
  Size was asked about and is not a concern: every photo still goes through the 1600px
  downscale, so a 5.5 MB library pick stores at the same ~300 KB as a capture.
- **Where it shows: the framing caption, and the export. Nowhere else.** `038° · ±4 m · 14 mm
ultra-wide · done` — the 35 mm-equivalent with its band (`lensBand`: < 20 ultra-wide, ≤ 35
  wide, ≤ 60 standard, else telephoto), the physical focal length alone when that is all the
  reference had, omitted when unknown. **mm plus a word, deliberately not a ×-number**: 1× is
  24 mm on some phones and 26 mm on others, so a ratio would mislead across devices. After a
  shot whose band differs from the reference's, one plain line under the caption:
  `Your shot: 24 mm wide — the reference was 14 mm ultra-wide` (`.framing-screen-lens-hint`).
  Words, not colour, and never a gate — the shutter stays enabled, the sentence stays
  "Close enough is your call".
- One-accent rule: unchanged on both surfaces.

### What this pass did not do

- **No lens on the saved row, the lightbox or history** — the caption and the export are the two
  places the comparison happens.
- **No re-embedded EXIF** in exported JPEGs (above).
- **AR ground projection of feature layers over the camera** was assessed and parked: feasible as
  a coarse "it's over there" overlay, not as a precise boundary locator — GPS error (±5–10 m)
  dominates under ~30 m, the compass wanders ±10–15°, and there is no offline terrain model, so
  a hedgerow 80 m away lands within a hand's width and a boundary tree at 20 m does not. If it is
  ever tried, it is a throwaway probe-page view (live camera, heading + pitch/roll, projected
  vertices, FOV from the measured lens), judged in a field before any feature is built.
