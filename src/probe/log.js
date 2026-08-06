// Persists probe results across a cold relaunch, since several open iOS
// questions (does orientation permission survive relaunch? does storage
// persist grant survive it?) can only be answered by comparing two separate
// launches. `storage` is any Storage-like object (localStorage in practice);
// injected so this stays testable without a real browser. No secrets pass
// through here — this is diagnostic-only, unlike the app's real token storage.

const LOG_KEY = 'survey-tool:probe-log';

export function readLog(storage) {
  const raw = storage.getItem(LOG_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendLogEntry(storage, entry) {
  const entries = [...readLog(storage), entry];
  storage.setItem(LOG_KEY, JSON.stringify(entries));
  return entries;
}

export function clearLog(storage) {
  storage.removeItem(LOG_KEY);
}
