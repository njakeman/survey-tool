# Manual iOS checklist

Playwright's WebKit is not Safari and not iOS — it cannot exercise standalone display mode,
storage eviction, the permission prompts, or the Safari-version bugs that are the actual reason
iOS PWAs break. **Green CI is not iOS confidence.** Run this checklist by hand, on the real target
device, before signing off each phase.

Device/OS this was last run on: _(fill in)_

## Install

- [ ] Open the deployed URL in Safari, "Add to Home Screen"
- [ ] Launch from the home screen icon — confirm standalone mode (no Safari chrome)
- [ ] Orientation locks portrait

## Phase 1 — capability probe

Run the probe page's checks in order, note results, then **force-quit and relaunch from the home
screen icon** (not a Safari reload) and re-run the checks that might differ across a cold launch.

- [ ] Standalone detected as `true`
- [ ] `storage.estimate()` returns a plausible quota (not the pre-2023 ~50 MB figure)
- [ ] `storage.persist()` — result, and whether it changes after relaunch
- [ ] Geolocation fix succeeds in standalone mode — **this is the open iOS 26 regression risk**;
      if it reports denied here but works in Safari on the same device, stop and report back
      before building Phase 3 on top of it
- [ ] Compass permission prompt appears on first tap; note the result before and after relaunch
- [ ] Web Share sheet opens with the test file attached; note what happens if the target is Files
      vs AirDrop vs Mail
- [ ] Download — click it and confirm whether the app becomes trapped in a preview sheet with no
      way back (known failure mode; if it traps, this confirms Web Share must stay the primary
      export path)
- [ ] PBKDF2 600k-iteration benchmark — record the time; this sets the UX expectation for sync

## Later phases (fill in as each lands)

- [ ] Phase 2 — app survives being backgrounded and killed mid-session with no data loss
- [ ] Phase 3 — GPS/compass reading and photo capture work with airplane mode on
- [ ] Phase 4 — map renders offline immediately after a fresh install, no network at all
- [ ] Phase 5 — sync completes on a real connection; killing the app mid-sync and reopening
      resumes without duplicating or losing observations
- [ ] Phase 6 — export via Web Share works for both a synced and an unsynced session; app storage
      surviving 2+ weeks of non-use (requires waiting, or trusting `persist()` above)
