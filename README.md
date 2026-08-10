# Field Survey

Offline-first PWA for light location surveying in the field: GPS + compass readings, optional
photo, saved as a GeoJSON observation. Session data syncs to a private GitHub repo as one commit;
export to file works without any network at all. Built for iOS Safari, installed to the home
screen.

See [`field-survey-pwa-prompt.md`](./field-survey-pwa-prompt.md) for the original brief and
[`CLAUDE.md`](./CLAUDE.md) for constraints that bind the implementation.

## Status

Field-usable offline. Capture (GPS/compass/photo/save), session history, zip export and the
offline vector basemap are built; sync to GitHub is not yet.

To see a map you must first produce basemap archives for your survey areas — see
[Offline basemap](#offline-basemap) below. Without any, the app works exactly as before and the
map panel simply offers to pick a region.

## Develop

```sh
npm install
npm run dev
```

## Test

```sh
npm test           # domain logic (node) + UI components (happy-dom)
npm run test:browser  # real IndexedDB/Cache/WebCrypto, chromium + webkit
npm run test:e2e      # Playwright — builds, serves, and drives the real app
npm run lint
npm run format
```

`npm test` and `npm run test:browser` are separate because the browser tier spins up real browser
instances and is slower — run it before pushing, not on every save.

## Offline basemap

The map is MapLibre GL rendering [PMTiles](https://protomaps.com/) archives of your survey areas.
The archives are **not** part of the build: you pre-bake one per region, commit them, and the app
lists them so the surveyor can download the ones they need. Downloaded regions live in IndexedDB
and work with no network at all — several can be held at once and switched between in the field.

Produce each with the [`pmtiles` CLI](https://github.com/protomaps/go-pmtiles) against Protomaps'
public daily planet build, into `public/basemaps/`, named for the area:

```sh
pmtiles extract https://build.protomaps.com/20260801.pmtiles public/basemaps/north-wiltshire.pmtiles \
  --bbox=-2.2,51.5,-1.6,51.8 \
  --maxzoom=15

npm run basemaps:manifest   # regenerates public/basemaps/manifest.json
```

`--bbox` is `minLon,minLat,maxLon,maxLat`. The filename becomes the region's name in the app
(`north-wiltshire.pmtiles` → "North Wiltshire"), and the manifest records each archive's real
bounds, zooms and size by reading its header — so the published list can't drift from the files.
The manifest is also regenerated automatically by `npm run build`; commit it so `npm run dev`,
which serves `public/` without a build, shows the same list.

Once deployed, the app's map panel offers "Choose a region". The surveyor downloads what they
need, and the app then suggests switching when their GPS fix falls inside a different downloaded
region — it always asks, and never switches on its own.

Constraints worth knowing before you pick regions:

- **100 MB is a hard ceiling per file** — GitHub's limit. Git LFS is not a way around it: Pages
  serves LFS pointer files rather than the real bytes. Shrink the bbox or drop `--maxzoom` (each
  zoom level roughly quadruples the tile count) until it fits. A county at z15 is comfortably
  inside it; a country is not.
- **Every archive is permanent repo weight**, checked out on every CI run, so prefer several
  tight regions over one sprawling one.
- A newly deployed region appears only after the surveyor accepts the app's update prompt: the
  manifest is precached along with the rest of the build.
- **Never bulk-fetch tiles from `tile.openstreetmap.org` or OpenFreeMap** to build one. `pmtiles
extract` against Protomaps is the documented, ODbL-licensed, no-key route (see `CLAUDE.md`).
- The archive is deliberately excluded from the service-worker precache: Workbox would silently
  drop anything over 2 MiB, and precached responses can't serve the HTTP Range requests the
  pmtiles client reads archives with. IndexedDB is the store.

Map **labels** come from glyphs vendored into `public/fonts/noto-sans-regular/` (Noto Sans,
[OFL 1.1](https://openfontlicense.org/), from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets)) and precached, so they
render offline. The five committed ranges cover Latin and the punctuation place names use. A
region needing other scripts — Cyrillic, Greek, CJK — needs those ranges added to `GLYPH_RANGES`
in `src/map/glyphs.js`, then:

```sh
node scripts/fetch-glyphs.mjs
```

## Manual verification

Playwright's WebKit is not Safari and not iOS. Before signing off any phase, run through
[`docs/ios-manual-checklist.md`](./docs/ios-manual-checklist.md) on a real iPhone.

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via Actions (`.github/workflows/ci.yml`).
First-time setup: in the repo's Settings → Pages, set the source to "GitHub Actions".

## Data

Synced sessions land in a separate private repo (`njakeman/survey-data`), not this one — so a
compromised sync token can never rewrite the app that's deployed from here.
