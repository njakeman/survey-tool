# Starting prompt — field survey PWA

Paste everything below the line into Claude Code as your first message.

---

I want to build a progressive web app for light location surveying in the field. Before writing any code, read this brief, ask me about anything ambiguous, and propose an architecture and build order for me to approve.

## What it does

A surveyor walks to a point, checks the live GPS and compass readings on screen, optionally takes a photo, and saves an observation. Observations accumulate on the device while offline. When network is available, the surveyor taps sync and the session is pushed to a GitHub repository.

## Constraints

- **Target device is iOS Safari**, installed to the home screen. Portrait only. Android is not a requirement — don't add compatibility code for it, but don't actively block it either.
- **Offline first.** The app must launch, show the map, take readings, capture photos and save observations with no network at all. Network is only needed for sync.
- **Minimal interface.** Large touch targets, readable in sunlight, usable one-handed with gloves on. No navigation chrome beyond what's necessary.
- **No backend.** Static hosting plus the GitHub API. No server of my own to maintain.

## Functional requirements

**Readings.** Live GPS position (lat, lon, accuracy, altitude if available) and compass heading, both updating continuously. Show accuracy plainly so the surveyor knows whether the fix is trustworthy — a number in metres, not a green tick.

**Compass.** iOS needs `DeviceOrientationEvent.requestPermission()` called from a user gesture, and the heading comes from `webkitCompassHeading` (true north, clockwise). Handle the case where permission is denied or the sensor is unavailable — the app should still work for position-only observations.

**Photo capture.** Use a file input with `capture="environment"` rather than a custom camera UI. Downscale on device before storing; full-resolution photos will blow up the repo and the sync.

**Map.** Leaflet with OSM raster tiles, with tiles pre-cached into a service worker cache for a bounding box and zoom range chosen before going out. Keep the map layer behind a thin abstraction so PMTiles via MapLibre can replace it later without rewriting the rest of the app — but build the raster version first.

**Storage.** Observations and photos in IndexedDB. The device may be closed, backgrounded or run out of battery mid-session; nothing should be lost.

**Sync.** One commit per session. Data accumulates locally; on tap, the app writes all pending observations and photos to a GitHub repo as a single commit via the Git Data API (create blobs, build a tree, create a commit, update the ref). Authentication is a fine-grained personal access token that I paste into a settings screen once.

Things I care about here:

- Sync must be resumable and idempotent. If it fails halfway through on a bad connection, retrying should not duplicate or lose observations.
- Once synced, observations stay on the device but are marked as synced, and the UI should make the pending/synced distinction obvious.

**Token storage.** The PAT must not sit in storage in plaintext. Encrypt it with a key derived from a passphrase I set — WebCrypto, PBKDF2-SHA256 with a current OWASP-level iteration count, AES-GCM, random salt and IV stored alongside the ciphertext. Only the ciphertext goes to IndexedDB. The decrypted token lives in memory for the duration of a sync and is discarded after; it never touches localStorage, a global, or a log line.

The passphrase is asked for on sync, not on launch — taking readings and saving observations must never require it. If I get it wrong, fail cleanly and let me retry; if I've forgotten it, give me a way to wipe the stored token and paste a fresh one without losing any survey data.

Be straight with me about the limits of this in your proposal. I understand it protects the token at rest and not much else, but I want your read on what it does and doesn't buy, and whether the passphrase-on-every-sync friction is worth it in practice for someone standing in a field.

Optionally, if you think it's worth the complexity: WebAuthn with the PRF extension would let Face ID unlock the key instead of a passphrase. Tell me whether that's a sensible phase-two addition or a distraction.

**Export to file.** Sync to GitHub is the main route out, but I need a second one that doesn't depend on a repo, a token or a network — partly as a backup, partly because iOS can evict IndexedDB from an installed web app that hasn't been opened for a while, and unsynced data shouldn't be one storage purge away from gone.

Bundle a session (GeoJSON plus photos) into a zip in the browser and hand it to the iOS share sheet via the Web Share API with files, so it can go to Files, AirDrop or Mail. Fall back to a Blob download if sharing isn't available, and be aware that download anchors behave differently once the app is installed to the home screen — check current Safari behaviour rather than assuming.

Export should work on any session, synced or not, and should never mutate or clear local data as a side effect. Also warn me somewhere unobtrusive if a session has been sitting unsynced for a long time.

## Data format

Observations as GeoJSON — one FeatureCollection per session, points with properties for timestamp, heading, GPS accuracy, altitude, a free-text note, and a reference to the photo filename. Photos alongside as separate files. Propose the repo layout and property names; I want something a non-specialist could open in QGIS without instructions.

## What I want from you first

A short proposal covering: the stack you'd use and why, the file layout, the data model, how you'd structure the sync so it's resumable, and a phased build order where each phase is testable on a phone. Flag anything in this brief you think is a bad idea. Then wait for me to approve before writing code.
