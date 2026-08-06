# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Pre-implementation. The repo currently holds only `field-survey-pwa-prompt.md`, the brief for a
field-surveying progressive web app — no source, package manifest, or test runner exists yet.

Build/lint/test commands and an architecture overview belong in this file once a stack is chosen and
the first phase lands. Before proposing an architecture or writing code, read
`field-survey-pwa-prompt.md` in full — it specifies the stack question, file layout, data model, and
phased build order the maintainer expects to approve first.

## Platform constraints

- Target is iOS Safari installed to the home screen, portrait only. Don't add Android compatibility
  code, but don't actively block Android either.
- Offline-first: launching the app, showing the map, taking GPS/compass readings, capturing photos,
  and saving observations must all work with no network. Network is only required for sync.
- No backend — static hosting plus the GitHub API only.
- Minimal UI: large touch targets, sunlight-readable, usable one-handed with gloves.

## Security constraints (non-negotiable)

- The GitHub personal access token is never stored in plaintext. Encrypt it with a passphrase-derived
  key: PBKDF2-SHA256 (current OWASP-level iteration count) → AES-GCM, random salt and IV stored
  alongside the ciphertext. Only ciphertext goes to IndexedDB.
- The decrypted token lives in memory only for the duration of a sync and is discarded afterward. It
  must never touch localStorage, a global variable, or a log line.
- The passphrase is requested at sync time only — never at launch. Taking readings and saving
  observations must never require it.

## Design boundaries to preserve

- Keep the map layer behind a thin abstraction: Leaflet + OSM raster tiles ship first, but PMTiles
  via MapLibre must be able to replace it later without rewriting the rest of the app.
- Sync writes one commit per session via the GitHub Git Data API (create blobs → build tree → create
  commit → update ref), and must be resumable and idempotent — retrying after a mid-sync failure must
  not duplicate or lose observations.
- Once synced, observations stay on the device but are marked synced; the pending/synced distinction
  must stay visible in the UI.
- Export (zip of GeoJSON + photos via the Web Share API, with a Blob-download fallback) must work on
  any session, synced or not, and must never mutate or clear local data as a side effect.
- If compass permission is denied or the sensor is unavailable, degrade to position-only
  observations rather than failing.
- Downscale photos on-device before storing them.
