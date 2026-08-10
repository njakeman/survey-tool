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
      **production build** reads `offlineReady: yes` with a non-zero precached-entry count; on
      `npm run dev` reads `offlineReady: no` with `precachedCount: 0` — confirms the diagnostic
      actually discriminates rather than always reporting "fine"

**Verdict: every architecture-critical assumption from Phase 1 holds on this device.** No design
changes needed. Proceeding to Phase 2.

## Phase 3 — capture

Needs a secure context to test real sensor permissions (geolocation, `requestPermission()`) — a
plain-HTTP LAN URL won't exercise them. Use the local HTTPS dev server (`npm run dev -- --host`,
now via `vite-plugin-mkcert`) or the deployed GitHub Pages URL once its deploy issue is resolved.

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
      mode**. **Must** be run against a production build: `npm run build && npm run
preview:mobile`, re-add to home screen from `https://<LAN-IP>:4173/survey-tool/` (a
      _different_ origin from the dev server's 5173 — the old icon won't pick this build up), and
      launch it once online before flipping on airplane mode so the service worker precaches. The
      plain dev server's SW precaches nothing by design (see CLAUDE.md) and will fail this check
      every time even though nothing is broken — this exact confusion produced a false bug report
      once already. If the capture page ever shows the red "No offline cache" banner, that's the
      app correctly telling you it's not this build's fault; open the probe page for the full
      readout.
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

## Later phases (fill in as each lands)

- [ ] Phase 4 — map renders offline immediately after a fresh install, no network at all
- [ ] Phase 5 — sync completes on a real connection; killing the app mid-sync and reopening
      resumes without duplicating or losing observations
- [ ] Phase 6 — export via Web Share works for both a synced and an unsynced session; app storage
      surviving 2+ weeks of non-use (requires waiting, or trusting `persist()` above)
