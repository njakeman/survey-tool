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
plain-HTTP LAN URL won't exercise them. GitHub Pages deploys are working again (as of 2026-08-10)
— use the deployed URL, `https://njakeman.github.io/survey-tool/`, as the primary target. The local
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
      `https://njakeman.github.io/survey-tool/` to the home screen (now that Pages deploys work
      again) and launch it once online before flipping on airplane mode so the service worker
      precaches. Local alternative: `npm run build && npm run preview:mobile`, re-add to home
      screen from `https://<LAN-IP>:4173/survey-tool/` (a _different_ origin from the dev server's
      5173 — the old icon won't pick this build up). Either way, the plain dev server's SW
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

Needs `public/basemap.pmtiles` committed and deployed first (see the README). Everything below is
against the real device; Playwright cannot exercise any of it.

**Download and offline render — the acceptance criterion**

- [ ] Fresh install (remove the home-screen icon, clear site data, re-add) shows the map panel
      offering "Download offline map" with a plausible size
- [ ] Tapping it shows progress and, on completion, the map appears without a reload
- [ ] Force-quit, enable airplane mode, relaunch from the home screen: **the map renders
      immediately**, labels included, with no network at all
- [ ] Place names and road names are legible — if labels are missing, the glyph ranges in
      `src/map/glyphs.js` don't cover this region's scripts

**Feel in the field**

- [ ] Map is readable in direct sunlight at arm's length
- [ ] One finger dragging over the map scrolls the _page_; two fingers pan the map (a "use two
      fingers" overlay appears on a one-finger drag). Confirm this is right with gloves on —
      if two-finger panning is unusable gloved, say so and we'll revisit
- [ ] The map cannot be rotated or tilted by any gesture
- [ ] Panning stops at the edge of the extracted area rather than revealing blank grey
- [ ] Blue dot tracks position; the accuracy ring grows/shrinks sensibly when zooming
- [ ] Panning away reveals "Re-centre"; tapping it returns to the current fix and resumes following
- [ ] Saving an observation adds a marker without a reload; pending and synced markers are
      distinguishable
- [ ] Switching to Session history and back leaves the map visible and correctly sized (not blank,
      not a sliver)

**Degradation**

- [ ] With airplane mode on and no archive downloaded, the panel explains it needs a connection
      rather than offering a download that cannot work
- [ ] Battery/heat: after ~15 minutes of continuous capture with the map on screen, the phone is
      not alarmingly hot and the app has not been killed in the background

## Later phases (fill in as each lands)

- [ ] Phase 5 — sync completes on a real connection; killing the app mid-sync and reopening
      resumes without duplicating or losing observations
- [ ] Phase 6 — export via Web Share works for both a synced and an unsynced session; app storage
      surviving 2+ weeks of non-use (requires waiting, or trusting `persist()` above)
