import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

// injectManifest strategy: Workbox fills __WB_MANIFEST with every build asset
// at build time (revisioned, so updates are detected correctly). Runtime
// caching for the basemap and other app-specific rules land here in later
// phases — kept as a thin router per plan (SW logic itself is best tested as
// plain functions elsewhere, not through the SW lifecycle).
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Deliberately prompt-to-update, not auto-activate. An unconditional
// self.skipWaiting() here (the vite-plugin-pwa default posture) races an
// already-loading page: activation prunes the previous generation's
// precache, so a page whose HTML came from the old build ends up requesting
// hashed JS/CSS that no longer exist anywhere — a 404 on a module script,
// which surfaces as "Something went wrong loading the app: Script error."
// with nothing to reload and heal it. A waiting worker never prunes, so the
// running page's generation stays internally consistent until the user
// deliberately swaps over (App.js's "New version — Reload" banner, wired
// through registerSW's onNeedRefresh in main.js). This also protects an
// in-progress observation: note/photo live only in memory
// (src/ui/CapturePage.js) until Save, and must never be wiped by a surprise
// reload.
let isUpdate = false;
self.addEventListener('install', () => {
  isUpdate = Boolean(self.registration.active);
});
self.addEventListener('activate', (event) => {
  // Claim only on a genuine first install — there is no older generation to
  // fall out of sync with, and it's what makes the very first visit
  // offline-capable immediately rather than only after a second load.
  if (!isUpdate) event.waitUntil(self.clients.claim());
});
self.addEventListener('message', (event) => {
  // { type: 'SKIP_WAITING' } is workbox-window's messageSkipWaiting()
  // payload — this is the other half of that handshake.
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
