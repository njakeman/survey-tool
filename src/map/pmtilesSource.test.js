import { describe, expect, test } from 'vitest';
import { ArrayBufferSource } from './pmtilesSource.js';

function sourceOver(bytes, key) {
  return new ArrayBufferSource(Uint8Array.from(bytes).buffer, key);
}

describe('ArrayBufferSource', () => {
  test('getKey returns the given key, defaulting to "basemap"', () => {
    expect(sourceOver([1, 2, 3], 'custom').getKey()).toBe('custom');
    expect(sourceOver([1, 2, 3]).getKey()).toBe('basemap');
  });

  test('getBytes returns the exact requested window', async () => {
    const source = sourceOver([10, 11, 12, 13, 14, 15]);

    const { data } = await source.getBytes(2, 3);

    expect([...new Uint8Array(data)]).toEqual([12, 13, 14]);
  });

  test('getBytes clamps an over-read at the end of the buffer, like FileSource slice semantics', async () => {
    const source = sourceOver([10, 11, 12, 13]);

    const { data } = await source.getBytes(2, 100);

    expect([...new Uint8Array(data)]).toEqual([12, 13]);
  });

  test('the returned window is a copy, not a live view of the archive buffer', async () => {
    const backing = Uint8Array.from([1, 2, 3, 4]);
    const source = new ArrayBufferSource(backing.buffer);

    const { data } = await source.getBytes(0, 2);
    backing[0] = 99;

    expect(new Uint8Array(data)[0]).toBe(1);
  });
});
