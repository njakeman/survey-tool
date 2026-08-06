import { describe, expect, test } from 'vitest';
import { appendLogEntry, readLog, clearLog } from './log.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe('readLog', () => {
  test('returns an empty array when nothing has been logged yet', () => {
    expect(readLog(fakeStorage())).toEqual([]);
  });

  test('returns an empty array when the stored value is corrupt JSON', () => {
    const storage = fakeStorage({ 'survey-tool:probe-log': 'not json' });
    expect(readLog(storage)).toEqual([]);
  });
});

describe('appendLogEntry', () => {
  test('adds an entry and returns the updated log', () => {
    const storage = fakeStorage();
    const entries = appendLogEntry(storage, {
      at: '2026-08-06T10:00:00Z',
      check: 'standalone',
      result: true,
    });
    expect(entries).toEqual([{ at: '2026-08-06T10:00:00Z', check: 'standalone', result: true }]);
  });

  test('persists across separate calls, oldest first, simulating a cold relaunch', () => {
    const storage = fakeStorage();
    appendLogEntry(storage, {
      at: '2026-08-06T10:00:00Z',
      check: 'orientation-permission',
      result: 'granted',
    });
    const secondLaunch = appendLogEntry(storage, {
      at: '2026-08-06T14:00:00Z',
      check: 'orientation-permission',
      result: 'denied',
    });
    expect(secondLaunch).toEqual([
      { at: '2026-08-06T10:00:00Z', check: 'orientation-permission', result: 'granted' },
      { at: '2026-08-06T14:00:00Z', check: 'orientation-permission', result: 'denied' },
    ]);
  });
});

describe('clearLog', () => {
  test('removes all logged entries', () => {
    const storage = fakeStorage();
    appendLogEntry(storage, { at: '2026-08-06T10:00:00Z', check: 'standalone', result: true });
    clearLog(storage);
    expect(readLog(storage)).toEqual([]);
  });
});
