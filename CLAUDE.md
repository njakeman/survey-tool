# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phases 1–2 of the implementation plan are complete (device capability probe verified on iOS 26;
storage/data model layer). See `field-survey-pwa-prompt.md` for the original brief. The approved
architecture corrected several of the brief's technical choices (raster tiles → PMTiles/MapLibre,
download-as-primary-export → Web Share-as-primary) — read the plan history / recent commits before
assuming the brief's map or export sections still describe the built app.

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
  module-level singleton, so tests can pass an isolated database.
- `src/probe/` — the Phase 1 device-capability probe. Findings recorded in
  `docs/ios-manual-checklist.md`.
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
