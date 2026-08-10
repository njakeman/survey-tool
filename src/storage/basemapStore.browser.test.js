import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import { putBasemap, getBasemap } from './basemapStore.js';

// Real IndexedDB in chromium + webkit. A PMTiles extract is tens of MB —
// orders of magnitude beyond anything the photo path stores — and WebKit's
// ephemeral-session IndexedDB (the context Playwright uses, and real Safari
// Private Browsing) is exactly where large-value storage has historically
// diverged from Chromium. fake-indexeddb can't prove a multi-megabyte
// ArrayBuffer survives a real engine's serialisation round-trip; this does.
describe('basemapStore against real IndexedDB', () => {
  test('round-trips a multi-megabyte ArrayBuffer archive intact', async () => {
    const db = await openDatabase(`browser-basemap-${Math.random()}`);
    const sizeBytes = 8 * 1024 * 1024;
    const bytes = new Uint8Array(sizeBytes);
    // Deterministic non-trivial content so corruption can't hide as zeros.
    for (let i = 0; i < sizeBytes; i += 4096) bytes[i] = (i / 4096) % 251;

    await putBasemap(db, {
      arrayBuffer: bytes.buffer,
      etag: '"real-engine"',
      sizeBytes,
      downloadedAt: '2026-08-10T10:00:00.000Z',
    });
    const record = await getBasemap(db);

    expect(record.arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(record.arrayBuffer.byteLength).toBe(sizeBytes);
    const readBack = new Uint8Array(record.arrayBuffer);
    for (let i = 0; i < sizeBytes; i += 4096) {
      if (readBack[i] !== (i / 4096) % 251) {
        throw new Error(`archive bytes corrupted at offset ${i}`);
      }
    }
    expect(record.etag).toBe('"real-engine"');

    db.close();
  });
});
