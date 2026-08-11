# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phases 1–4 are complete: device capability probe verified on iOS 26, storage/data model layer,
capture (GPS/compass readings, photo, save), session history + zip export, and the offline vector
basemap — the app is field-usable offline as of Phase 3. Phase 4 needs a `public/basemap.pmtiles`
the user produces themselves (README → Offline basemap) and has **not yet been signed off on
device**: run the Phase 4 section of `docs/ios-manual-checklist.md`. Phase 5 is sync. See `field-survey-pwa-prompt.md` for the original brief. The approved
architecture corrected several of the brief's technical choices (raster tiles → PMTiles/MapLibre,
download-as-primary-export → Web Share-as-primary) — read the plan history / recent commits before
assuming the brief's map or export sections still describe the built app.

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
Two easy-to-miss details: `preview:mobile` does **not** build for you (run `npm run build` first,
or the icon will be testing a stale bundle), and it serves on port **4173** vs dev's **5173** —
different origin, so re-add to the home screen from the new URL rather than reusing the old icon.
`preview:mobile` also squats on port 4173 with HTTPS, which collides with `npm run test:e2e`'s own
`vite preview` (plain HTTP, same port) — stop it before running the e2e suite locally.

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

GitHub Pages deploys are working again as of 2026-08-10 (deployment for `0c8a0ec` reports
`state: success`, live `sw.js` carries a real precache) — `https://njakeman.github.io/survey-tool/`
is now the primary target for on-device testing; `preview:mobile` remains for pre-deploy iteration.
Every dev-server port is a **separate origin**, each with its own service-worker registration and
its own IndexedDB — a home-screen icon added from 5173 shares nothing with one added from 5174 or
4173, including saved observations. `vite.config.js` sets `strictPort: true` on both `server` and
`preview` specifically so a second `npm run dev`/`preview` fails loudly with "port in use" instead
of silently drifting to the next port and creating another orphaned origin. Remove any stale
home-screen icons from earlier local ports before testing against Pages.

## Commands

- `npm run dev` — Vite dev server
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
  indent, trailing newline; sync's idempotency depends on identical content always producing
  identical bytes), `id.js` (ULID via `monotonicFactory`, not bare `ulid()`, so ids stay strictly
  ordered within the same millisecond).
- `src/storage/` — `idb` wrapper over IndexedDB. Each store module (`sessionStore.js`,
  `observationStore.js`, `photoStore.js`) takes an opened `db` as its first argument rather than a
  module-level singleton, so tests can pass an isolated database. `captureWrite.js` writes an
  observation + its photo in one transaction — see the ArrayBuffer-before-transaction comment there
  before touching it.
- `src/sensors/` — `position.js`/`heading.js`: browser sensor adapters, each taking its browser
  dependency as a parameter (`navigator.geolocation`, `window`) rather than reading globals, so
  they're unit-testable with fakes. `format.js` holds all display formatting (accuracy always in
  metres, never a tick).
- `src/photo/` — `dimensions.js` (pure aspect-ratio math, node-testable) and `encode.js` (real
  Canvas/Image decode+encode, browser-only — never import it outside `main.js`).
- `src/app/captureService.js` — the orchestration seam between UI and storage: session lifecycle +
  observation save + read-only `listSessions()` for the history view, over an injected
  `db`/`newId`/`nowIso`. Stateless — every call re-reads IndexedDB, which is what makes it correct
  after a force-quit and relaunch.
