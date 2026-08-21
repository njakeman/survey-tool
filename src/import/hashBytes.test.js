import { describe, expect, test } from 'vitest';
import { sha256Hex } from './hashBytes.js';

describe('sha256Hex', () => {
  test('matches the published SHA-256 test vector for "abc"', async () => {
    const bytes = new TextEncoder().encode('abc');

    expect(await sha256Hex(bytes.buffer)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('hashes the empty buffer to the well-known empty digest', async () => {
    expect(await sha256Hex(new ArrayBuffer(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
