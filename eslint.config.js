import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

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
          ],
        },
      ],
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
