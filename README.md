# Field Survey

Offline-first PWA for light location surveying in the field: GPS + compass readings, optional
photo, saved as a GeoJSON observation. Session data syncs to a private GitHub repo as one commit;
export to file works without any network at all. Built for iOS Safari, installed to the home
screen.

See [`field-survey-pwa-prompt.md`](./field-survey-pwa-prompt.md) for the original brief and
[`CLAUDE.md`](./CLAUDE.md) for constraints that bind the implementation.

## Status

Phase 1 (foundation + device capability probe) — see task list in the plan. Not yet field-usable.

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

## Manual verification

Playwright's WebKit is not Safari and not iOS. Before signing off any phase, run through
[`docs/ios-manual-checklist.md`](./docs/ios-manual-checklist.md) on a real iPhone.

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via Actions (`.github/workflows/ci.yml`).
First-time setup: in the repo's Settings → Pages, set the source to "GitHub Actions".

## Data

Synced sessions land in a separate private repo (`njakeman/survey-data`), not this one — so a
compromised sync token can never rewrite the app that's deployed from here.
