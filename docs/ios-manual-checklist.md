# Manual iOS checklist

Playwright's WebKit is not Safari and not iOS — it cannot exercise standalone display mode,
storage eviction, the permission prompts, or the Safari-version bugs that are the actual reason
iOS PWAs break. **Green CI is not iOS confidence.** Run this checklist by hand, on the real target
device, before signing off each phase.

Device/OS this was last run on: iPhone, iOS 26.x (2026-08-06)

## Install

- [x] Open the deployed URL in Safari, "Add to Home Screen"
- [x] Launch from the home screen icon — confirm standalone mode (no Safari chrome)
- [ ] Orientation locks portrait — not yet exercised (probe page doesn't lock orientation itself)

## Service worker updates (added after the update-race bug)

Not covered by e2e — reproducing it needs two successive builds served in sequence, which
Playwright's single `webServer` can't express cheaply. This is the only place it's actually
verified, and it directly exercises the fix in `src/sw/sw.js` / `vite.config.js`'s
`registerType: 'prompt'` / `App.js`'s reload banner.

- [ ] Launch the installed app once online (so the current build is fully precached), then deploy a
      change (any visible tweak works) and launch again: the app must offer a **"New version —
      Reload"** banner, not a blank page, not the red `Script error.` fatal-error screen, and no
      unstyled/broken page from a mismatched CSS/JS pair
- [ ] Tapping Reload actually picks up the new version (check the change landed) and does **not**
      lose whatever the surveyor was doing — a saved session/observations must still be there
      afterward
- [ ] Not tapping Reload leaves the app fully usable on the **old** version — a pending update must
      never be forced

## Phase 1 — capability probe

Run the probe page's checks in order, note results, then **force-quit and relaunch from the home
screen icon** (not a Safari reload) and re-run the checks that might differ across a cold launch.

- [x] Standalone detected as `true`
- [x] `storage.estimate()` returns a plausible quota — **41.2 GB**, not the stale ~50 MB figure
- [x] `storage.persist()` — **granted**, and still `true` after a real force-quit + relaunch
      (~5 min gap between sessions in the log)
- [x] Geolocation fix succeeds in standalone mode — **10.5 m accuracy, succeeded.** The open iOS 26
      regression (installed PWAs reporting denied) does **not** reproduce on this device.
- [x] Compass permission — **granted** on first tap, and **granted again with no re-prompt** after
      force-quit + relaunch. Permission survives a cold launch on this device/OS.
- [x] Web Share sheet — **completed** successfully with the test file attached.
- [x] Download — **not trapped.** Presented "More options → Save to Files", which got the user out
      cleanly. Clunkier than Share (one extra tap) but not the iOS 18.4 dead-end bug. Confirms
      download is fine as the secondary export path; Share stays primary as planned.
- [x] PBKDF2 600k-iteration benchmark — **128 ms.** No perceptible delay; a progress indicator at
      sync time is a nicety, not a requirement, on hardware this capable.
- [ ] Offline-ready readout (added after the dev-server-vs-offline confusion below) — on a
      **production build**, once settled (a moment after launch — `main.js` now waits for
      `serviceWorker.ready` rather than sampling instantly), reads `offlineReady: yes` with a
      non-zero precached-entry count; on `npm run dev` reads `offlineReady: no` with
      `precachedCount: 0` — confirms the diagnostic actually discriminates rather than always
      reporting "fine". The capture page's own banner must **not** flash on a fresh production
      install even for that first settling moment.

**Verdict: every architecture-critical assumption from Phase 1 holds on this device.** No design
changes needed. Proceeding to Phase 2.

## Phase 3 — capture

Needs a secure context to test real sensor permissions (geolocation, `requestPermission()`) — a
plain-HTTP LAN URL won't exercise them. Use the deployed URL, `https://survey.field.works/`
(the custom domain, as of 2026-08-12), as the primary target. The local
HTTPS dev server (`npm run dev -- --host`, via `vite-plugin-mkcert`) remains useful for
pre-deploy iteration, but see the offline-testing note below — it cannot substitute for a real
build.

**Before this round**, remove any home-screen icons added from earlier local ports
(5173/5174/5175/4173) — each is a distinct origin with its own service-worker registration and its
own IndexedDB, so observations saved against one won't appear in the Pages install. That's expected
storage isolation, not data loss; it's why `vite.config.js` now sets `strictPort: true` so a second
local server fails instead of silently opening yet another orphaned origin.

- [ ] The standalone-mode geolocation prompt appears once and readings flow (WebKit 215884 territory
      — this app deliberately has no client-side router/hash changes to avoid re-triggering it)
- [ ] Tapping "Start session" prompts for compass permission and the compass then reads plausibly
      (rotate the phone, check the bearing against a known landmark)
- [ ] Denying compass permission leaves the app fully usable, clearly marked "position only — no
      compass" (not silently missing, not blocking Save)
- [ ] `capture="environment"` opens the **rear** camera directly, not the photo library
- [ ] A real iPhone photo lands **right way up** at 1600px long edge (the EXIF orientation case —
      unit/browser tests proved this with a hand-built fixture on Chromium+WebKit, but a real
      camera photo is the actual proof)
- [ ] Full flow — start session, get a fix, take a photo, add a note, save — works in **airplane
      mode**. **Must** be run against a production build. Preferred: add
      `https://survey.field.works/` to the home screen and launch it once online before flipping
      on airplane mode so the service worker precaches. Local alternative:
      `npm run build && npm run preview:mobile`, re-add to home screen from
      `https://<LAN-IP>:4173/` (a _different_ origin from the dev server's 5173 — the old icon
      won't pick this build up). Either way, the plain dev server's SW
      precaches nothing by design (see CLAUDE.md) and will fail this check every time even though
      nothing is broken — this exact confusion produced a false bug report once already. If the
      capture page ever shows the red "No offline cache" banner, that's the app correctly telling
      you it's not this build's fault; open the probe page for the full readout.
- [ ] Force-quit mid-session and relaunch: the open session and every saved observation are still
      there (storage layer, not just capture UI)
- [ ] A 20+ observation session doesn't degrade; spot-check thermals/battery over ~30 min of a live
      GPS watch
- [ ] Readings are legible in direct sunlight; Save is hittable one-handed with gloves
- [ ] Undo (after a save) actually removes the observation and its photo, not just hides it
- [ ] The observations table accumulates correctly as you save, and scrolls horizontally rather
      than overflowing the screen on a narrow phone in portrait
- [ ] The photo picker reads "Take Photo" (not the browser-default "Choose File") and still opens
      the rear camera directly on tap

### Session history and export (added after first round of device feedback)

- [ ] Ending a session doesn't make it vanish — "Session history" lists it afterwards with the
      right date and observation count, current open session excluded from the list
- [ ] Tapping a past session in history shows its saved observations read-only
- [ ] Export (from the currently-open session, and from a past session in history) hands off a real
      `.zip` via the Share sheet — open it elsewhere (Files app, AirDrop to a Mac) and confirm it
      contains `session.geojson` plus one `photos/<id>.jpg` per observation with a photo
- [ ] **This is also the way to actually check photo orientation** (the original ask): open one of
      the exported JPEGs and confirm a portrait-held shot is stored right-way-up, not rotated
- [ ] If Share is dismissed/unavailable, the download fallback still produces the same zip

## Phase 4 — offline basemap

Needs at least one archive in `public/basemaps/` committed and deployed first, and ideally two
adjacent regions so switching can be exercised (see the README). Everything below is against the
real device; Playwright cannot exercise any of it.

**Download and offline render — the acceptance criterion**

- [ ] Fresh install (remove the home-screen icon, clear site data, re-add) shows the map panel
      offering "Choose a region", and the picker lists every published region with a plausible size
- [ ] Tapping a region shows progress and, on completion, it reads as on-device; returning to
      capture shows the map without a reload
- [ ] Force-quit, enable airplane mode, relaunch from the home screen: **the map renders
      immediately**, labels included, with no network at all
- [ ] **Vector regions:** place names and road names are legible — if labels are missing, the
      glyph ranges in `src/map/glyphs.js` don't cover this region's scripts
- [ ] **Raster regions** (e.g. `cissbury`): imagery draws at the right scale — features should sit
      where the GPS dot says they are, not at half or double size (that would mean the detected
      tile size is wrong), and zooming out should stop at the archive's lowest zoom rather than
      going blank

**Feel in the field**

- [ ] Map is readable in direct sunlight at arm's length
- [ ] One finger pans the map and pinch zooms it (the field verdict on the earlier two-finger
      scheme: unusable gloved — revisited 2026-08-12). The page still scrolls from outside the
      map panel
- [ ] Pinching anywhere — including a stray second finger while panning the map — never resizes
      the interface itself (viewport is pinned to `maximum-scale=1`)
- [ ] The map cannot be rotated or tilted by any gesture
- [ ] Panning stops at the edge of the extracted area rather than revealing blank grey
- [ ] Blue dot tracks position; the accuracy ring grows/shrinks sensibly when zooming
- [ ] Panning away reveals "Re-centre"; tapping it returns to the current fix and resumes following
- [ ] Saving an observation adds a marker without a reload; pending and synced markers are
      distinguishable
- [ ] Switching to Session history and back leaves the map visible and correctly sized (not blank,
      not a sliver)

**Several regions**

- [ ] Download a second region; the first stays on the device (both read as downloaded) and the
      map does not change on its own
- [ ] Switch regions from the picker — the new map draws, and the old one is gone rather than
      showing through
- [ ] Switch back and forth several times with the map on screen: memory holds up and the app is
      not killed in the background (this is the leak the per-region archive release exists to
      prevent, and a phone is the only place to see it)
- [ ] In airplane mode, the picker still lists the downloaded regions **by name**, and switching
      between them works with no signal
- [ ] Standing in a region that is not the active one, the map offers to switch and **waits** —
      it must never switch by itself. "Not now" dismisses it and does not nag again
- [ ] Removing a non-active region frees it; the region in use offers no Remove

**Degradation**

- [ ] With airplane mode on and nothing downloaded, the picker explains it needs a connection
      rather than offering downloads that cannot work
- [ ] Battery/heat: after ~15 minutes of continuous capture with the map on screen, the phone is
      not alarmingly hot and the app has not been killed in the background

## Feature layers

Nothing here has been seen on a device. The three that matter most are the tap target, sunlight
legibility and the label halo — all of them things a passing test says nothing about.

**Adding and removing**

- [ ] "Change map" opens **Maps and layers**, with regions above and feature layers below, and the
      two sections are obviously different kinds of thing (pick one vs. toggle any)
- [ ] Switching a layer on draws it over the basemap within a second or two — no visible progress
      UI is expected at this size, but nor should it feel hung
- [ ] Switching it off removes it cleanly; switching it back on **in airplane mode** works, which
      is the whole reason disable keeps the data
- [ ] Adding a layer that is not yet on the device is refused in airplane mode, with a reason
- [ ] Remove is offered only for a layer that is switched off, and frees the space

**Drawing**

- [ ] Over a **raster** region (your own imagery), polygon outlines and points are legible — this
      is the case the feature is for, and the case with no basemap labels to help
- [ ] Labels render at all over raster imagery. If they are missing, the raster style's `glyphs`
      declaration is the suspect — it is the exact silent failure it exists to prevent
- [ ] Labels are readable **against busy imagery**, i.e. the halo is doing its job
- [ ] In direct sunlight, a layer's colour is distinguishable from the accent-orange position dot
      at arm's length
- [ ] Several layers on at once stay individually distinguishable
- [ ] The live fix, the accuracy ring and saved observation markers are **always on top** of every
      feature layer, including where a filled polygon covers them
- [ ] Panning and zooming with layers on stays smooth; a dense layer with a `minZoom` disappears
      below it rather than stuttering

**Tapping**

- [ ] A gloved thumb hits a **point** feature reliably — this is the 10px query box, and the number
      is a guess until someone tries it
- [ ] A gloved thumb hits a **line** feature (harder: two pixels wide before tolerance)
- [ ] Tapping empty map dismisses the sheet
- [ ] The sheet does not block reading the map, and the page still scrolls behind it
- [ ] Attribute values that are long (a full address, a description) wrap rather than overflow
- [ ] A tap does not fire while panning — a drag that ends over a feature should not open the sheet

**Selection highlight (added 2026-08-12)**

- [ ] Tapping a feature highlights it on the map in amber — fill and rim for a polygon, a ring
      for a point — while its sheet is open
- [ ] The highlight survives "Record here" (stays on the linked feature until Save or Unlink)
      and clears on both
- [ ] The highlight never covers the position dot, the accuracy ring, or observation markers

**Record here**

- [ ] "Record here" prefills an empty note and shows the linked-feature strip above Save
- [ ] "Record here" on a **polygon** shows the "Marked on the map" strip: the saved observation
      sits at the polygon's centroid, not where you are standing, with `positionSource: "map"`
      and an accuracy spanning the polygon. "Use my position" before Save reverts to the fix
- [ ] "Record here" on a **point** feature records your own position, as before
- [ ] With a note already typed, the note is **not** overwritten
- [ ] The link survives typing, taking a photo, and dismissing the sheet
- [ ] Unlink removes the link and leaves the note and photo alone
- [ ] After Save, the link is gone — the next observation must not attach itself silently
- [ ] With no session open, the sheet still shows attributes but offers no "Record here"
- [ ] Export the session and open `session.geojson` in QGIS: `feature_layer`, `feature_id` and
      `feature_label` are present on every row, populated on the linked ones

## Grid references

The transformation itself is checked against Ordnance Survey's own 115 test points to within a
millimetre, so the arithmetic is not in doubt. What is in doubt is everything a screen does to it.

- [ ] Stand somewhere whose grid reference you can verify independently — a trig point, a gate on
      a 1:25,000 sheet, a known corner — and confirm the app agrees to the metre. This is the one
      check the test suite structurally cannot do: it proves the app is transforming _your_ fix,
      not that the formula matches a file
- [ ] The reference is legible at arm's length in sunlight, and the digits are distinguishable —
      8 against B is the pair that goes wrong when reading one out
- [ ] Reading one aloud over a phone or radio works without having to squint or re-check
- [ ] It updates as you walk, and does not lag the coordinates above it
- [ ] Saved cards show it, and it matches the live readout for the same spot
- [ ] Export a session and open `session.geojson` in QGIS: `os_grid_ref` is populated and correct
- [ ] In airplane mode from a cold launch, references still appear — the shift grid is precached,
      and if this fails that is why

## Marking a point you cannot reach

- [ ] "Mark a distant point" is findable without being told it exists, and the three map controls
      (Change map / Mark a distant point / Re-centre) **fit without overlapping**. Pan away from
      your fix first, so Re-centre is showing — with all three visible they came to roughly 380px
      across a 320px map before they were put in a wrapping row
- [ ] **The crosshair is fully clear of the confirm panel.** This is the reported bug: at 236px
      with a three-line panel, the reticle's target sat behind it and there was nothing to aim
      with. The map is 300px now and the crosshair a third of the way down
- [ ] **The point saved is the point under the crosshair.** Line the crosshair up on something
      identifiable — a gate, a corner, a pylon — confirm, save, then check the recorded grid
      reference against where you aimed. The reticle is deliberately not at the map's centre, and
      a ~50px disagreement between where it draws and what gets unprojected would be about 45 m of
      silent error at z17. Tests cover it; this is the one that would actually be believed
- [ ] The crosshair is visible over aerial imagery, over a pale vector basemap, and over a dark
      one — the arms are accent-coloured with a pale outline, and that is untested against real
      ground
- [ ] 300px of map still leaves the page comfortable — Save reachable without excessive scrolling
- [ ] Panning the map under the crosshair one-handed, with gloves, is actually workable. This is
      the interaction the whole feature rests on and the reason a tap was rejected
- [ ] The gap at the centre of the crosshair leaves the target visible rather than covering it
- [ ] The readout updates smoothly while panning, and does not stutter the map
- [ ] The distance reads plausibly for something you can see — pick a gate 200 m away and check it
      says roughly 200 m, not 2 km
- [ ] A GPS tick arriving mid-aim does **not** move the map. Wait a full minute with the crosshair
      lined up before confirming
- [ ] Cancel leaves everything as it was; confirm shows the strip above Save
- [ ] The mark survives typing a note and taking a photo
- [ ] "Use my position" reverts to the fix
- [ ] After saving, the strip is gone and the next observation records the phone's own position
- [ ] The saved card says "Marked on the map, not measured", and its accuracy figure is plausible
      for the zoom you picked at — a few metres zoomed right in, tens zoomed out
- [ ] Export and confirm `position_source` is `map` for those rows and `gps` for the others

## Microphone — deciding whether voice notes are possible

**ANSWERED 2026-08-11, on device, in standalone: the microphone works.** Five consecutive
recordings, `audio/webm;codecs=opus`, ~18.5 KB per 3 s ≈ **0.4 MB/min** — no works-once failure,
no empty recordings. Voice notes were green-lit on the back of this. The checks below stay for
re-verification after iOS updates.

**Must be run from the home-screen icon, in standalone.** That is the whole question: WebKit bug
185448 is "getUserMedia not working in apps added to home screen that run in standalone mode", and
Safari-the-browser working tells us nothing. Probe page → Microphone → "Record 3 s".

- [ ] **Run it in Safari first, then in standalone.** If it works in one and not the other, that
      is bug 185448 and it settles the question on its own
- [ ] The permission prompt appears, and granting it produces a recording with **non-zero bytes**.
      "getUserMedia resolved but no audio captured" is a different failure from a denial and the
      probe reports them separately — note which you got
- [ ] **Press it a second time, and a third.** Working once and then failing until the phone is
      restarted is the specific reported failure and the reason the check is re-runnable
- [ ] Record the mime type it chose and the measured **MB/min**. Against a photo's ~300 KB that
      figure is what decides whether voice notes are affordable
- [ ] Force-quit, relaunch, run it again — permission surviving a cold launch matters as much as
      it did for the compass
- [ ] The iOS recording indicator goes **out** when the check finishes. If it stays lit, a track
      is being left open and that is the likeliest cause of the works-once failure
- [ ] Note whether audio output jumps to the speaker during capture (a documented iOS behaviour
      with getUserMedia) — worth knowing before building anything that plays back

**Try this on the same trip, before any of the above matters:** tap the note field on the capture
page and use the **microphone key on the iOS keyboard** to dictate an observation.

- [ ] Dictation works in standalone, with the phone in airplane mode (on-device recognition)
- [ ] It is usable one-handed with gloves — this is the fiddly part, since it needs the keyboard up
- [ ] The dictated text is accurate enough for field vocabulary — place names, "stile", "coppice"

If that is good enough, voice notes may never be needed: dictation lands searchable text in the
`note` field, which exports and syncs, where an audio file is something a human has to sit and
replay.

## Online aerial imagery

"Aerial imagery (online)" in Maps and layers is Esri World Imagery streamed live — nothing stored,
so it only shows pictures while there is signal. The property that must hold is the inverse: **no
amount of missing signal may break the map.**

- [ ] With signal: select it from Maps and layers; imagery renders, the attribution ⓘ sits
      collapsed and expands on tap to the Esri credit, and the position dot, observations and any
      enabled feature layers draw over it
- [ ] Zoom to z19 and beyond — past the deepest tile it should go blurry, never blank or clamped
- [ ] **Airplane mode with imagery active, then relaunch:** the app opens, the map panel appears
      (grey tiles are fine), overlays and picking still work, and there is **no error banner**
- [ ] Still in airplane mode: switch to a downloaded region — it renders fully, no network needed
- [ ] In airplane mode the imagery row in Maps and layers is disabled, like an undownloaded region
- [ ] Marking a distant point over imagery: the crosshair readout and saved grid reference match
      the feature you aimed at (imagery is often the sharper basemap to aim on)

## Voice notes

Built on the probe result above. The probe proved the microphone; these prove the feature.

- [ ] Record a note with the phone-in-hand grip you actually use — are Record and Stop hittable
      with gloves?
- [ ] The player appears on stop; it plays back audibly (note whether through earpiece or
      speaker) and Remove discards it
- [ ] Save, then play the note from the observations list — and again after a force-quit relaunch
- [ ] The orange recording indicator goes **out** on Stop, on Cancel-by-leaving, and on Save
- [ ] Deny the mic permission once: the field shows the denial, Save still works
- [ ] Export a session with a voice note, import it back: the note plays on the copy
- [ ] Undo after saving a note: the recording is gone with the observation (no orphaned audio)

## Trace modes

Trace a path / trace a boundary (2026-08-12). The recorder, storage and round trip are all
unit/browser-tested; what only the device can prove is the GPS behaviour on a real walk and the
force-quit recovery path.

- [ ] Start a path trace and walk ~100 m: the point count climbs, the dashed accent line draws
      behind you, and the distance figure roughly matches the ground covered
- [ ] Stand still for a minute mid-trace: the count does **not** climb (GPS wobble smaller than
      the error bar must not add vertices)
- [ ] **Force-quit mid-trace, relaunch:** the "Unfinished trace found" strip appears; Resume
      continues **paused** with the walked points intact; walk on after resuming and the line
      carries on from where it stopped
- [ ] Pause, walk ~50 m, Resume, walk on: the line bridges the gap — **dotted** since 2026-08-24
      (a paused stretch is inferred ground, not measured), with no "app was in the background"
      notice (a deliberate pause explains itself)
- [ ] Boundary: walk a rough rectangle, Finish — it closes and saves; walk a deliberate
      figure-eight — the "crosses itself" warning shows and Save still works
- [ ] Finish a boundary after only two points: refused with the keep-walking message, still
      recording
- [ ] Save a trace with note + photo + voice note + feature link, export, import the zip back:
      the copy's traced row shows the same length and the annotations survive
- [ ] Open the exported `session.geojson` in QGIS: the line/polygon renders alongside the point
      observations and the `trace_length_m` column is populated on the traced row, null elsewhere
- [ ] Save an ordinary point observation mid-trace: it saves normally and the walk carries on
      unaffected
- [ ] **The screen no longer auto-locks while a trace records** (wake lock, 2026-08-24) — on
      iOS 18.4+ installed to the home screen; earlier iOS ignores the request silently and the
      dotted record below is the fallback. Pause the trace and confirm normal auto-lock returns.
- [ ] Lock the screen manually (side button — the wake lock cannot and should not prevent that)
      for 2 minutes mid-walk, unlock: the missed stretch draws **dotted**, the one-line "Trace
      paused — the app was in the background. That stretch is drawn dotted." notice appears once
      and dismisses, and the saved observation's export carries `trace_gaps` naming the stretch
      — note how long the watch takes to come back
- [ ] Switch to another app mid-walk and return: same dotted stretch + notice as the lock case
- [ ] Battery/thermals over a ~30 min continuous trace (extends the existing watch item — the
      trace adds only small writes, but the wake lock now keeps the screen on for the duration,
      which is a real battery cost; measure it rather than assuming)
- [ ] A pre-trace export (any old zip) still imports unchanged

## Second design pass — trace polish, night mode, locator, icon

Implemented 2026-08-12 (`docs/styling.md` → "The second design pass"); everything below is
styled state, so only eyes on the real screen can sign it off.

- [ ] **Trace strip in sunlight, gloved:** the walked total reads at arm's length; Finish is
      unmistakably the primary action; the discard confirm replaces the row without anything
      shifting under the thumb at 320px-class widths
- [ ] The chooser panel reads as a question, not leftover buttons; Cancel dismisses; the
      path/boundary descriptions make sense to someone who has never traced
- [ ] **Trace-line casings over dark ground:** switch to Esri aerial with a saved exported trace,
      a saved unexported one and a live walk — all three lines visible, solid-vs-dashed legible,
      at both z12 and z19; a dashed feature-layer parcel boundary next to a dashed trace still
      reads as two different lines
- [ ] Two recordings at once (voice note mid-trace): the two dots breathe at visibly different
      tempi and the screen does not read as one flashing interface
- [ ] **Night mode, in actual darkness:** toggle Night in the footer — nothing on screen is
      white or blue, the map dims to red-on-black but stays readable as terrain, the danger and
      suggestion panels show no pale ground, and the choice survives a force-quit and relaunch
- [ ] Night mode's status bar: the clock/battery glyphs stay white (OS-owned) — confirm the
      field-notes advice stands: the iOS **Red Filter** accessibility shortcut is the lever
- [ ] **Locator:** the station mark holds on pale vector and dark aerial alike (the casing is
      what to judge); the beam width visibly opens when the compass is disturbed (wave the phone
      near a car door); with compass denied there is **no** beam; after 30 s under a roof the
      mark goes hollow-and-dashed as the readout goes stale
- [ ] The beam tracks turning smoothly, and with Reduce Motion on it steps rather than freezes
- [ ] **Beam in direct sunlight** (field fixes 3): with the phone in full sun, the wedge's
      outline is legible on the pale vector ground and on aerial imagery, at the trusted 60°
      and after disturbing the compass to the wide, faint 120° — the edge is what to judge, the
      fill is allowed to wash out
- [ ] **Locator at night:** in Night mode the mark's ring, ticks and beam outline show as the
      red night tokens, not as a dimmed grey — noticeably brighter than the tiles beneath
- [ ] **Icon:** remove the old home-screen icon, re-add from the site — the station-mark icon
      shows on the home screen and the splash; check it reads at a glance in a full app grid
- [ ] Export moved to the page foot: confirm exporting the open session still works end-to-end
      from there (share sheet, badge flip)

## Online streetmaps, compact attribution, Load session, note editing (2026-08-12)

Four additions in one pass: three OpenFreeMap basemaps (Light/Simple/Dark) beside the aerial
imagery, the attribution control starting collapsed, reopening a past session from history, and
editing a saved observation's note.

- [ ] **Attribution everywhere:** on every basemap (archive, imagery, the three streetmaps) the
      map opens with the ⓘ collapsed; tapping it shows the right credit (OpenFreeMap ©
      OpenMapTiles / OSM on the streetmaps, Esri on imagery, OSM · Protomaps on a vector
      archive); tapping again collapses it
- [ ] **Each streetmap renders with signal:** Light, Simple and Dark all show labelled streets
      at survey zoom; overlays (fix marker, observations, traces, feature layers) draw over all
      three; Dark under night mode still reads as terrain
- [ ] A labelled feature layer over a streetmap shows its labels (their glyph server, not ours —
      the silent-failure case)
- [ ] **Airplane mode with a streetmap active, then relaunch:** the app opens on a blank paper
      ground with **no error banner**; the fix marker, saved observations and feature layers all
      still work; switching to a downloaded region renders fully
- [ ] In airplane mode the three streetmap rows are disabled, like imagery
- [ ] **Load session:** end a session, open it from history — Load session returns to capture
      with its name in the bar, its observations listed, and new saves landing in it; the
      already-exported rows still read Exported, the new save Not exported
- [ ] With a session open, the Load button in history is disabled and says to end the current
      session first
- [ ] Load an **imported** session and add an observation to it — the continuation path import
      deliberately does not provide
- [ ] **Edit note, gloved:** on a saved row, Edit note opens the note in place pre-filled; Save
      note persists (still there after force-quit relaunch); Cancel discards; Add note appears
      on a bare row; the history view offers no editing anywhere
- [ ] An edited note survives the export/import round trip with the edited text

## Muted-error banner fix and session deletion (2026-08-12)

The intermittent red "Something went wrong loading the app: Script error. (:0:0)" around the
share sheet was WebKit's sanitized cross-origin error payload reaching an unfiltered global
handler — never app code. Muted events (null error, no filename) are now ignored with a console
warning; real errors keep the banner, which remains the only diagnostics channel on an installed
PWA.

- [ ] Export/share a session several times, completing and dismissing the sheet — the red
      banner never appears (a connected Web Inspector may log "Ignored muted cross-origin
      error", which is the fix working, not a fault)
- [ ] **Delete a session** that has photos and voice notes: two-step (Delete session → Delete
      permanently), gone from the list, still gone after a force-quit relaunch, and device
      storage actually shrinks (Settings → Safari or the probe page's estimate)
- [ ] Deleting a never-exported session states "N observations have never been exported" before
      the red commit; Keep session backs out without deleting
- [ ] **Delete exported sessions** appears only when at least one session reads ✓ Exported;
      the confirm tap names the count; unexported and partly exported sessions are left standing
- [ ] Delete an imported copy — the original session (if still on the device) is untouched
- [ ] With a session open, its row is absent from history as ever — confirm there is no route
      to deleting the live session

## Later phases (fill in as each lands)

- [ ] Phase 6 — app storage surviving 2+ weeks of non-use (requires waiting, or trusting
      `persist()` above)

## Import a session

Session history → Import session. GitHub sync was dropped (2026-08-11); export + import is the
whole transport, so this round trip is what stands between a broken phone and lost data.

- [ ] Export a real session (photos included), save the zip to Files, then Import it back:
      the copy appears with the same name, observations and photos, badged **Not exported**
- [ ] The badge flips: after exporting a session, its rows read **✓ Exported** and the map
      markers fill in; save one more observation and it alone reads Not exported
- [ ] Dismissing the share sheet does **not** flip anything — the data went nowhere
- [ ] Import the same zip twice: two copies listed, nothing merged or overwritten
- [ ] Import garbage (rename a photo .zip): a named failure on the Import tap, nothing listed
- [ ] Works offline end to end — export to Files and import from Files, airplane mode on

## Photo viewing (2026-08-14)

A saved photo is now viewable in-app: Show photo on the row loads the thumbnail, tapping it
opens the full-screen view. Same behaviour in the open session's list and in a history detail.

- [ ] Show photo on a saved row loads the photo, the right way up — a portrait photo taken
      on-device is the EXIF case that no desktop test exercises
- [ ] Tapping the thumbnail opens the full-screen view; Close (and a tap beside the photo) is
      hittable with gloves; a tap ON the photo does not dismiss it
- [ ] Works in airplane mode — the bytes come from IndexedDB, not the network
- [ ] A session with ~20 photos: open and close many thumbnails in a row without the PWA being
      memory-killed (the load is per-tap, so scrolling the list alone loads nothing)
- [ ] The same photo opens from Session history → detail, read-only view unchanged otherwise
- [ ] Night mode: thumbnail and full-screen photo are dimmed, not red-shifted, and the Close
      control follows the night button treatment

## History map (2026-08-14)

Session history → tap a session: the detail now opens with that session's observations on a
read-only map above the list, on whichever basemap is currently active.

- [ ] The map opens fitted to the session's observations — points and whole traced shapes in
      frame, not the archive's own centre
- [ ] Filled vs hollow markers and solid vs dashed trace lines match the export badges on the
      rows below
- [ ] A single-observation session opens at a readable zoom (survey zoom), not a world view
- [ ] Pan and zoom work; nothing follows the live position; no controls, locator or feature
      layers appear
- [ ] Night mode dims and reddens the history map exactly like the capture map, and trace
      casings flip dark
- [ ] With an online basemap active and airplane mode on: the map frame still appears and the
      markers/traces draw over the fallback ground (provider unreachable must not break the page)
- [ ] An imported session from outside the active archive's coverage clamps to the archive edge
      rather than showing a grey void
- [ ] With no basemap configured at all, the detail shows no map panel and no placeholder — the
      observations list is unchanged

## Region switch keeps the view + empty sessions (2026-08-14)

- [ ] Pan somewhere specific (follow off), switch to Esri Aerial: the imagery appears under the
      same view — no jump to the North Pennines; zoom unchanged
- [ ] Switch between two online basemaps and back: view held each time
- [ ] With follow ON, switch region: at most a short settle onto the fix — no cross-country
      flight from the region centre
- [ ] Switch to an offline region that does NOT cover the current view: the map clamps to the
      archive's edge (its bounds still bind)
- [ ] Start a session, record nothing, tap End session: the confirm reads "Nothing recorded —
      discard session"; after confirming, Session history shows no trace of it
- [ ] Start a session, save one observation, End: confirm reads "Confirm end session" as before
- [ ] With a fresh session (0 saved), the footer Export is disabled with "Nothing to export
      yet — save an observation first"; after one save it enables and the hint goes
- [ ] A pre-fix empty session in history (if one exists): detail Export disabled with "Nothing
      recorded in this session"; Delete session still works on it

## Design pass 3: gating, the recorder, Path/Boundary, the display row (2026-08-14)

- [ ] Fresh launch, no session: only the start form, readings, map and the "position above is
      live" line — no note field, Photo, Voice note, Path/Boundary or Save anywhere
- [ ] Start a session: the whole capture block appears (note, Photo · Voice note two-up,
      TRACE A LINE ALONG THE GROUND with Path and Boundary, Save)
- [ ] With a session running there is no Session history control; ending the session brings the
      history button back with its session count
- [ ] With an unexported session on the device, the history button shows the dashed "N unsent"
      badge; after exporting everything the badge is gone and the count reads "N sessions"
- [ ] Voice note: idle button shows the mic glyph; recording shows the accent-edged transport
      row with the elapsed timer and an accent Stop; a recording plays back in the native
      player; the ✕ deletes it
- [ ] Path starts a path walk in one tap; while it records, Boundary stands down dashed and the
      strip sits in the trace group's slot; gloves still land all of Finish/Pause/Discard
- [ ] Display row: Auto · Light · Dark · Night, all four tappable with gloves; the checked cell
      is inked and bold
- [ ] Forced Light on an OS-dark phone: launches straight into the paper palette with **no dark
      flash**, and the status bar area matches (no dark strip above a paper page)
- [ ] Forced Dark on an OS-light phone: same in reverse
- [ ] Auto's caption reads "Following the system — light/dark" and flips when the OS scheme
      changes while the app is open
- [ ] Night still enters and leaves only by its own tap; leaving Night lands on whatever the
      row says, never on a surprise scheme

## Design pass 4: the saved row, the transport, the photo view (2026-08-14)

- [ ] The Photo button no longer overhangs its column, and Photo · Voice note sit at equal
      heights (the box-sizing fix — check the basemap picker rows and the history button too)
- [ ] Rotate to landscape mid-session: the map shrinks and the readings, note and Save stay
      reachable — the app draws, compressed, rather than refusing
- [ ] A saved row shows one attachment line: photo chip, voice chip (with its duration for a
      new recording), Edit note at the right — three stacked orange links gone
- [ ] Tap the photo chip: a 64px square thumbnail, not a 180px block
- [ ] Tap the thumbnail: the full-screen view **covers the whole page** — the original bug —
      with the ✕ top-right inside the notch inset, and the time · grid ref caption
- [ ] Retake opens the camera directly; after shooting, the open view swaps to the new image
- [ ] Delete asks (Delete photo / Keep it, replacing Retake's row), closes on commit, and the
      row then offers Add photo as a link; adding one lands back on a chip
- [ ] On an exported session, a retake flips the row (and the session in history) to
      CHANGED SINCE EXPORT; re-exporting returns it to ✓ EXPORTED; "Delete exported sessions"
      refuses it while changed
- [ ] Voice note recording: the bars animate as a repeating pattern with the timer counting;
      Stop is the accent; the recorded row is the drawn transport (play/pause, bars darkening
      with position, times) — no grey iOS pill anywhere
- [ ] A voice note on a saved row: chip → transport on tap; plays and pauses on iOS; a note
      recorded before this pass reads "Voice note" on its chip and still plays
- [ ] An old export (no audio_duration_ms) still imports; a new export imported back shows the
      duration on the copy's chip

## Field fixes 2 (2026-08-14)

- [ ] History detail: the session's read-only map is actually visible (it was a zero-width
      band), full width, observations fitted
- [ ] History list and detail: the back bar stays pinned under the status bar while scrolling
      a long list; nothing scrolls above it; the photo view still covers it
- [ ] Delete a photo, then Add photo: the new shot appears as the 64px thumbnail immediately —
      no second tap on a chip
- [ ] Add the same photo twice in a row (cancel between): the second pick still registers
- [ ] On an exported session, retake a photo: the row chip reads CHANGED SINCE EXPORT in
      warning ink, its map marker goes hollow, Export's footer hints "export again", and after
      ending the session the history button carries the changed chip
- [ ] The purge button names its count before the first tap ("Delete 2 exported sessions")
- [ ] Device probe → storage row: Persistent storage reads yes on the installed app (the app
      now requests it at launch)
- [ ] With two or more saved observations: the OBSERVATIONS row flips the list newest-first,
      the choice survives a relaunch, and the toggle is absent below two rows

## Revisit mode (2026-08-21)

Run against `https://survey.field.works/`, installed to the home screen, with a real previous
export zip in the Files app.

- [ ] Choose "Revisit a survey" → "Load reference export" opens the Files sheet in standalone
      mode; picking the zip shows its name, station/photo counts and date; a non-export file
      fails with a named reason, not a dead tap
- [ ] With a fix, Nearest stations lists real distances and compass points before starting
- [ ] Start revisit session: the compass prompt still appears (the pick did not consume the
      gesture); the station block aims at the nearest station with the arrow, distance and the
      dated reference note (no plan diagram — dropped 2026-08-24 as superseded)
- [ ] **Stand still and rotate the phone**: the arrow tracks the rotation live (compass-driven,
      caption ends `· live`), turning the short way across north, never spinning the long way
- [ ] **Deny compass** (decline the prompt, or Settings → Safari → Motion & Orientation off):
      the arrow holds at true bearing with the `bearing 038°` caption and no `live`; after
      walking a few metres it starts tracking again from course-over-ground — it is never
      pinned at a stale angle
- [ ] Walk toward the station: the distance falls, the arrow tracks, and the current target does
      NOT jump to a different station on GPS jitter
- [ ] Frame the photo: the reference photo renders at size from the stored zip; Take photo opens
      the rear camera; returning from the camera lands back on capture with the photo attached
      and the pairing strip still armed (memory pressure is the risk — an in-memory photo and a
      portal are exactly what iOS sheds)
- [ ] Framing screen respects the notch and home-bar insets; the shutter is reachable
      one-handed
- [ ] Save marks the station DONE on the map (filled diamond) and in the list; Undo reverts it
      to a hollow to-do
- [ ] Skip shows the dismissible line with Undo; Can't reach it asks first, takes a reason, and
      the summary at End shows all four outcomes
- [ ] Night mode: the station diamonds stay legible on the dimmed canvas; the station block
      follows the night palette; the framing screen's scrim is unchanged
- [ ] A ~40-photo reference held across a full session: no crash, framing stays responsive, and
      a force-quit mid-session reopens with guidance intact (the zip is re-read from IndexedDB)
- [ ] Export the revisit; re-import the export elsewhere: it arrives as an ordinary session
      whose observations still carry ref_obs_id; history names the referenced survey
- [ ] Sunlight: the segmented summary bar's three textures are distinguishable outdoors
