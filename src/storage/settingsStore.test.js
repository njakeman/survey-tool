import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import { getSetting, putSetting } from './settingsStore.js';

describe('settingsStore', () => {
  test('round-trips a value by key', async () => {
    const db = await openDatabase('settings-roundtrip');

    await putSetting(db, 'selectedBasemapId', 'north-wiltshire');

    expect(await getSetting(db, 'selectedBasemapId')).toBe('north-wiltshire');
    db.close();
  });

  test('returns undefined for a key never written', async () => {
    const db = await openDatabase('settings-missing');
    expect(await getSetting(db, 'selectedBasemapId')).toBeUndefined();
    db.close();
  });

  test('overwrites rather than accumulating', async () => {
    const db = await openDatabase('settings-overwrite');

    await putSetting(db, 'selectedBasemapId', 'north-wiltshire');
    await putSetting(db, 'selectedBasemapId', 'cotswolds');

    expect(await getSetting(db, 'selectedBasemapId')).toBe('cotswolds');
    expect(await db.count('settings')).toBe(1);
    db.close();
  });

  test('stores null distinctly from absent, so "deliberately none" survives a relaunch', async () => {
    const db = await openDatabase('settings-null');

    await putSetting(db, 'selectedBasemapId', null);

    expect(await getSetting(db, 'selectedBasemapId')).toBeNull();
    db.close();
  });
});
