# Manual Android checklist

**Nothing on this page has been run.** It was written from a code audit (2026-08-17) with no
Android device available; every item is a prediction, not a result. iOS is the design target and
the sign-off gate — this file is what turns Android from "un-blocked" into "verified", once a
device exists. Fill in results the same way `docs/ios-manual-checklist.md` does: tick the box and
add the specific finding in bold, don't just check it off silent.

Playwright's `mobile-chrome` project (`playwright.config.js`, added alongside this file) proves
wiring at a mobile viewport with touch, on the engine Android Chrome ships — it is not a real
device and cannot exercise permission prompts, storage eviction, or a real magnetometer. This
checklist is what closes that gap, the same relationship the WebKit e2e project has to
`docs/ios-manual-checklist.md`.

Device/OS this will be run on: _not yet run_

## Install

- [ ] Open the deployed URL in Chrome, use the browser menu's "Install app" (there is no custom
      install prompt — `beforeinstallprompt` is deliberately out of scope, see README → Android)
- [ ] Launch from the home screen icon — confirm standalone display mode, no Chrome chrome
- [ ] The maskable icon renders **uncropped** inside Android's adaptive-icon safe circle (the
      icon is deliberately scaled to 70% with the ground bleeding to the edge for this —
      `vite.config.js`'s manifest comment)
- [ ] Orientation locks portrait (the manifest declares it, and Android — unlike iOS — actually
      honours it; the landscape CSS fallback at `style.css`'s `@media (orientation: landscape)`
      block was written because iOS _can't_ lock, so expect it to simply never trigger here)

## Compass

- [ ] Tapping "Start session" acquires a heading with **no permission prompt** (Android has none;
      `requestHeadingPermission` returns `not-required`) and the locator beam is the **narrow,
      confident** shape, not the wide/faint fallback — confirms the reading is coming through
      `deviceorientationabsolute`, not silently timing out
- [ ] Rotate the phone and check the bearing against a known landmark
- [ ] **Accepted, not a bug**: Android reports no compass accuracy figure at all
      (`headingAccuracyDeg: null` on every reading), so the locator always draws its widest,
      faintest beam even with a good fix — the designed treatment for unknown uncertainty
      (`map/locator.js`). Confirm it reads as "less precise than iOS", not as broken.

## Offline / launch

- [ ] Full capture flow — start session, get a fix, take a photo, add a note, save — works in
      **airplane mode**, against a production build launched from the home screen (same
      production-build requirement as iOS; `npm run dev`'s SW precaches nothing)
- [ ] Force-quit mid-session and relaunch: the open session and every saved observation are still
      there
- [ ] `navigator.storage.persist()` — check the probe page's Storage row. Android grants this on
      engagement heuristics (recent visits, bookmarks, installs), **not** the silent grant iOS
      gives installed PWAs — plausible it reads **denied** on a fresh test install even though
      the code path is identical. Not a bug if so; note the result rather than assuming success.
- [ ] Probe page's Standalone row reads **yes** when launched from the home screen

## Voice notes

- [ ] A voice note records and plays back. Expect `audio/webm;codecs=opus` to be selected (it is
      first in `RECORDING_MIME_CANDIDATES` and is Android Chrome's native format) — confirm via
      the probe page's recording-types list, and note the actual container if it differs

## Trace mode

- [ ] Walk a short path trace, finish, save — the traced observation survives a reload
- [ ] Lock the screen mid-trace: the gap comes back as one straight segment on resume, same as
      the documented iOS behaviour (Android's background-suspend behaviour for `watchPosition`
      differs from iOS's, so this is worth confirming rather than assuming it matches)

## Export / share

Three items that can only be answered on a device — Android's share sheet and Web Share
implementation differ from iOS's in ways the audit could not verify by reading source.

- [ ] **Dismissing the share sheet must not flip the Exported badge.** Android's share sheet does
      not reliably reject with `AbortError` the way iOS's does; `share.js`'s `cancelled: true`
      branch may never fire on Android. If dismissing the sheet stamps `lastExportedAt` anyway,
      that is a data-honesty defect (CLAUDE.md: "a dismissed share sheet stamps nothing" is
      non-negotiable) and needs a real fix, not a shrug.
- [ ] Completing a share (or falling back to download) does flip the badge to Exported
- [ ] If `canShare({ files })` refuses the export zip and the app falls back to `<a
download>` — confirm the badge still stamps correctly on that path too. (On Android this
      fallback is arguably the _nicer_ outcome: the file lands in Downloads with no trapped
      preview sheet, unlike the iOS failure mode `share.js`'s header comment describes.)

## Import

- [ ] Import a session `.zip` exported from this same install. Some Android file providers report
      a zip as `application/octet-stream` rather than `application/zip` — check whether
      `SessionHistoryPage.js`'s file-input `accept` list greys the file out; if so this needs a
      fix (broaden the `accept` list or drop MIME filtering in favour of extension only)

## Layout

- [ ] The sticky session-history header (`.session-history .page-header`, `style.css`) does not
      slide under the status bar. It has no `env(safe-area-inset-top)` of its own — on iOS the
      whole-page `body` padding happens to cover for it; confirm whether Android's translucent
      status bar in standalone mode exposes the gap. This is shared code with iOS and may simply
      never have been noticed there — do not pre-emptively "fix" it before confirming it's real.
- [ ] Pinch-to-zoom the interface itself (not the map) with two fingers on a non-map surface.
      `maximum-scale=1, user-scalable=no` (`index.html`) is known to be ignored by Android Chrome
      by default, so the stray-second-finger zoom the meta was added to prevent may return. Note
      whether it's actually reproducible and how disruptive it is before treating it as a defect.
- [ ] Pull down from the top of a **browser-tab** (not installed) view of the app — confirm it
      does **not** refresh the page (the `overscroll-behavior-y: contain` fix, scoped to
      `@media (display-mode: browser)`). Then confirm the same gesture in the **installed** app
      still bounces normally — the scoping should make this a no-op there.
- [ ] Long-press a button or a photo-control label — confirm no text-selection popup appears.
      Long-press a coordinate or grid-reference readout — confirm selection **does** still work
      there (deliberately not suppressed, for copying a reference off the screen in the field).

## Known differences to accept, not fix

- No compass accuracy figure (see Compass, above) — `locator.js` already handles a null accuracy
  correctly.
- No custom install prompt — Chrome's own "Install app" menu entry is the path.
- `screen.orientation.lock()` is not called — unnecessary, since Android already honours the
  manifest's portrait lock.
