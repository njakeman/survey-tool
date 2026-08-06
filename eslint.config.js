import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
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
    ignores: ['dist/', 'dev-dist/', 'node_modules/'],
  },
];
