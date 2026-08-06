import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import mkcert from 'vite-plugin-mkcert';

// GitHub Pages project site — served from /survey-tool/, not the domain root.
const base = '/survey-tool/';

export default defineConfig(({ isPreview }) => ({
  base,
  plugins: [
    // Local HTTPS for the dev server. Geolocation and
    // DeviceOrientationEvent.requestPermission are secure-context gated — a
    // plain-HTTP LAN URL can't exercise them, so on-device sensor testing
    // needs this rather than depending on the GitHub Pages deploy. Excluded
    // from `vite preview` (used by e2e/CI): Vite's `command` is 'serve' for
    // both `dev` and `preview`, and mkcert's own `apply: 'serve'` default
    // doesn't distinguish them — preview then tries to run `mkcert -install`
    // (a system CA install), which hangs waiting for elevation on Windows.
    ...(isPreview ? [] : [mkcert()]),
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
  ],
}));
