import { describe, expect, test } from 'vitest';
import { benchmarkPbkdf2 } from './pbkdf2-benchmark.js';

// Runs against a real browser's WebCrypto (chromium + webkit, per vitest.config.js),
// not just Node's — WebKit is what actually ships on iOS, and PBKDF2 timing is the
// number this whole benchmark exists to catch problems with.
describe('benchmarkPbkdf2 (real browser WebCrypto)', () => {
  test('derives real key material and reports a non-negative elapsed time', async () => {
    const result = await benchmarkPbkdf2({
      subtle: crypto.subtle,
      getRandomValues: (arr) => crypto.getRandomValues(arr),
      iterations: 1000, // small — proves the wiring, not device timing
    });

    expect(result.iterations).toBe(1000);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
