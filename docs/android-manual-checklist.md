# Manual Android checklist

**Nothing on this page has been run.** It was written from a code audit (2026-08-17, extended
2026-08-24 for revisit mode and the trace-gap work) with no Android device available; every item
is a prediction, not a result. iOS is the design target and the sign-off gate — this file is what
turns Android from "un-blocked" into "verified", once a device exists. Fill in results the same
way `docs/ios-manual-checklist.md` does: tick the box and add the specific finding in bold, don't
just check it off silent.

**Test against `https://` only** — the LAN preview is `https://<LAN-IP>:4173/` and the deployed
site is HTTPS, but if anything ever serves this app over plain HTTP, revisit mode dies at the
reference load (`crypto.subtle` is secure-context-only, so hashing the picked zip throws) while
the rest of the app appears to work. A revisit failure on an HTTP origin is the test setup, not a
bug.

Playwright's `mobile-chrome` project (`playwright.config.js`, added alongside this file) proves
wiring at a mobile viewport with touch, on the engine Android Chrome ships — it is not a real
device and cannot exercise permission prompts, storage eviction, or a real magnetometer. This
checklist is what closes that gap, the same relationship the WebKit e2e project has to
`docs/ios-manual-checklist.md`.

Device/OS this will be run on: _not yet run_

**Include the trailing slash** on the preview URL — `https://<LAN-IP>:4173/`, not
`https://<LAN-IP>:4173`. `vite preview`'s static serving doesn't reliably resolve the bare origin
to `index.html`; the omission looked exactly like a broken/blank page during this pass and cost
real debugging time before the cause was found.

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
- [ ] **The screen stays awake while a trace records** (the wake lock, 2026-08-24 — Android
      Chrome has supported it since 84). Pause the trace and confirm the screen is allowed to
      lock again on its normal timeout.
- [ ] Background the app mid-trace (home button or app switch — Chromium stops geolocation
      callbacks whenever the page is not foregrounded), walk a stretch, return: the missed
      stretch draws **dotted** on the map, the one-line "Trace paused — the app was in the
      background" notice appears once and dismisses, and the saved observation exports with
      `trace_gaps` naming the stretch
- [ ] Pause → walk → Resume: the paused stretch also draws dotted, but **no** background notice
      appears — a deliberate pause explains itself

## Export / share

Three items that can only be answered on a device — Android's share sheet and Web Share
implementation differ from iOS's in ways the audit could not verify by reading source.

- [ ] **Dismissing the share sheet must not flip the Exported badge.** Android's share sheet does
      not reliably reject with `AbortError` the way iOS's does; `share.js`'s `cancelled: true`
      branch may never fire on Android. Note (2026-08-24): since `7d06c6b`, any share rejection
      that is _not_ an `AbortError` now falls through to the `<a download>` fallback rather than
      surfacing as a failure — so a dismissal Android reports as a generic error will land the
      zip in Downloads (and stamp the badge, honestly, because the bytes did leave the app). The
      defect to watch for is a dismissal that stamps **without** producing a file anywhere.
- [ ] Completing a share (or falling back to download) does flip the badge to Exported
- [ ] If `canShare({ files })` refuses the export zip and the app falls back to `<a
download>` — confirm the badge still stamps correctly on that path too. (On Android this
      fallback is arguably the _nicer_ outcome: the file lands in Downloads with no trapped
      preview sheet, unlike the iOS failure mode `share.js`'s header comment describes.)

## Import

- [ ] Import a session `.zip` exported from this same install. Some Android file providers report
      a zip as `application/octet-stream` rather than `application/zip` — both file inputs
      (`SessionHistoryPage.js` import and `RevisitSetup.js` reference pick) now include
      `application/octet-stream` in their `accept` lists for exactly this (2026-08-24); confirm
      the zip is actually pickable from Files/Drive/Downloads providers

## Revisit mode (2026-08-24, mirrors the iOS checklist's section)

- [ ] Start screen → "Revisit a survey" → "Load reference export" opens the system file picker
      from the **installed** app; picking a previous export shows its name, station/photo counts
      and date; picking a non-export file fails with a named reason (not a spinner, not silence)
- [ ] With a fix, the Nearest stations list shows believable distances and compass points
- [ ] "Start revisit session" opens capture with the station block: bearing arrow, distance,
      and the dated reference note (no plan diagram — dropped 2026-08-24 as superseded). No
      compass permission prompt exists on Android — confirm the arrow **tracks device rotation
      live while standing still** (it rides `deviceorientationabsolute`; caption ends `· live`)
- [ ] On a device with no usable compass: the arrow holds true bearing without `live`, then
      starts tracking from course-over-ground after walking a few metres — never pinned
- [ ] Walk toward the station: the distance falls and the arrow tracks; the current target does
      not jump between stations on GPS jitter
- [ ] "Frame the photo": the reference photo renders at size; "Take photo" opens the camera
      (`capture="environment"`); returning lands back on capture with the photo attached and the
      pairing strip armed. Android kills background activities under memory pressure much like
      iOS — verify state survives the camera round trip on a low-end device if one is available
- [ ] The framing screen clears the status bar and gesture bar (Android's translucent status bar
      in standalone mode is the analogue of the iOS notch item; same `env(safe-area-inset-*)`
      CSS, differently honoured)
- [ ] Save marks the station DONE (filled diamond on map and list); Undo reverts it to to-do
- [ ] Skip shows the dismissible line with Undo; "Can't reach it" confirms in place and takes an
      optional reason; the end-of-session summary shows all four outcomes
- [ ] Night mode: station diamonds legible on the dimmed canvas; station block follows the
      night palette; framing scrim unchanged
- [ ] A ~40-photo reference held across a full session: no crash, framing stays responsive,
      force-quit and relaunch reopens with guidance intact (the zip re-reads from IndexedDB)
- [ ] Export the revisit and re-import it elsewhere: it arrives as an ordinary closed session,
      observations carry `ref_obs_id`, and history names the referenced survey

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
