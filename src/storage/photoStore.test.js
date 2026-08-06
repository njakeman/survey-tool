import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import { putPhoto, getPhoto } from './photoStore.js';

describe('putPhoto / getPhoto', () => {
  test('stores a photo blob and reads it back as a Blob with the same content and type', async () => {
    const db = await openDatabase('photo-store-roundtrip');
    const blob = new Blob(['fake jpeg bytes'], { type: 'image/jpeg' });

    await putPhoto(db, { id: 'obs-1', blob, contentType: 'image/jpeg' });

    const stored = await getPhoto(db, 'obs-1');
    expect(stored.id).toBe('obs-1');
    expect(stored.contentType).toBe('image/jpeg');
    expect(stored.blob).toBeInstanceOf(Blob);
    expect(stored.blob.type).toBe('image/jpeg');
    expect(await stored.blob.text()).toBe('fake jpeg bytes');
  });

  test('returns undefined for a photo that does not exist', async () => {
    const db = await openDatabase('photo-store-missing');
    expect(await getPhoto(db, 'nope')).toBeUndefined();
  });
});
