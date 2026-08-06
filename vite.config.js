import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project site — served from /survey-tool/, not the domain root.
const base = '/survey-tool/';

export default defineConfig(async ({ command, isPreview }) => {
  const plugins = [];

  // Local HTTPS for the dev server only — never build, never preview.
  // Geolocation and DeviceOrientationEvent.requestPermission are
  // secure-context gated, so on-device sensor testing needs this rather
  // than depending on the GitHub Pages deploy.
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
  if (command === 'serve' && !isPreview) {
    const { default: mkcert } = await import('vite-plugin-mkcert');
    plugins.push(mkcert());
  }

  plugins.push(
    VitePWA({
      strategies: 'injectManifest',
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

  return { base, plugins };
});
