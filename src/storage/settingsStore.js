// Small key/value app settings. Kept apart from the archive records so that
// writing a setting never rewrites a multi-megabyte buffer, and in IndexedDB
// rather than localStorage so it sits under the same persisted-storage grant
// as everything else the app can't afford to lose.

export async function getSetting(db, key) {
  const record = await db.get('settings', key);
  return record ? record.value : undefined;
}

export function putSetting(db, key, value) {
  return db.put('settings', { key, value });
}
