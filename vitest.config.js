import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Three tiers, run independently:
//  - node:    domain logic (crypto, storage, sync, geojson) — no DOM, real WebCrypto.
//             jsdom is deliberately avoided here: crypto.subtle throws under it
//             (vitest-dev/vitest#5365). fake-indexeddb is loaded per-test where needed.
//  - happy-dom: Preact UI components — no crypto/storage code should run here.
//  - browser: real IndexedDB / Cache Storage / WebCrypto via an actual browser, for
//             contract tests that must catch divergence from WebKit's real behaviour.
export default defineConfig({
  test: {
    // Deliberately NOT passWithNoTests: a project whose include glob stops
    // matching — a renamed suffix, a moved directory — would otherwise run
    // zero tests and report success. The browser tier is most at risk, being
    // the slowest and least often run locally.
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.js'],
          // Component tests need a DOM, wherever they live. Excluding
          // src/probe/*Page* alongside src/ui keeps ProbePage testable —
          // without it, a ProbePage test would land here and die on
          // `document` rather than run.
          exclude: ['src/ui/**', 'src/probe/*Page.test.js', 'src/**/*.browser.test.js'],
        },
      },
      {
        test: {
          name: 'happy-dom',
          environment: 'happy-dom',
          include: ['src/ui/**/*.test.js', 'src/probe/*Page.test.js'],
          setupFiles: ['./test/setup-happy-dom.js'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.js'],
          // A ceiling for slow runners, not a licence for slow tests: every
          // test here builds a real MapLibre map, which runs on software GL
          // in CI, where a single init has been seen to cross the 15s
          // default while the identical config passed in the adjacent test
          // (and takes ~70ms locally). Node and happy-dom keep their tight
          // defaults — nothing in those tiers should ever be slow.
          testTimeout: 60_000,
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }, { browser: 'webkit' }],
            // Vitest's default browser-mode port (63315) can land inside a
            // Windows Hyper-V/WinNAT excluded port range (they move between
            // reboots), which fails the whole tier with `listen EACCES`
            // before a single test runs. Pin a port above the ephemeral
            // ranges observed reserved; strictPort stays off so a genuine
            // collision falls through to the next free port rather than
            // dying.
            api: { port: 63700 },
          },
        },
      },
    ],
  },
});
