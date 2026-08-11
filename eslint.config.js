import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// src/map/manifest.js and featureLayerManifest.js exist for the build scripts
// and import node:fs. Nothing the app ships may reach them.
//
// Enforced because it already happened: featureLayerStyle.js imported a
// constant from featureLayerManifest.js, which pulled node:fs through three
// hops into the browser bundle. Vite externalises it rather than failing the
// build, so the first sign was a browser test that could not import the
// module — had the constant lived one file further away, the first sign would
// have been a broken map on a phone.
// The `./` forms are listed explicitly. A glob of '**/map/manifest.js' does
// not match a sibling import written './manifest.js' — and a sibling import
// is exactly how this went wrong the first time, from inside src/map/ itself.
const NODE_ONLY_MODULES = {
  group: [
    '**/map/manifest.js',
    '**/map/featureLayerManifest.js',
    './manifest.js',
    './featureLayerManifest.js',
  ],
  message:
    'Node-only build-script modules (they import node:fs). Shared values belong in a browser-safe module — see featureLayerStyle.js.',
};

// Spread into every block that sets no-restricted-imports rather than given a
// block of its own. Flat config merges `rules` by name, last match winning,
// so a second block matching src/ui/** would silently replace the UI
// boundaries below instead of adding to them — which it did, and the probe
// that caught it is worth remembering: an import of storage from src/ui/
// stopped being an error and nothing else changed.
export default [
  js.configs.recommended,
  {
    // Preact hooks follow React's rules, and the failure mode is the same:
    // a hook behind a condition silently corrupts state across renders.
    // rules-of-hooks is an error because there is no legitimate exception.
    // exhaustive-deps is a warning on purpose — several effects here omit
    // dependencies deliberately (mount-only reads, and the map rebuild that
    // must key on the archive id alone), and each of those omissions is
    // commented where it happens.
    files: ['src/**/*.js'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        // Injected by vite.config.js's `define`, from package.json's version
        // — lets export filenames/manifests carry a real app version without
        // a runtime fetch of package.json (which isn't served in prod).
        __APP_VERSION__: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The architectural rules from CLAUDE.md, enforced rather than trusted.
    // Both were honour-system until now, and both fail late and confusingly
    // when broken: a UI component reaching into storage turns a two-line
    // happy-dom fake into a fake-indexeddb setup, and importing photo/encode
    // or map/mapAdapter outside main.js drags a canvas or ~1.5 MB of renderer
    // into a component test — and, in the adapter's case, into the startup
    // bundle it is dynamically imported to stay out of.
    files: ['src/ui/**'],
    ignores: ['src/ui/**/*.test.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/storage/*', '**/app/captureService*', '**/app/basemapService*'],
              message:
                'UI components take a `service` prop instead of importing storage directly (CLAUDE.md).',
            },
            {
              group: ['**/photo/encode*', '**/map/mapAdapter*'],
              message:
                'Browser-only heavy modules are composed in main.js and injected as props (CLAUDE.md).',
            },
            NODE_ONLY_MODULES,
          ],
        },
      ],
    },
  },
  {
    // Everywhere else the app ships from. src/ui/** is excluded because its
    // own block above already carries NODE_ONLY_MODULES; two blocks matching
    // the same file would leave only the later rule in force.
    files: ['src/**'],
    ignores: [
      'src/ui/**',
      'src/**/*.test.js',
      'src/map/manifest.js',
      'src/map/featureLayerManifest.js',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [NODE_ONLY_MODULES] }],
    },
  },
  {
    files: ['**/*.test.js', 'test/**', 'e2e/**'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['*.config.js', 'scripts/**'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // docs/design/ is the design handoff as received — inline-styled mockups
    // and the generated runtime from the tool that authored them. Not our
    // code, and not code that ships.
    ignores: ['dist/', 'dev-dist/', 'node_modules/', 'docs/design/'],
  },
];
