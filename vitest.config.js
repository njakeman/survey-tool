import { defineConfig } from 'vitest/config';

// Three tiers, run independently:
//  - node:    domain logic (crypto, storage, sync, geojson) — no DOM, real WebCrypto.
//             jsdom is deliberately avoided here: crypto.subtle throws under it
//             (vitest-dev/vitest#5365). fake-indexeddb is loaded per-test where needed.
//  - happy-dom: Preact UI components — no crypto/storage code should run here.
//  - browser: real IndexedDB / Cache Storage / WebCrypto via an actual browser, for
//             contract tests that must catch divergence from WebKit's real behaviour.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.js'],
          exclude: ['src/ui/**', 'src/**/*.browser.test.js'],
        },
      },
      {
        test: {
          name: 'happy-dom',
          environment: 'happy-dom',
          include: ['src/ui/**/*.test.js'],
          setupFiles: ['./test/setup-happy-dom.js'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.js'],
          browser: {
            enabled: true,
            provider: 'playwright',
            instances: [{ browser: 'chromium' }, { browser: 'webkit' }],
          },
        },
      },
    ],
  },
});
