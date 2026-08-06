import { precacheAndRoute } from 'workbox-precaching';

// injectManifest strategy: Workbox fills __WB_MANIFEST with every build asset
// at build time (revisioned, so updates are detected correctly). Runtime
// caching for the basemap and other app-specific rules land here in later
// phases — kept as a thin router per plan (SW logic itself is best tested as
// plain functions elsewhere, not through the SW lifecycle).
precacheAndRoute(self.__WB_MANIFEST);

self.skipWaiting();
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
