# Field Survey

Offline-first PWA for light location surveying in the field: GPS + compass readings, optional
photo and voice note, saved as a GeoJSON observation. Data leaves the phone through the share
sheet as a zip export and comes back through import — no server, no accounts, no network needed.
Built for iOS Safari, installed to the home screen. Live at
[survey.field.works](https://survey.field.works/).

See [`CLAUDE.md`](./CLAUDE.md) for the constraints that bind the implementation and
[`docs/styling.md`](./docs/styling.md) for the design system.

## Status

Field-usable offline. Capture (GPS/compass/photo/save, with in-place note editing on the open
session), session history, zip export **and
import** (plus [Load session](#import-a-session), which reopens a past or imported session to
add to it, and [session deletion](#import-a-session) — single, or a purge of the fully exported),
the offline basemap (with four [online basemaps](#offline-basemap) beside it — Esri aerial
imagery and three OpenFreeMap streetmaps), [feature layers](#feature-layers) (with
tap-to-inspect, an amber
selection highlight, and "Record here" — which for a polygon records the polygon's centroid, not
where you are standing), [OS grid references](#grid-references) and
[marking points you cannot reach](#marking-a-point-you-cannot-reach) are built. The map takes
standard gestures — one finger pans, pinch zooms — and the interface itself can never be
pinch-zoomed.

**Voice notes** ride on observations: record on the capture page (webm/opus at ~0.4 MB/min —
about half a photo per minute, measured on the device), hear it back before saving, play it from
the observations list afterwards. They store beside photos, travel in the export zip under
`audio/`, and import back like everything else. iOS keyboard dictation into the note field
remains the zero-code alternative for text.

**There is no sync and there will be none.** GitHub sync (and with it the encrypted personal
access token, the passphrase prompt and the Git Data API commit flow) was planned as Phase 5 and
deliberately dropped (2026-08-11): export to the device covers the need, with none of the token
handling. Data leaves the phone through the share sheet and comes back through
[Import](#import-a-session); the Exported badge on every observation says whether it has left
yet.

To see a map you must first produce basemap archives for your survey areas — see
[Offline basemap](#offline-basemap) below. Without any, the app works exactly as before and the
map panel simply offers to pick a region.

The app is in real field use on an iPhone, but the formal device pass lags the code:
`docs/ios-manual-checklist.md` is the gate, and it is unticked from Phase 3 onward.

**Trace modes** record a shape by walking it: _trace a path_ turns the walk into a line (a
hedgerow, a track, a watercourse); _trace a boundary_ walks a perimeter and closes it into a
polygon. Vertices are captured automatically from the GPS watch (accuracy-gated and
distance-thinned), the walk survives a force-quit, and a finished trace saves as an ordinary
observation — note, photo, voice note and feature link all attach as usual. The app also has a
**night mode** (a single-hue red scheme that preserves dark adaptation, map included) and draws
the live fix as a station-mark locator whose compass beam widens with the heading's uncertainty.

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

**Four online regions ride alongside the archives.** "Aerial imagery (online)" streams
[Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9)
tile by tile when there is signal (Bing was considered first, but its free tier was retired in
June 2025). "Light", "Simple" and "Dark" are [OpenFreeMap](https://openfreemap.org/)'s hosted
Positron, Liberty and Dark styles — labelled streetmaps, streamed the same way, used exactly as
their quick start intends (never bulk-fetched; their ToS is hostile to bulk collection, not to
per-tile streaming). Nothing is downloaded or cached for any of them — they go grey (or blank
paper, for the style-based three) with no connection, which is why none is ever suggested, never
a default, and all are disabled in the picker while offline. The map itself keeps working
regardless: overlays, feature layers and point-marking are identical over them, and an
unreachable provider can never take the app down — a streetmap style that cannot be fetched
degrades to a blank local ground with every overlay intact. Do not bulk-fetch or cache any of
their tiles for offline use — same rule as OSM. Offline imagery is a raster archive you produce
(below).

**Vector and raster archives both work.** A vector archive gives you styled roads, water and
labels; a raster archive (PNG or JPEG tiles — aerial imagery, a scanned map, a site survey) is
drawn as-is, with no labels beyond whatever is baked into the pictures. The type is detected from
each archive's header, along with the raster tile size, so there is nothing to declare. Note that
a region is one or the other: raster imagery is not currently composited over a vector basemap.
Vector data of your own goes on top as a [feature layer](#feature-layers) rather than as a second
archive — including over raster imagery, which is the case it exists for.

Produce a vector region with the [`pmtiles` CLI](https://github.com/protomaps/go-pmtiles) against
Protomaps' public daily planet build, into `public/basemaps/`, named for the area:

```sh
pmtiles extract https://build.protomaps.com/20260801.pmtiles public/basemaps/north-wiltshire.pmtiles \
  --bbox=-2.2,51.5,-1.6,51.8 \
  --maxzoom=15

npm run basemaps:manifest   # regenerates public/basemaps/manifest.json
```

A raster region comes from wherever your imagery does — `rio pmtiles` from a GeoTIFF, or
`pmtiles convert` from an MBTiles pyramid — dropped into the same directory and followed by the
same `npm run basemaps:manifest`.

Building a **vector** archive from your own data is a different exercise, and one with a sharp
edge: it renders blank here, because the style expects Protomaps' schema.
[docs/making-pmtiles.md](docs/making-pmtiles.md) covers the tooling on Windows and says plainly
what does and does not work.

`--bbox` is `minLon,minLat,maxLon,maxLat`. The filename becomes the region's name in the app
(`north-wiltshire.pmtiles` → "North Wiltshire"), and the manifest records each archive's real
bounds, zooms and size by reading its header — so the published list can't drift from the files.
The manifest is also regenerated automatically by `npm run build` and `npm run dev`; commit it
so the deployed list matches what you saw locally.

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
- An archive the generator cannot read is **warned about and skipped**, not fatal — one bad file
  costs you that region, never the deploy. Watch the build log for `SKIPPED`.
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

## Feature layers

Your own GIS data, drawn **over** whichever basemap is active and tappable. Parcels, designations,
monitoring points, a hedgerow network — the things that make an aerial photograph legible. This is
the answer for datasets up to a few thousand features; past that, see
[docs/making-pmtiles.md](docs/making-pmtiles.md).

A layer is one GeoJSON file plus an optional style sidecar, in `public/feature-layers/`:

```
public/feature-layers/
  parcels.geojson        # a FeatureCollection, EPSG:4326
  parcels.style.json     # optional — everything that cannot be measured
```

```sh
npm run layers:manifest   # regenerates public/feature-layers/manifest.json
```

(`npm run build` and `npm run dev` also regenerate it automatically — dropping the files in and
starting either is enough. Commit the regenerated manifest with the layer.)

Every key of the sidecar is optional:

| Key             | Default                | What it does                                           |
| --------------- | ---------------------- | ------------------------------------------------------ |
| `name`          | title-cased filename   | How the layer is listed in the app                     |
| `colour`        | `#1c5f9e`              | Fill, line, point and label colour                     |
| `lineWidth`     | `2`                    | Line and polygon-outline width                         |
| `fillOpacity`   | `0.15`                 | Polygon fill only — outlines are always solid          |
| `circleRadius`  | `5`                    | Point radius                                           |
| `labelProperty` | none                   | Which property to draw as a label on the map           |
| `titleProperty` | none                   | Which property titles the feature in the tap sheet     |
| `idProperty`    | the feature's own `id` | What gets recorded on an observation                   |
| `fieldOrder`    | alphabetical           | Which attributes show first in the tap sheet           |
| `minZoom`       | `0`                    | Hide the layer until this zoom — use it for dense data |

Don't set `colour` to `#c2611f`: that is the live GPS fix and its accuracy ring, and a layer in it
would scatter things across the map that read as "you are here".

In the app, **Change map → Maps and layers** lists every published layer. Switching one on fetches
it once into IndexedDB; after that it works with no network, and switching it off keeps the data so
it comes back offline too. _Remove_ is what reclaims the space, and is offered only for a layer
that is already switched off.

Tapping a feature highlights it on the map in amber, shows its attributes and offers
**Record here**, which starts an observation linked to that feature — the highlight stays on the
linked feature until Save or Unlink. For a **polygon**, Record here places the observation at the
polygon's centroid rather than where you are standing (you are at the gate; the parcel is the
record): it goes through the same marked-point path as the crosshair, `position_source: "map"`,
with an accuracy figure spanning the polygon, and "Use my position" before Save reverts it. The
link travels into the exported GeoJSON as `feature_layer`, `feature_id` and `feature_label`, so a
session can be joined back to the dataset it was surveyed against. Those three columns are
present on every observation, `null` where there is no link.

Three things that will bite:

- **Coordinates must be EPSG:4326.** British National Grid data exported without reprojecting is
  valid GeoJSON that lands in the Atlantic. The generator rejects out-of-range coordinates and
  names the fix — `ogr2ogr -t_srs EPSG:4326` — rather than publishing a broken layer.
- **The manifest is precached; the GeoJSON is not.** That is deliberate: the list has to be
  readable offline, and the data belongs in IndexedDB where there is no 2 MiB cliff.
- A layer the generator cannot read is **warned about and skipped**, never fatal — same rule as the
  basemap archives. Watch the build log for `SKIPPED`.

## Grid references

Every observation shows and exports an Ordnance Survey grid reference
(`SU 14082 39216`) alongside its latitude and longitude — on the live readout, on each
saved card, and as `os_grid_ref` in `session.geojson`. Computed offline, with no API key and no
request budget.

It is derived from the coordinates at display and export time rather than stored, because it is a
restatement of them and a stored copy could only drift. Outside Great Britain it is `null`, and
the column is still present in the export: a GIS consumer takes its schema from the rows it sees,
so a column that appears only for southern surveys is worse than a column of nulls.

The transformation is **OSTN15**, not a Helmert approximation. Projecting lat/lon onto the
National Grid gives ETRS89 eastings and northings — right projection, wrong datum, about 100 m
out. OSTN15 is the correction, and a single-parameter Helmert transform instead would leave 4–5 m
of error on a reading whose GPS accuracy is 5–10 m.

The shift grid is vendored from OS's **Lite** developer pack:

```sh
node scripts/fetch-ostn15.mjs
```

That downloads the pack, reduces it to `public/geodesy/ostn15-lite.json` (34 kB, precached), and
saves OS's 115 published test points to `src/geo/fixtures/` — `src/geo/osgb.test.js` checks every
one to within a millimetre. Lite rather than the full grid because the full transformation is a
13 MB pack or a 28 MB NTv2 file, and OS put Lite's error at 0.08 m RMS against it: around one
percent of the GPS error being transformed.

**Licence, honestly:** OS publish OSTN15 free of charge "as raw data for developers", and the
developer pack exists to be implemented in software. What is _not_ stated anywhere I could find —
neither the pack's user guide nor the resources page — is whether the grid may be redistributed
inside a repository. Other open-source implementations embed it, and the app carries the OS
OpenData attribution at the foot of the capture page. If you would rather carry no doubt at all,
add `public/geodesy/` to `.gitignore` and run the script as a setup step: the app degrades to
showing no grid references rather than breaking.

### Why not what3words

Asked and answered, so it does not get re-investigated. Two independent blockers:

- **No offline path.** what3words converts via their web API or their offline SDKs, and those SDKs
  are native iOS/Android/C++/Java. There is no JavaScript or WASM build at any price, so in a PWA
  a 3-word address can only resolve when there is signal — which is not when a surveyor is
  standing in a field tapping Save.
- **The licence forbids the useful part.** Clause 6.3(b) of the API licence: _"you must not
  display, or otherwise share with any third party, any 3 Word Address alongside its corresponding
  coordinates."_ Storage is permitted (6.3(e)(ii), up to 100 million), but this app's only outputs
  are a GeoJSON carrying `lat`/`lon`, shared as a zip and committed to a data repo. The pairing is
  the entire product.

Plus Codes (Apache-2.0, offline, no key) would clear both bars if a global short code is ever
wanted alongside the grid reference.

## Marking a point you cannot reach

A surveyor can often see a thing they cannot get to — the far side of a river, a pylon in standing
crop, a roof. **Mark a distant point** on the map panel puts a crosshair at the centre of the map;
pan the ground under it, check the grid reference and distance in the readout, and confirm. The
next Save records that point instead of the phone's position.

A crosshair rather than a tap because a gloved fingertip is a 44 px target that covers the thing
being aimed at. Follow mode switches off while picking, so an incoming GPS fix cannot drag the map
off the target.

The observation is otherwise completely ordinary. Two things differ:

- `gps_accuracy_m` holds the **map precision at the zoom it was picked at** — a few metres zoomed
  right in, tens of metres zoomed out — rather than a fix accuracy. Zooming in genuinely is a more
  precise placement, and the number reflects that.
- `position_source` is `map` rather than `gps`. Without it, a point eyeballed from 300 m away and
  a satellite fix would be indistinguishable, since the accuracy figure reads the same either way.
  Saved cards say "Marked on the map, not measured"; the column is on every observation.

`fix_at` and the heading still come from the surveyor's own fix — the sighting was made from
somewhere, at a time, and that is worth keeping. Altitude is dropped rather than carried across:
the far side of a valley is not at the height you are standing at.

## Fonts and styling

Two font families are vendored into `public/fonts/` and precached, because the app has to render
with no network at all — a hosted webfont would leave the interface in a fallback face in exactly
the situation the app exists for.

| Family                 | Where                             | For        | Script                          |
| ---------------------- | --------------------------------- | ---------- | ------------------------------- |
| Atkinson Hyperlegible  | `public/fonts/atkinson/`          | the UI     | `node scripts/fetch-fonts.mjs`  |
| Noto Sans (glyph .pbf) | `public/fonts/noto-sans-regular/` | map labels | `node scripts/fetch-glyphs.mjs` |

Both are [OFL 1.1](https://openfontlicense.org/) and both are committed — the scripts are run by
hand, not on install. Adding any asset means checking the precache count in the build output:
something unprecached is invisible on a laptop and missing in a field.

[`docs/styling.md`](./docs/styling.md) is the design record: the tokens, the type scale, every
component's treatment, and the constraints any future change has to keep.

## Manual verification

Playwright's WebKit is not Safari and not iOS. Before signing off any phase, run through
[`docs/ios-manual-checklist.md`](./docs/ios-manual-checklist.md) on a real iPhone.

## Android

iOS Safari is the target, but the app is deliberately web-standard and the automated browser
tests already run Chromium — the engine Android Chrome ships — so almost everything works there
today. The audit found the manifest (standalone display, portrait, a maskable icon), storage
(IndexedDB as ArrayBuffers, `persist()`), photo capture, voice notes (webm/opus is Chrome's
native recording format), Web Share with a download fallback, and the whole map stack need no
changes at all. What remains before Android could be called supported:

- [ ] **Compass.** `src/sensors/heading.js` listens only to `deviceorientation`; Android Chrome
      delivers absolute headings on the separate `deviceorientationabsolute` event (its plain
      event is relative), so the compass currently times out into "Position only — no compass".
      Fix: feature-detect `'ondeviceorientationabsolute' in window` and subscribe to that event —
      `toHeadingReading`'s existing `absolute` + `alpha` branch already converts the reading.
      Node tests via the file's existing fake-target pattern.
- [ ] **Standalone detection.** `src/main.js` passes bare `navigator.standalone` (an iOS-only
      flag) into the offline-status subscription, so an installed Android app reports
      `standalone: false` on the probe page. Use the existing `isStandalone()` from
      `src/probe/capabilities.js`, which already checks the standard
      `(display-mode: standalone)` media query.
- [ ] **A device pass.** An Android section in `docs/ios-manual-checklist.md`: install from
      Chrome's menu (the maskable icon should render uncropped), compass shows a heading after
      Start with no permission prompt, share-sheet export flips the Exported badge, the app
      launches offline from the icon, a screen-lock mid-trace comes back as one straight
      segment, voice notes record and play back.
- [ ] **A known cosmetic difference to accept.** Android reports no compass accuracy figure, so
      the locator deliberately draws its widest, faintest beam — the designed treatment for an
      unknown uncertainty, not a bug.

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via Actions (`.github/workflows/ci.yml`).
First-time setup: in the repo's Settings → Pages, set the source to "GitHub Actions". The app is
served at the root of the custom domain `survey.field.works` (a Cloudflare CNAME; the domain is
set in the same Pages settings — an Actions deploy ignores CNAME files, so there is none), which
is why `vite.config.js`'s `base` is `'/'`. Changing or removing the domain means changing `base`
with it: the two only work together.

## Import a session

Session history → **Import session** reads a previously exported zip (or a bare
`session.geojson`) back onto the device. It always creates a **copy** under fresh ids — importing
never overwrites or merges, importing twice yields two visible copies, and a session exported
mid-way arrives closed: it is an archive copy, not a continuation. A malformed file fails on the
Import tap with a named reason and writes nothing (one transaction). Since the export format
carries the session itself (`survey_session`, a GeoJSON foreign member), the copy keeps its name
and times; older zips without it are reconstructed from the features.

**Load session** is the continuation import deliberately is not: from a past session's detail
view (an imported copy included), it reopens that session in the capture interface so new
observations land in it. It is refused while another session is open — end the live session
first; nothing is ever closed for you. What was already exported keeps its Exported badge;
anything captured after loading honestly reads Not exported. While a session is open, each saved
observation's note can also be edited in place from the list (the one post-save amendment; the
history view stays read-only).

Sessions can also be **deleted** — permanently and locally, observations, photos and voice notes
together, behind a two-step confirm that states how many observations have never been exported
before you commit. **Delete exported sessions** clears every session whose observations have all
left the device (the same test the ✓ Exported badge uses), leaving anything unexported standing.
There is no undo: export first if the data matters.

## Data

Sessions live on the device and leave it only through export — there is no server, no token, and
nothing to sync. The exported zip (GeoJSON + photos) is the canonical interchange format, and
identical data always exports byte-identically, so exports are diffable and dedupable.
