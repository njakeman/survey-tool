import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project site — served from /survey-tool/, not the domain root.
const base = '/survey-tool/';

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
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,pmtiles}'],
      },
      manifest: {
        name: 'Field Survey',
        short_name: 'Survey',
        description: 'Offline-first GPS, compass and photo survey observations.',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f4f1ea',
        theme_color: '#2b2620',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
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
