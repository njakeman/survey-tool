import { describe, expect, test, vi } from 'vitest';
import { benchmarkPbkdf2 } from './pbkdf2-benchmark.js';

describe('benchmarkPbkdf2', () => {
  test('derives 256 bits of PBKDF2-SHA256 at the requested iteration count', async () => {
    const derivedBits = new ArrayBuffer(32);
    const importedKey = { type: 'imported-key' };
    const subtle = {
      importKey: vi.fn().mockResolvedValue(importedKey),
      deriveBits: vi.fn().mockResolvedValue(derivedBits),
    };
    const getRandomValues = (arr) => arr.fill(7);

    await benchmarkPbkdf2({ subtle, getRandomValues, iterations: 600_000, now: () => 0 });

    expect(subtle.importKey).toHaveBeenCalledWith('raw', expect.any(Uint8Array), 'PBKDF2', false, [
      'deriveBits',
    ]);
    expect(subtle.deriveBits).toHaveBeenCalledWith(
      { name: 'PBKDF2', salt: expect.any(Uint8Array), iterations: 600_000, hash: 'SHA-256' },
      importedKey,
      256,
    );
  });

  test('reports elapsed time as the difference between the now() readings around derivation', async () => {
    const subtle = {
      importKey: vi.fn().mockResolvedValue({}),
      deriveBits: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    };
    const timestamps = [100, 943.5];
    const now = () => timestamps.shift();

    const result = await benchmarkPbkdf2({
      subtle,
      getRandomValues: (arr) => arr,
      iterations: 600_000,
      now,
    });

    expect(result).toEqual({ iterations: 600_000, elapsedMs: 843.5 });
  });

  test("measures real elapsed time using Node's native WebCrypto", async () => {
    const result = await benchmarkPbkdf2({
      subtle: globalThis.crypto.subtle,
      getRandomValues: (arr) => globalThis.crypto.getRandomValues(arr),
      iterations: 1000, // small — this only proves the wiring works, not device timing
    });

    expect(result.iterations).toBe(1000);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
