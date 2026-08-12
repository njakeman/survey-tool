import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from the root of the custom domain (https://survey.field.works/),
// configured in the repo's Pages settings — Actions-based deploys ignore any
// CNAME file, so there is none. Once the domain is active, GitHub redirects
// njakeman.github.io/survey-tool there, which is why the base must be '/':
// a '/survey-tool/' build served at the root 404s its own manifest and
// assets, and the redirected module scripts surface on iOS as the fatal
// "Script error. (:0:0)".
const base = '/';

// Read (not import-assert) package.json's version, so it can be baked into
// the bundle as __APP_VERSION__ — export filenames/manifests want a real
// version string, and the app has no server-side package.json to fetch at
// runtime once built.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
);

export default defineConfig(async ({ command, isPreview }) => {
  const plugins = [];

  // Local HTTPS: always for `vite dev`; for `vite preview` only when
  // explicitly requested via `npm run preview:mobile` (sets MOBILE_HTTPS).
  // Geolocation and DeviceOrientationEvent.requestPermission are
  // secure-context gated, and offline/service-worker behaviour specifically
  // can only be verified against a *production* build (`vite dev`'s SW is a
  // shim that precaches nothing — see CLAUDE.md) — so on-device testing of
  // either needs a local HTTPS preview, not just the dev server.
  //
  // MOBILE_HTTPS is an explicit opt-in, not inferred from `!isPreview` or
  // absence of `CI`: Playwright's own e2e webServer also runs `vite preview`
  // locally (`playwright.config.js`'s baseURL is plain `http://localhost`),
  // so gating on "not CI" would silently break `npm run test:e2e` on this
  // machine while still passing in GitHub Actions — the opposite of what CI
  // is supposed to catch. An explicit flag has no such ambiguity.
  //
  // Dynamic import, not a static one: a static `import mkcert from
  // 'vite-plugin-mkcert'` at the top of this file runs on every command —
  // build and preview included — regardless of whether the plugin ends up
  // in the array below. That import alone crashed CI's Linux/Node 24
  // runner just by being evaluated (`TypeError:
  // webidl.util.markAsUncloneable is not a function`, inside a bundled
  // undici CacheStorage somewhere in mkcert's dependency chain) — never
  // reproduced locally on Windows/Node 22, and unrelated to whether mkcert
  // actually ran. CI never needs HTTPS, so it must never even load the
  // package.
  if (command === 'serve' && (!isPreview || process.env.MOBILE_HTTPS === 'true')) {
    const { default: mkcert } = await import('vite-plugin-mkcert');
    plugins.push(mkcert());
  }

  plugins.push(
    VitePWA({
      strategies: 'injectManifest',
      // 'prompt' is vite-plugin-pwa's default, but stated explicitly here
      // because it's load-bearing: src/sw/sw.js deliberately never
      // self-activates a waiting worker (see the comment there), and
      // main.js's registerSW({ onNeedRefresh }) only gets wired up in
      // prompt mode. Switching this to 'autoUpdate' without also removing
      // that SW code would silently reintroduce the update race.
      registerType: 'prompt',
      srcDir: 'src/sw',
      filename: 'sw.js',
      injectManifest: {
        // pbf covers the vendored map glyphs (public/fonts/) — MapLibre
        // fetches those lazily at render time, so unprecached they'd leave
        // an unlabelled map offline, with no error the surveyor would see.
        //
        // json covers the two generated manifests — public/basemaps/ and
        // public/feature-layers/ — which are what keep region and layer
        // names, bounds and styles listable with no network. They were
        // *documented* as precached long before they actually were; the glob
        // had no json in it, and only the settings-backed metadata fallback
        // in basemapService/featureLayerService hid the gap.
        //
        // .geojson deliberately does not match `*.json`, which is exactly
        // right: the layer data belongs in IndexedDB, fetched on enable, not
        // in the precache.
        //
        // pmtiles deliberately excluded: Workbox's 2 MiB
        // maximumFileSizeToCacheInBytes default would silently drop any real
        // regional extract from the manifest (green build, map broken
        // offline), and precached responses can't serve the HTTP Range
        // requests the pmtiles client reads archives with. The archive lives
        // in IndexedDB as an ArrayBuffer instead (CLAUDE.md, Platform
        // constraints; storage/basemapStore.js).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,pbf,json}'],
      },
      manifest: {
        name: 'Field Survey',
        short_name: 'Survey',
        description: 'Offline-first GPS, compass and photo survey observations.',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        // --paper and --accent from src/style.css. The splash screen is
        // drawn from these before any CSS loads, so a mismatch shows as a
        // colour flash on every standalone launch.
        background_color: '#f4f0e8',
        theme_color: '#c2611f',
        // The station-mark icon from the second design pass (variant I,
        // "the station, sighting") — SVG masters beside the PNGs in
        // public/icons/. The maskable entry is scaled to 70% with the
        // ground bleeding to the edge, so Android's safe circle cannot
        // clip the ticks; iOS reads the apple-touch-icon link instead.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  );

  return {
    base,
    plugins,
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    // Both servers fail loudly on a busy port rather than silently taking the
    // next one. Vite's default increment (5173 → 5174 → …) means a second
    // `npm run dev` quietly succeeds on a *different origin*, with its own
    // service-worker registration and its own IndexedDB — the exact
    // ambiguity behind the "PWA doesn't work offline" report. On preview it
    // also turns a 4173 clash with `preview:mobile` into an immediate
    // "port in use" instead of Playwright's opaque 60s webServer timeout.
    server: { strictPort: true },
    preview: { strictPort: true },
  };
});
