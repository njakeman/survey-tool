# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Built and field-usable offline: capture (GPS/compass readings, photo, voice note, save — with
in-place **note editing** and **photo retake/delete/add** on the open session's rows only
(`updateNote`, `setPhoto`/`deletePhoto` over `storage/photoWrite.js`; the photo edits live in
the full-screen view, which renders through `BodyPortal` in `ObservationsList.js` — NOT
`preact/compat`'s createPortal, whose import re-aliases `onChange` app-wide as a side effect);
history stays read-only by not being passed the callbacks), session
history, zip export and **import** (always a copy under fresh ids; the **Exported** badge —
`src/ui/ExportBadge.js` — derives from `lastExportedAt`/`lastExportCount`, stamped only by a
completed export, plus the **CHANGED SINCE EXPORT** third state below), **Load session**
(history detail → `reopenSession`, the deliberate
continuation path import is not: refuses while any session is open — an unguarded reopen would
silently steal capture via `findOpenSession` — keeps the export stamps, and signals the
always-mounted CapturePage through App's `sessionEpoch` bump, which also clears Undo),
**session deletion** (`storage/sessionDelete.js`, one transaction over all six stores a session
can reach; the service refuses the open session; the list's "Delete exported sessions" purges
only what the badge predicate reads as fully exported; warn-don't-block on unexported data),
the offline PMTiles basemap with multi-region storage, **feature layers**
(the surveyor's own GeoJSON, tappable, with the amber selection highlight and "Record here" —
which on a polygon records the centroid via `src/geo/centroid.js`), **OS grid references**
(OSTN15, offline), **marking a point the surveyor cannot reach** (`positionSource: 'map'` — the
accuracy figure is the map precision at the picked zoom, the only thing distinguishing measured
from eyeballed), **online basemaps** (Esri aerial imagery plus OpenFreeMap Light/Simple/Dark,
all never-suggested pseudo-regions — `src/map/onlineBasemaps.js`), **trace
modes** (below), **night mode** (`data-mode="night"` via `src/app/displayMode.js`; an Auto|Night
footer switch persisted in settings — never inferred from the OS), the **locator marker**
(`src/map/locator.js`, a DOM marker whose beam width is the compass's uncertainty; stale goes
hollow-and-dashed; the accuracy ring stays a circle layer) and the station-mark app icon
(`public/icons/`, maskable entry included). Standard map gestures: one finger pans, pinch zooms,
and the viewport meta pins `maximum-scale=1` so the interface itself can never pinch-zoom.

**There is no sync and there will be none** (dropped 2026-08-11, user decision — export/import
covers the need). Do not propose or build sync, token storage, or the crypto envelope. The
observation `synced`/`syncedAt` fields still exist in stored records, unused — leave them.

**The stylesheet is not a placeholder.** `docs/styling.md` is the design record — tokens, every
component's treatment, and the constraints binding on change; read it before restyling anything.
The one-accent rule (at most one accent-filled button per surface, always the one that moves the
record toward saved) holds everywhere except recording-with-a-good-fix, where Finish and Save
each move their own record. iOS Safari remains the design target and the sign-off gate; Android is
a supported platform (2026-08-17) — see README → Android for what that pass covered and
`docs/android-manual-checklist.md` for the (unrun) device gate.

**Trace modes**: _trace a path_ (walk, record a LineString — hedgerow, track, watercourse) and
_trace a boundary_ (walk a perimeter, closed into a Polygon). The decisions below are settled —
do not reopen them:

- **Vertex capture is automatic**, thinned by `src/trace/recording.js` (pure reducer over the
  existing shared watch): accuracy gate 20 m, and a fix must move `max(5 m, its own accuracy)`
  from the last vertex — motion smaller than the error bar is noise. No manual drop-vertex.
- **A trace is an observation with a geometry**, not a new record type: `createObservation` takes
  an optional LineString/one-ring-Polygon `geometry` with `positionSource: 'trace'`
  (both-or-neither, like the feature link). lat/lon hold a representative point (path →
  distance-midpoint via `geo/lineMetrics.js`, boundary → `polygonCentroid`), `gpsAccuracyM` the
  **worst vertex**, `fixAt` the walk's start — so list rows, undo, badges, export and import all
  reuse the observation machinery. Full annotations (note/photo/voice note/feature link) compose
  on Save exactly like a point.
- **The no-watch-persistence carve-out is real and narrow**: DB v6 adds `traceDrafts` +
  `traceVertices` (one record per accepted vertex, composite key `[draftId, seq]`); only the
  gated appender writes there, and the save transaction (`captureWrite.js` `traceDraftId`)
  deletes the draft atomically with the observation put. A force-quit mid-walk recovers on
  relaunch as resume-**paused**/finish/discard — never silently re-recording.
- **Boundary self-intersection: warn, save anyway** (`geo/selfIntersection.js`, proper crossings
  only). Deliberately NOT validated in `createObservation`, or a saved figure-eight would fail
  its own re-import. Ring closure and ≥3 distinct vertices ARE validated there.
- **Export/import**: the feature carries the walked geometry in place of the Point;
  `trace_length_m` is derived at export on every feature (`?? null`, the feature-link precedent —
  old exports still import, guarded by tests). Import passes non-Point geometry back through
  `createObservation` and defaults a bare non-Point feature to `'trace'`. `trace_gaps`
  (2026-08-24) rides the same on-every-feature rule but is **read back on import, never
  re-derived** — unlike `trace_length_m` it does not restate the geometry.
- **Map**: saved shapes render from `overlays.js`'s `observation-shapes` source (solid vs
  **dashed** line = exported vs not, the line-scale filled-vs-hollow; **dotted = inferred** —
  see the gap bullet below — via a walked/inferred feature split, because `line-dasharray` is
  not data-drivable; layers sit above the
  highlight, below `position-accuracy` — asserted in the browser tier), the live walk as a dashed
  accent line via `setActiveTrace`, keyed per accepted vertex, not per GPS tick.
- **UI**: Trace button in the capture actions row → path/boundary chooser; `ui/TraceStrip.js` is
  the persistent readout (pause/resume, two-step discard); point capture stays live mid-trace;
  End session is refused while a trace is recording or pending; "Mark a distant point" is
  withheld while a trace is pending (both arm the same Save).
- **Background gaps are recorded honestly, not coded around** (2026-08-24, superseding the
  earlier no-wake-lock note — user decision after the design handoff's investigation). No web
  API delivers geolocation to a backgrounded PWA on either OS (iOS suspends the page; Chromium
  deliberately stops callbacks when not foregrounded), so: the reducer flags a vertex
  `gapBefore` when the fix stream went silent >15 s (`GAP_THRESHOLD_MS`), when CapturePage saw
  `visibilitychange`→hidden (`noteInterruption`), or on resume-after-pause/recovery — the flag
  rides the draft-store spread, `finishTrace().gaps` → `traceGaps` on the observation
  (validated) → `trace_gaps` in the export. Those segments draw **dotted** (dash was taken:
  dashed = unexported), live and saved, with rhythm-matched dotted casings — the one bend in the
  solid-casing rule. A dismissible `role="status"` notice appears once per background gap
  ("…That stretch is drawn dotted."), never for a deliberate Pause. `sensors/wakeLock.js` holds
  a screen wake lock only while a trace actually records (feature-detected; iOS 16.4+, working
  in installed PWAs from 18.4; every refusal swallowed) so the screen no longer auto-locks
  mid-walk — an optimisation, never a requirement.

**Revisit mode** (2026-08-21, design pass t8): re-photograph a previous export's stations so a
longitudinal record builds up. A revisit is a **session type** chosen at start (`createSession`
enforces type↔reference both-halves); the reference zip loads at pick time in `SessionBar`
(never inside Start — `enableCompass()` must stay synchronous-first) and its bytes land in
`revisitReferences` (DB v7, one transaction with the session put; basemap ArrayBuffer rules).
The settled decisions:

- **The reference is read-only, decoded lazily**: `zipReader`'s `listZipEntries`/`readZipEntry`
  split reads one photo at a time out of the stored buffer; `parseReferenceExport` reuses
  `parseSessionExport`'s validation, returning photo _filenames_, verified against the entries.
- **States derive, claims store**: DONE = a saved observation paired via
  `referenceObservationId` (Undo honestly reverts it); only skip/no-access are written
  (`revisitStations`, `[sessionId, refObsId]`), precedence `done > noAccess > skipped > todo`
  (`domain/revisit.js`). Skip confirms _after_ the fact with Undo; no-access confirms first
  (accent commit, not danger — it records a claim, destroys nothing).
- **Pairing rides export/import**: `ref_obs_id`/`ref_photo` on **every** feature (`?? null` both
  ways — this changed all export bytes once, the feature-link precedent), plus a
  `survey_revisit` foreign member (reference file/hash/session identity + every station with
  its state) on revisit sessions only. A revisit export **imports as a plain closed survey
  copy** with pairing intact — self-describing, not self-contained. Export carries the **new
  photos only**; join reference photos by the `photo` string, never `obs_id + '.jpg'`.
- **The framing step uses the native camera via the file-input path** — no getUserMedia, no
  ghost overlay (user decision 2026-08-21; the design is built so this is complete). It never
  gates the shutter. `BodyPortal` now lives in its own module; still never preact/compat.
- **The current station is sticky** — defaulted to the nearest to-do, advanced when the target
  resolves, never re-picked on a GPS tick. The disarm ("Record something new instead") is
  tracked per station id, not as a flag reset by an effect (an effect raced the click).
- **A missing reference degrades, never blocks**: the session still captures with one honest
  line; history names the referenced survey from `session.reference`, which outlives the bytes.
- Map stations are runtime-generated diamond images (`overlays.js`) above traces, below
  `position-accuracy` (asserted in the browser tier); the plan diagram is token-coloured DOM
  SVG, deliberately not on the canvas so night mode is free.
- Deferred, by decision: reference traces drawn lighter on the map; history-as-reference-source;
  any overlay framing.

A few pointers the styling record leans on: every map trace line rides a **solid casing**
(`traceCasingColor()` in `overlays.js`, flipped near-black at night through the adapter's
`setNightMode`); `src/ui/traceGlyphs.js` holds the path/boundary glyph pair used by the chooser
and the list rows; **Export lives at the page foot**, not in the capture-actions row — it acts
on the session, not the observation being composed.

**The formal device pass lags the code.** The app is in real field use on an iPhone (which is
how the share-sheet banner and other reports surface), but `docs/ios-manual-checklist.md` is the
gate — unticked from Phase 3 onward, run against `https://survey.field.works/`.

The local dev server needs HTTPS to test geolocation/compass permissions (secure-context gated) —
`npm run dev -- --host` now serves HTTPS via `vite-plugin-mkcert`, reachable on the LAN. Plain `vite
preview` (used by e2e/CI) deliberately excludes mkcert — see the comment in `vite.config.js` for why
(mkcert's system CA install hangs waiting for elevation if it runs there; a static top-level import
of the package alone crashed CI regardless of whether the plugin ran). `npm run dev`'s SW is a shim
that precaches nothing (`vite-plugin-pwa`'s dev mode hardcodes an empty manifest) — offline/SW
behaviour can only be tested against a production build. For that on a phone, use `npm run
preview:mobile` (opt-in `MOBILE_HTTPS=true`, not inferred from environment — Playwright's own e2e
webServer also runs plain `vite preview` locally, so gating on CI-absence would silently break
`npm run test:e2e` on a dev machine while passing in Actions).

**`npm run dev` cannot demonstrate offline/PWA behaviour, full stop — don't test airplane mode
against it.** This was mistaken for an app bug once already: the dev server's empty-manifest SW
looks installed and controlling, so a home-screen icon backed by it fails offline exactly like a
broken PWA would. Use `npm run build && npm run preview:mobile` for any offline/SW verification.
Three easy-to-miss details: `preview:mobile` does **not** build for you (run `npm run build` first,
or the icon will be testing a stale bundle), and it serves on port **4173** vs dev's **5173** —
different origin, so re-add to the home screen from the new URL rather than reusing the old icon.
`preview:mobile` also squats on port 4173 with HTTPS, which collides with `npm run test:e2e`'s own
`vite preview` (plain HTTP, same port) — stop it before running the e2e suite locally. And use the
**trailing slash** — `https://<LAN-IP>:4173/`, not the bare origin — `vite preview`'s static
serving doesn't reliably resolve the latter to `index.html`, and the omission looks exactly like a
broken/blank page (found 2026-08-17 testing Android support; cost real debugging time).

Because that confusion is exactly what caused the false bug report, offline-readiness is now
self-diagnosing rather than something to infer: `src/app/offlineStatus.js`'s `readOfflineStatus()`
reports `{ registered, controlled, precachedCount, offlineReady }` from real
`navigator.serviceWorker`/`caches`, surfaced as a warning banner on the capture page (only when
`precachedCount === 0` — silent on a real production build) and as a full readout + "Recheck"
button on the probe page. `main.js` doesn't call `readOfflineStatus()` directly — it subscribes via
`subscribeOfflineStatus()`, which reports once the registration has actually settled
(`serviceWorker.ready`) rather than at the instant of registration. A single startup snapshot was
itself a second false-positive source: `precachedCount` is genuinely 0 for a moment on _every_ load,
including a perfectly good production build, while the SW is still precaching — the banner used to
flash on first launch and disappear on refresh purely because of that timing, independent of the
"dev vs prod" question.

The app lives at **`https://survey.field.works/`** (as of 2026-08-12) — a custom domain on the
GitHub Pages deploy, CNAME'd via Cloudflare, configured in the repo's Pages **settings** (an
Actions-based deploy ignores any CNAME file; do not add one). That domain serves the project site
from the **root**, and `njakeman.github.io/survey-tool` now redirects there — which is why
`vite.config.js`'s `base` is `'/'`; a `'/survey-tool/'` build under the custom domain 404s its own
manifest and hashed assets, and the redirected module scripts surface on the phone as the fatal
"Script error. (:0:0)". The old `njakeman.github.io` origin keeps its own IndexedDB — sessions
saved there must be exported from the old home-screen icon (it may still open in airplane mode)
before that icon is removed. `https://survey.field.works/` is the primary target for on-device
testing; `preview:mobile` remains for pre-deploy iteration.
Every dev-server port is a **separate origin**, each with its own service-worker registration and
its own IndexedDB — a home-screen icon added from 5173 shares nothing with one added from 5174 or
4173, including saved observations. `vite.config.js` sets `strictPort: true` on both `server` and
`preview` specifically so a second `npm run dev`/`preview` fails loudly with "port in use" instead
of silently drifting to the next port and creating another orphaned origin. Remove any stale
home-screen icons from earlier local ports before testing against Pages.

## Commands

- `npm run dev` — Vite dev server
- `npm run basemaps:manifest` / `npm run layers:manifest` — regenerate the two published manifests
  (both also run as `prebuild`; neither may ever throw — see the generator comments)
- `npm test` — unit tests (Vitest, `node` + `happy-dom` projects)
- `npm run test:browser` — contract tests against **real** IndexedDB/Cache/WebCrypto in Chromium
  and WebKit (Vitest Browser Mode + Playwright). Run before pushing, not on every save.
- `npm run test:e2e` — Playwright e2e against the built app
- `npm run lint` / `npm run format` — ESLint / Prettier check
- `npm run build` — production build (Vite + vite-plugin-pwa, injectManifest)

A single test file: `npx vitest run --project node path/to/file.test.js` (or `--project browser`
for a `*.browser.test.js` file).

## Architecture

- `src/domain/` — framework-free ES modules, no DOM/IndexedDB imports: `session.js` and
  `observation.js` (pure record construction + validation), `geojson.js` (session + observations →
  one FeatureCollection), `canonical-json.js` (deterministic serialisation — sorted keys, fixed
  indent, trailing newline; identical content always produces identical bytes, so exports are
  reproducible and diffable), `id.js` (ULID via `monotonicFactory`, not bare `ulid()`, so ids stay strictly
  ordered within the same millisecond).
- `src/storage/` — `idb` wrapper over IndexedDB. Each store module (`sessionStore.js`,
  `observationStore.js`, `photoStore.js`) takes an opened `db` as its first argument rather than a
  module-level singleton, so tests can pass an isolated database. `captureWrite.js` writes an
  observation + its photo in one transaction — see the ArrayBuffer-before-transaction comment there
  before touching it.
- `src/sensors/` — `position.js`/`heading.js`: browser sensor adapters, each taking its browser
  dependency as a parameter (`navigator.geolocation`, `window`) rather than reading globals, so
  they're unit-testable with fakes. `format.js` holds all display formatting (accuracy always in
  metres, never a tick). `heading.js`'s `watchHeading` subscribes to `deviceorientationabsolute`
  **in addition to** `deviceorientation` when `'ondeviceorientationabsolute' in target` (Android
  Chrome delivers absolute headings there; its plain event is relative) — additive, never a swap,
  because some Chromium devices feed absolute data into the plain event instead and a swap would
  break that device's compass. `toHeadingReading` already converts either shape; only the
  subscription list changes. A fence test pins the additive shape and another pins iOS at exactly
  one listener — don't "simplify" either away.
- `src/photo/` — `dimensions.js` (pure aspect-ratio math, node-testable) and `encode.js` (real
  Canvas/Image decode+encode, browser-only — never import it outside `main.js`).
- `src/audio/` — voice notes. `recordingTypes.js` (the candidate mime list, shared with the probe
  so they can never test different lists), `record.js` (`startRecording` with
  `mediaDevices`/`MediaRecorder` injected like the sensor adapters — node-tested lifecycle:
  tracks stopped on every exit path, 5-min cap behaves like a Stop, denial propagates by name;
  main.js binds the real globals and is its only importer). `domain/audio.js` maps contentType ↔
  file extension for the export/import round trip. Recordings live in the `audio` store
  (`storage/audioStore.js`, ArrayBuffer + contentType exactly like photos), ride in the save and
  undo transactions (`captureWrite.js`/`captureDelete.js`), and `ui/VoiceNoteField.js` /
  the observations list's lazy player are the two UI ends. A failed or denied recording lands on
  the field and never blocks Save — same degradation rule as the compass.
- `src/import/` — the inverse of export. `zipReader.js` (central-directory zip reader over
  DecompressionStream — client-zip streams with data descriptors, so local headers lie about
  sizes; no new dependency), `parseSessionExport.js` (pure inverse of `domain/geojson.js`,
  validating every feature back through `createObservation`), `importSession.js` (copy semantics:
  fresh ids for everything, one transaction, arrives closed, `lastExportedAt: null`).
- `src/app/captureService.js` — the orchestration seam between UI and storage: session lifecycle +
  observation save + read-only `listSessions()` for the history view, over an injected
  `db`/`newId`/`nowIso`. Stateless — every call re-reads IndexedDB, which is what makes it correct
  after a force-quit and relaunch.
- `src/app/offlineStatus.js` — `readOfflineStatus({ serviceWorker, cacheStorage, isSecureContext,
standalone, matchMedia })`, browser globals injected same as `app/standalone.js`, so it's
  node-testable with fakes (`.browser.test.js` covers real Cache Storage naming separately).
  Reports whether _this install_ can actually work offline (`registered`/`controlled`/
  `precachedCount`/`offlineReady`) — there's no console on an installed iOS PWA, so this has to be
  answerable on the phone, not inferred from a passing test on a laptop. `standalone` is resolved
  through `isStandalone()` (`app/standalone.js`) rather than a bare `Boolean(navigator.standalone)`,
  so an installed Android PWA reports correctly too — in both the success path and the `.catch`
  fallback, which must resolve it the same way or the two paths could disagree. `ProbePage.js`'s
  "Recheck" button calls it directly. `subscribeOfflineStatus(deps, onChange)` wraps it for
  `main.js`: emits once after `serviceWorker.ready` settles, again on `controllerchange` (e.g.
  after the update-reload below), and once via a timeout backstop if registration never settles —
  deliberately _not_ on first call, so the app never reports a startup snapshot. `CapturePage.js`
  shows a warning banner only when a reported `precachedCount === 0`.
- `src/app/standalone.js` — `isStandalone({ standalone, matchMedia })`: `navigator.standalone`
  (iOS's legacy flag) first, falling back to the standard `(display-mode: standalone)` media
  query (which Android answers too). Lives in `app/`, not `probe/`, because `offlineStatus.js`
  needs it and `probe/ProbePage.js` already imports `app/offlineStatus.js` — the other direction
  would be a cycle.
- `src/export/` — `buildSessionExport.js` (node-testable: session + observations + photo Blobs →
  `{filename, entries}`, reusing `domain/geojson.js` + `domain/canonical-json.js` as-is, so the zip's
  `session.geojson` is byte-identical to what sync will eventually commit), `zip.js` (browser-only
  thin wrapper over `client-zip`'s `downloadZip()`), `share.js` (browser-only `shareOrDownload()` —
  Web Share primary, `<a download>` fallback only, `AbortError` treated as a cancel not a failure).
  Composed together in `main.js`'s `exportSession()`, the only place all three meet.
- `src/ui/` — Preact + htm components. **Never import `src/storage/**` or `captureService.js`
  directly from here** — components receive a `service` prop instead (and `exportSession` where
  export is offered), which is what keeps happy-dom tests to two-line fakes. `App.js` is the entire
  "router": in-memory view state (`'capture' | 'history' | 'probe'`), no hash, no history API.
  `SessionHistoryPage.js` is read-only (past sessions + their observations + Export); `CapturePage.js`
  also offers Export for the _currently open_ session, so exporting doesn't require ending it first.
- `src/map/` — the Phase 4 offline basemap, one archive per **region**. `mapAdapter.js` is the
  **only** module that imports `maplibre-gl`/`pmtiles`, and `main.js` is its only importer
  (dynamic `import()`, so ~1.5 MB of renderer stays out of the startup bundle) — same rule as
  `photo/encode.js`. Everything else is pure and node-tested: `style.js` (one font stack, no
  sprite), `overlays.js` (accuracy-ring expression, marker FeatureCollection, trace shape/casing
  layers, and the layer **paint** — exported markers are filled-vs-hollow and trace lines
  solid-vs-dashed rather than colour-coded, and it all lives here rather than in `mapAdapter.js`
  so those distinctions are node-testable; deliberately _not_ reusing `domain/geojson.js`, whose
  bytes the export depends on), `locator.js` (the live-fix station mark: beam maths and SVG,
  pure — the adapter owns the DOM marker it feeds), `followMode.js`,
  `viewport.js`, `basemapSelection.js` (which region is active, and which merely _suggested_),
  `pmtilesSource.js` (an `ArrayBuffer`-backed pmtiles `Source`), `glyphs.js`, `manifest.js`
  (Node-only, for the generator script). `src/ui/CaptureMap.js` receives an injected `createMap`
  factory, so it tests against a fake adapter; `src/ui/BasemapPicker.js` is the region list.
- **Feature layers** are the second class of map data: the surveyor's own GeoJSON, drawn over the
  basemap and tappable. Called _feature layers_ everywhere, never "overlays" — `map/overlays.js`
  already owns that word for the position dot, accuracy ring and observation markers.
  `featureLayerStyle.js` (a style declaration + GeoJSON → one source and up to four
  geometry-filtered layers; also holds `DEFAULT_STYLE` and the amber selection-highlight
  source/layers the adapter keeps above the feature layers, below the markers) and
  `featureQuery.js` (a `queryRenderedFeatures` result → the one tapped feature, described, with
  its geometry resolved from the layer's stored GeoJSON because rendered polygons come back
  tile-clipped) are pure and node-tested;
  `featureLayerManifest.js` is **Node-only** like `manifest.js`. `storage/featureLayerStore.js`
  holds the GeoJSON as a **string** (never a parsed object, never a Blob),
  `app/featureLayerService.js` mirrors `basemapService.js`, and `ui/FeatureLayerPanel.js` /
  `ui/FeatureSheet.js` are the toggle list and the tap result.
- `src/geo/` — pure geodesy, node-tested, no browser or DOM deps. `osgb.js` turns WGS84 lat/lon
  into an OS grid reference via **OSTN15** (project onto the National Grid, then interpolate the
  datum shift — the second step is the one people skip, and skipping it costs ~100 m). The shift
  grid is **injected, not imported**: it is 34 kB fetched from `public/geodesy/`, vendored by
  `scripts/fetch-ostn15.mjs`, which also saves OS's 115 published test points to
  `src/geo/fixtures/` — `osgb.test.js` matches every one to within a millimetre. `distance.js` has
  haversine, bearing, and the metres-per-pixel figure behind a picked point's accuracy.
  `centroid.js` has the area-weighted polygon centroid (and its farthest-vertex reach) behind
  "Record here" on a polygon. `lineMetrics.js` (walked length, distance-midpoint) and
  `selfIntersection.js` (proper-crossing ring test, warn-only) serve the trace modes.
- `src/trace/recording.js` — the trace recorder: a pure, node-tested reducer over position
  readings (`acceptFix` gates by accuracy and spacing; `finishTrace` closes rings, computes the
  representative point, worst-vertex accuracy and warnings). No I/O — persisting an accepted
  vertex is CapturePage's appender's job, which is what keeps "no draft write without an accepted
  vertex" unit-testable. `storage/traceDraftStore.js` holds the in-progress draft (DB v6);
  `ui/TraceStrip.js` is the walk's readout.
- `src/probe/` — the Phase 1 device-capability probe, still reachable via a footer link in the
  capture UI. Findings recorded in `docs/ios-manual-checklist.md`.
- Test tiers (`vitest.config.js`): `node` for domain/storage logic (real WebCrypto; jsdom is
  deliberately avoided — `crypto.subtle` throws under it, vitest-dev/vitest#5365), `happy-dom` for
  UI components, `browser` (real Chromium + WebKit via Playwright) for contract tests that must
  match real browser behaviour, not an in-memory fake.
- Manual iOS verification (`docs/ios-manual-checklist.md`) is required before signing off any
  phase — Playwright's WebKit is not Safari and cannot exercise standalone mode, storage eviction,
  or the permission prompts that are the actual reason iOS PWAs break.

## Platform constraints

- iOS Safari installed to the home screen, portrait only, is the design target and the sign-off
  gate — every phase still needs a real-device iOS pass. Android is a genuinely supported second
  platform (2026-08-17): Android-specific code is welcome where it is feature-detected and
  provably iOS-neutral (an unchanged code path, or a fence test proving one), never a guess that
  it's probably fine. See README → Android and `docs/android-manual-checklist.md`.
- Offline-first: launching the app, showing the map, taking GPS/compass readings, capturing photos,
  and saving observations must all work with no network. Network is only required for sync.
- No backend — static hosting (GitHub Pages) plus the GitHub API only. The app repo
  (`njakeman/survey-tool`) and the data repo (`njakeman/survey-data`, private) are deliberately
  separate — a compromised sync token can reach only the data repo, never the deployed app.
- Minimal UI: large touch targets, sunlight-readable, usable one-handed with gloves.
- **Never store a Blob (or File) directly in IndexedDB, anywhere in this app** — store its
  `ArrayBuffer` + content type and reconstruct a Blob on read (see `src/storage/photoStore.js`).
  Confirmed via research: WebKit deliberately rejects Blob-in-IndexedDB in ephemeral/private-
  browsing sessions (real Safari Private Browsing included, not just a test-harness artifact) —
  ArrayBuffer sidesteps the restriction entirely and works identically everywhere. This will matter
  again in Phase 4 (PMTiles archive stored in IndexedDB).
- **The online basemaps** (`map/onlineBasemaps.js`): Esri World Imagery (a raster tile template —
  Bing's free tier was retired June 2025; ArcGIS scheme is `/tile/{z}/{y}/{x}`, row before
  column, a z/x/y template renders the wrong ground) plus the three OpenFreeMap styles — Light
  (Positron), Simple (Liberty), Dark. All are pseudo-regions appended in `main.js`, honoured by
  `basemapSelection.js` only as a remembered _choice_ — never the default, never suggested (no
  bounds, deliberately). Their tiles and styles are **never precached, runtime-cached, or stored
  in IndexedDB**, and the map must keep loading and functioning with the provider unreachable —
  asserted in the browser tier against unreachable URLs. The OpenFreeMap entries are `styleUrl`
  regions: the adapter fetches the style JSON itself (never handing MapLibre the URL — a failed
  style fetch would stop `load` firing and lose every queued setter), injects the region's
  attribution (their style JSON carries none), and falls back to a local blank-ground style
  offline. Feature-layer labels over a remote style use the region's `featureFontStack`
  (`'Noto Sans Regular'`) — the provider's glyph server has no `noto-sans-regular`.
- Basemap tiles: never bulk-fetch from `tile.openstreetmap.org` (OSMF policy explicitly bans
  pre-seeding areas for offline use) or from OpenFreeMap's CDN (planet-only downloads, no PMTiles;
  bulk collection is what their ToS is hostile to — live per-tile streaming via their hosted
  styles is their documented quick-start use, which is exactly what the online basemaps do, and
  no more). Use `pmtiles extract` against Protomaps' public planet build instead — the
  documented, ODbL-licensed, no-key route to a small regional extract.
- Four map facts, each learned by something breaking. **MapLibre 6 loads its worker from a separate
  file** resolved against `import.meta.url`, which does not survive bundling — `?worker&url` +
  `setWorkerUrl` (mapAdapter.js) is why production and offline work; dev mode hides the failure.
  **A whole-world `maxBounds` throws during MapLibre construction** in both Chromium and WebKit, so
  `viewport.js` returns null for world-covering archives. **Never clamp the map's zoom range to the
  archive's tile zooms** — it blocks zooming past the deepest tile, and a degenerate `min === max`
  range breaks MapLibre's viewport maths. **Glyphs must be vendored and precached**
  (`public/fonts/`, `pbf` in the precache glob): they're fetched lazily at render time, so hosted
  glyphs mean an unlabelled map offline with no visible error. The font-stack directory is
  hyphenated so precache keys and request URLs can't disagree over encoding.
- The `.pmtiles` archives are **never precached** — Workbox silently drops anything over its 2 MiB
  default (green build, broken map) and precached responses can't serve the HTTP Range requests the
  pmtiles client uses. They live in IndexedDB as ArrayBuffers (`storage/basemapStore.js`), one
  record per region, fetched by explicit in-app downloads and produced by the user (README →
  Offline basemap). `public/basemaps/manifest.json` _is_ precached, which is what keeps region
  names and bounds available offline — though it was **documented as precached for a whole phase
  before it actually was**: `json` was missing from the `injectManifest` glob, and only the
  settings-backed `basemapRegionMeta` fallback hid it. Generating a file into `public/` is not the
  same as precaching it; check `dist/sw.js`.
- Feature-layer GeoJSON is **not** precached either, deliberately — it lives in IndexedDB, fetched
  on first enable, where there is no 2 MiB cliff. `public/feature-layers/manifest.json` is, so the
  list survives offline. `.geojson` does not match the glob's `*.json`, which is what keeps those
  two facts from colliding.
- **A vector `.pmtiles` built from your own data renders blank as a basemap.** `style.js`'s vector
  branch hands the archive to `@protomaps/basemaps`, whose layers bind to Protomaps' schema
  (`earth`, `water`, `roads`…); a tippecanoe archive's layer is named whatever was passed to `-l`
  and matches none of them — with no error, because nothing is technically wrong. Supported routes
  for the user's own vector data are a feature layer or a raster archive. `docs/making-pmtiles.md`
  covers it; `style.js` carries a note pointing there. A per-region style sidecar would fix it and
  was deliberately not built.
- **Feature layers draw below the position and observation markers**, inserted with
  `beforeId: 'position-accuracy'`. A parcel boundary painted over the live fix hides the one thing
  on the map that must never be hidden. Asserted in the browser tier against a real composed style,
  because no unit test can see a layer stack.
- The raster style declares `glyphs` even though imagery has nothing to label: a labelled feature
  layer draws over whichever basemap is active, and without them its text fails to render with no
  visible error.
- Two rules the multi-region storage enforces. **Never read the `basemap` store with values in
  bulk** — every value is a multi-megabyte buffer, so listing uses `getAllKeys`. And **region
  metadata (name, bounds) is recorded in `settings` when a region is downloaded**, not on the
  archive record: bounds drive the position suggestion, offline is when that matters, and updating
  a field on an archive record would mean rewriting a hundred megabytes.
- Archives may be **vector or raster**; `map/manifest.js` detects which from the header (and, for
  raster, the tile size from the image bytes — nothing records it, and guessing 512 for 256px
  tiles halves the scale). `buildStyle` branches: the raster branch has no glyphs, no sprite and
  **must not** carry the vector branch's OpenStreetMap/Protomaps attribution, which would be false
  over a user's own imagery. Both `tileType` and `tileSize` are persisted per region, or an
  offline raster region would be styled as vector and render blank.
- The manifest generator runs as a **prebuild step**, so it must never throw: one unreadable
  archive would otherwise take down the build, the e2e webServer and the deploy together (it has).
  Warn and skip.
- Region switching is **offered, never imposed** (`map/basemapSelection.js` returns `activeId` and
  `suggestionId` separately). A surveyor mid-observation must never have the map change under
  them. The suggestion is computed in `CapturePage`, because that is where the live fix is.

## Security constraints (non-negotiable)

- **The app holds no secrets, by design — keep it that way.** GitHub sync was dropped (2026-08-11)
  before any token code was built, so there is no PAT, no passphrase, no crypto envelope, and no
  network write path anywhere in the app. Data leaves the device only through the user-invoked
  share sheet. Any future feature that would require storing a credential must re-open this
  section deliberately, not slip one in — the envelope-encryption design it replaced is in git
  history (and the PBKDF2 probe result, ~120 ms for 600k iterations on the real phone, still
  stands) if that day comes.
- Never log, export, or transmit anything beyond what the surveyor explicitly shares.

## Design boundaries to preserve

- Keep the map layer behind a thin abstraction. MapLibre GL JS + PMTiles from the start (not
  Leaflet + raster — raster tile providers with offline-friendly terms don't really exist; vector +
  PMTiles is where the legally-clean offline basemap ecosystem lives).
- Import (`src/import/`) is the inverse of export and always writes a **copy**: fresh ids for
  session, observations and photos, one transaction (nothing half-written), a mid-session export
  arrives closed, and every feature is validated back through `createObservation` so a malformed
  file fails on the tap with a named reason. It never overwrites, merges, or deletes.
- The exported-or-not distinction must stay visible wherever observations are shown (list rows,
  history, map markers — filled vs hollow). It derives from `lastExportedAt` +
  `lastExportCount` on the session, stamped by a completed export (`markSessionExported`). A
  dismissed share sheet stamps nothing. **Amended (design pass 4, user decision 2026-08-14)**:
  post-save edits — a photo retake/delete/add or a note edit — additionally stamp `changedAt`
  on the observation and `changedSinceExportAt` on the session (`storage/photoWrite.js`,
  `updateObservationNote`), which the badge compares against `lastExportedAt` to show
  **CHANGED SINCE EXPORT** (`isChangedSinceExport`/`hasChangedSinceExport`, domain/session.js;
  the per-observation predicate also requires `isExported` — an observation the export never
  carried stays honestly Not exported). The state drives every surface: the badge (its own
  `badge-changed` warning register), the map (filled/solid only while `exported && !changed` —
  `SAFELY_EXPORTED` in overlays.js), the history summaries and the capture footer's
  export-again hint. A changed session must not purge as fully exported; nothing is ever
  cleared — a completed re-export resolves the state by moving `lastExportedAt` past the
  stamp. These two fields are the only per-observation/deliberate second writer; do not add a
  third quietly. The observation `synced`/`syncedAt` fields still exist in stored records,
  unused — leave them. `main.js` requests `navigator.storage.persist()` at startup (evicted
  IndexedDB reads in the field as "the update deleted my sessions"; the probe page reports
  whether persistence stuck).
- `domain/geojson.js` emits the session itself as a `survey_session` foreign member (RFC 7946) —
  it is what makes exports importable with fidelity. No exported-at timestamp goes **inside** the
  file: identical data must keep producing identical bytes.
- Export (zip of GeoJSON + photos) uses the Web Share API as the **primary** route, with a Blob
  download as a secondary/fallback only — not the reverse. Must work on any session at any time,
  and must never touch observations or photos as a side effect — its one permitted write is
  stamping `lastExportedAt`/`lastExportCount` on the exported session, after a completed (not
  dismissed) share.
- If compass permission is denied or the sensor is unavailable, degrade to position-only
  observations rather than failing.
- Downscale photos on-device before storing them (plan: 1600px long edge, JPEG q0.8).
- No client-side router — hash routing re-triggers geolocation permission prompts in standalone
  mode (WebKit bug 215884). Hold view state in memory instead.
- Don't persist the live GPS watch stream to IndexedDB — ~1Hz writes for data nobody reads back is
  write amplification with no benefit. The actual "nothing held in volatile memory" guarantee is:
  session written on start/end, observation + photo written in one transaction on the Save tap
  (`captureWrite.js`), before any UI feedback. If you're tempted to write every `watchPosition` tick,
  don't — that's not what "offline-first, nothing lost" means here. (**Trace modes** — Project
  status above — are the one deliberate exception: an explicit, surveyor-started recording whose
  thinned, gated vertices are persisted as they accrue (`traceDrafts`/`traceVertices`, DB v6).
  Ambient ticks outside a trace stay unwritten, and no write happens without a vertex the pure
  reducer accepted.)
- An observation's `featureLayerId`/`featureId`/`featureLabel` are **both halves or neither** —
  `createObservation` throws on a half link, because an id with no layer joins to nothing and a
  layer with no id says only "somewhere in there". They are exported as `feature_layer`,
  `feature_id` and `feature_label` **on every observation**, null where absent: a GIS consumer
  takes its columns from the features it sees, so omitting them would make the column set depend on
  which rows happened to be linked. Read with `?? null`, because records predating the fields would
  otherwise export `undefined`, which `canonicalStringify` drops. Note this changed the exported
  bytes of existing sessions — free while nothing diffs old exports against new ones.
  `audio_duration_ms` (design pass 4) follows the same rules: on every observation, `?? null`,
  parsed back on import; `changedAt`/`changedSinceExportAt` are deliberately NOT exported.
- **A position can be marked on the map instead of measured**, for a thing the surveyor can see
  but not reach. It produces an ordinary observation — the data model gains exactly one field,
  `positionSource` (`'gps' | 'map'`) — but `gpsAccuracyM` then holds the **map precision at the
  zoom it was picked at**, not a fix accuracy. That field is the only thing distinguishing
  ±12 m measured from ±12 m eyeballed from 300 m away, so don't drop it and don't infer it.
  `fixAt` and the heading still come from the surveyor's own fix; altitude is deliberately nulled,
  because the far side of a valley is not at the height you are standing at. **"Record here" on a
  polygon feature rides this same path**: it marks the polygon's centroid (`src/geo/centroid.js`)
  as the picked point, with `gpsAccuracyM` = the polygon's reach from that centroid — the
  observation stands for the whole parcel, and the figure says so. Points and lines keep the live
  fix.
- **what3words was investigated and rejected — don't revisit it.** No offline JS/WASM build exists
  (the offline SDKs are native only), so it cannot work at capture time; and API licence clause
  6.3(b) forbids displaying or sharing a 3-word address alongside its coordinates, which is
  precisely what this app's GeoJSON export is. Reasoning in full in README → Why not what3words.
- `recordedAt` (when the surveyor tapped Save) and `fixAt` (when the position was actually measured)
  on an observation are deliberately distinct fields — a surveyor can stand at a point, type a note
  for 40 seconds, then save. Don't collapse them.
- `src/sw/sw.js` must never call `self.skipWaiting()`/`self.clients.claim()` unconditionally on an
  update (only on a genuine first install, where there's no older generation to fall out of sync
  with). Doing so lets a new SW activate — and prune the previous build's precache — while a page
  built from the _old_ generation is still open, which leaves that page requesting hashed JS/CSS
  that no longer exist anywhere (a 404 there is exactly the "Something went wrong loading the app:
  Script error." fatal screen). `registerType: 'prompt'` (`vite.config.js`) + the SW's
  `SKIP_WAITING` message handler + `main.js`'s `onNeedRefresh` → App.js's "New version — Reload"
  banner is the deliberate alternative: the old generation stays internally consistent until the
  surveyor chooses to reload, and an in-progress observation's note/photo (in-memory only until
  Save) can never be wiped by a surprise reload. `e2e/install.spec.js` guards the failure mode
  directly by asserting no same-origin resource 404s during a fresh load.
- The fatal banner ignores **muted cross-origin errors** (`isMutedErrorEvent`,
  `src/error-display.js`: null error object + no filename — WebKit's sanitized payload for
  browser-internal/extension script, seen on iOS around the share sheet). They cannot be app
  code (every app script is same-origin) and carry nothing actionable; real errors keep the
  banner, which is the only diagnostics channel on an installed PWA. Guarded in
  `e2e/install.spec.js` in both directions — do not "fix" a quiet console by removing the
  filter, and do not widen it beyond the muted signature.
