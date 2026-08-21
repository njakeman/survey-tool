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
| Map controls    | `.capture-map-controls`                                                                                                                                                                                                                                                                  | One wrapping flex row; the buttons carry no positioning of their own.                                                                                                                                                                                                                         |
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
- **The photo lightbox** (`.photo-lightbox`): fixed near-black scrim in every mode, the photo
  `object-fit: contain`, one full-width `.button-inverse` Close (≥44px) — no accent fill on the
  overlay, and the existing night rule already turns `.button-inverse` into an accent hairline.
  Backdrop taps close it; taps on the photo don't (a mis-hit while peering must not dismiss).
  It is row state, not a route — there is no router, and it dies with its row.
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
  benefits only Android, which is not a target.
- **The attachment strip** (§7a): a saved row's three stacked orange links became one line —
  the photo as a 44px `--surface` chip (`.attachment-chip`), the voice note as a chip reading
  its stored duration (`0:12`) or `Voice note` for legacy records, and **Edit note staying a
  link pushed right** (it changes the record; the chips read it). Loading keeps the chip's own
  content so the strip's width never jumps; the dashed border is the pending treatment. A
  loaded photo chip becomes the **64px square thumbnail** (`object-fit: cover`) — the 180px
  block is gone; a saved list is an index.
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
  ancestor carries a filter/transform); the portal makes the question moot.
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
  the fact — recorded somewhere else, minutes later, it describes the wrong place.
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
  the add path gets the retake's busy treatment ("Adding…").
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
- **Station block** (`.station-block*`): the mock's 30px distance renders at `--type-heading-xl`
  (25px) and its 9.5/10/12.5px labels at `--type-badge`/`--type-label`/`--type-fine` — the mock's
  numbers map to tokens, never copied literally (the brand-lockup precedent). The bearing arrow
  is inline SVG rotated by the bearing directly — the map never rotates, so north-up needs no
  compass. The **no-access confirm replaces the action rows in place** (the house idiom) and its
  commit is **accent, not danger**: it records a claim about the world — moves a record toward
  saved — and destroys nothing; the danger register stays at exactly its two destructive
  confirms.
- **Plan diagram** (`.plan-diagram*`, 86px viewBox): DOM SVG in the page flow, coloured by
  tokens, so every scheme including night arrives free — the reason it is not drawn on the map
  canvas. Rings dashed at half/full radius, adaptive scale with an 8px corner caption (inside an
  86px viewBox — a caption, not interface text, the one sub-token size).
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
