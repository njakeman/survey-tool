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

**Verdict: every architecture-critical assumption from Phase 1 holds on this device.** No design
changes needed. Proceeding to Phase 2.

## Later phases (fill in as each lands)

- [ ] Phase 2 — app survives being backgrounded and killed mid-session with no data loss
- [ ] Phase 3 — GPS/compass reading and photo capture work with airplane mode on
- [ ] Phase 4 — map renders offline immediately after a fresh install, no network at all
- [ ] Phase 5 — sync completes on a real connection; killing the app mid-sync and reopening
      resumes without duplicating or losing observations
- [ ] Phase 6 — export via Web Share works for both a synced and an unsynced session; app storage
      surviving 2+ weeks of non-use (requires waiting, or trusting `persist()` above)