- `src/app/offlineStatus.js` — `readOfflineStatus({ serviceWorker, cacheStorage, isSecureContext,
standalone })`, browser globals injected same as `probe/capabilities.js`, so it's node-testable
  with fakes (`.browser.test.js` covers real Cache Storage naming separately). Reports whether
  _this install_ can actually work offline (`registered`/`controlled`/`precachedCount`/
  `offlineReady`) — there's no console on an installed iOS PWA, so this has to be answerable on the
  phone, not inferred from a passing test on a laptop. `ProbePage.js`'s "Recheck" button calls it
  directly. `subscribeOfflineStatus(deps, onChange)` wraps it for `main.js`: emits once after
  `serviceWorker.ready` settles, again on `controllerchange` (e.g. after the update-reload below),
  and once via a timeout backstop if registration never settles — deliberately _not_ on first call,
  so the app never reports a startup snapshot. `CapturePage.js` shows a warning banner only when a
  reported `precachedCount === 0`.
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
  sprite), `overlays.js` (position dot, accuracy-ring expression, marker FeatureCollection —
  deliberately _not_ reusing `domain/geojson.js`, whose bytes sync depends on), `followMode.js`,
  `viewport.js`, `basemapSelection.js` (which region is active, and which merely _suggested_),
  `pmtilesSource.js` (an `ArrayBuffer`-backed pmtiles `Source`), `glyphs.js`, `manifest.js`
  (Node-only, for the generator script). `src/ui/CaptureMap.js` receives an injected `createMap`
  factory, so it tests against a fake adapter; `src/ui/BasemapPicker.js` is the region list.
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

- Target is iOS Safari installed to the home screen, portrait only. Don't add Android compatibility
  code, but don't actively block Android either.
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
- Basemap tiles: never bulk-fetch from `tile.openstreetmap.org` (OSMF policy explicitly bans
  pre-seeding areas for offline use) or from OpenFreeMap's CDN (planet-only downloads, no PMTiles,
  ToS silent-to-hostile on automated collection). Use `pmtiles extract` against Protomaps' public
  planet build instead — the documented, ODbL-licensed, no-key route to a small regional extract.
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
  names and bounds available offline.
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

- The GitHub personal access token is never stored in plaintext. Envelope encryption: a
  passphrase-derived key (PBKDF2-SHA256, 600,000 iterations — current OWASP figure, confirmed
  ~128ms on a real iPhone) wraps a random DEK via AES-GCM; the DEK wraps the PAT via AES-GCM.
  Random salt and IV stored alongside each ciphertext. Only ciphertext goes to IndexedDB. This
  structure exists so a future WebAuthn/PRF (Face ID) unlock can wrap the same DEK additively,
  without re-encrypting anything — designed for in the data model, not built in v1.
- The decrypted token lives in memory only for the duration of a sync (plan: up to 5 minutes,
  cleared on timer/background/tab-hide) and is discarded afterward. It must never touch
  localStorage, a global variable, or a log line.
- The passphrase is requested at sync time only — never at launch. Taking readings and saving
  observations must never require it.

## Design boundaries to preserve

- Keep the map layer behind a thin abstraction. MapLibre GL JS + PMTiles from the start (not
  Leaflet + raster — raster tile providers with offline-friendly terms don't really exist; vector +
  PMTiles is where the legally-clean offline basemap ecosystem lives).
- Sync writes one commit per session via the GitHub Git Data API (create blobs → build tree with
  `base_tree` set → create commit with **deterministic author/committer dates** → update ref with
  `force: false`), and must be resumable and idempotent — retrying after a mid-sync failure must not
  duplicate or lose observations. Blobs/trees are naturally content-addressed; commits are only
  idempotent if their dates are pinned rather than left to default to "now".
- Once synced, observations stay on the device but are marked synced (`synced`/`syncedAt` on the
  observation record, only ever flipped by the sync layer); the pending/synced distinction must stay
  visible in the UI.
- Export (zip of GeoJSON + photos) uses the Web Share API as the **primary** route, with a Blob
  download as a secondary/fallback only — not the reverse. Must work on any session, synced or not,
  and must never mutate or clear local data as a side effect.
- If compass permission is denied or the sensor is unavailable, degrade to position-only
  observations rather than failing.
- Downscale photos on-device before storing them (plan: 1600px long edge, JPEG q0.8).
- No client-side router — hash routing re-triggers geolocation permission prompts in standalone
  mode (WebKit bug 215884). Hold view state in memory instead.
- Don't persist the live GPS watch stream to IndexedDB — ~1Hz writes for data nobody reads back is
  write amplification with no benefit. The actual "nothing held in volatile memory" guarantee is:
  session written on start/end, observation + photo written in one transaction on the Save tap
  (`captureWrite.js`), before any UI feedback. If you're tempted to write every `watchPosition` tick,
  don't — that's not what "offline-first, nothing lost" means here.
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
