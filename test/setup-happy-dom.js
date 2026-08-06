import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/preact';

// @testing-library/preact's own auto-cleanup only registers when a global
// `afterEach` exists (vitest.config.js doesn't set `test.globals: true` —
// every test file imports afterEach/describe/test explicitly instead), so
// it has to be wired up here or components leak across tests.
afterEach(cleanup);
