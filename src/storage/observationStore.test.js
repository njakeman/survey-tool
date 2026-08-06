import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import {
  putObservation,
  getObservation,
  listObservationsForSession,
  markObservationSynced,
  deleteObservation,
} from './observationStore.js';
import { createObservation } from '../domain/observation.js';

function makeObservation(overrides = {}) {
  return createObservation({
    id: 'obs-1',
    sessionId: 'sess-1',
    recordedAt: '2026-08-06T10:00:00.000Z',
    fixAt: '2026-08-06T10:00:00.000Z',
    lat: 51.5,
    lon: -0.14,
    gpsAccuracyM: 8,
    ...overrides,
  });
}

describe('putObservation / getObservation', () => {
  test('stores an observation and reads it back unchanged', async () => {
    const db = await openDatabase('obs-store-roundtrip');
    const obs = makeObservation();

    await putObservation(db, obs);

    expect(await getObservation(db, 'obs-1')).toEqual(obs);
    db.close();
  });

  test('returns undefined for an observation that does not exist', async () => {
    const db = await openDatabase('obs-store-missing');
    expect(await getObservation(db, 'nope')).toBeUndefined();
    db.close();
  });
});

describe('listObservationsForSession', () => {
  test('returns only observations belonging to the given session', async () => {
    const db = await openDatabase('obs-store-by-session');
    const inSession = makeObservation({ id: 'obs-in', sessionId: 'sess-1' });
    const otherSession = makeObservation({ id: 'obs-other', sessionId: 'sess-2' });
    await putObservation(db, inSession);
    await putObservation(db, otherSession);

    const results = await listObservationsForSession(db, 'sess-1');

    expect(results.map((o) => o.id)).toEqual(['obs-in']);
    db.close();
  });

  test('returns an empty array for a session with no observations', async () => {
    const db = await openDatabase('obs-store-by-session-empty');
    expect(await listObservationsForSession(db, 'sess-none')).toEqual([]);
    db.close();
  });
});

describe('markObservationSynced', () => {
  test('sets synced to true and records the sync timestamp', async () => {
    const db = await openDatabase('obs-store-mark-synced');
    await putObservation(db, makeObservation());

    await markObservationSynced(db, 'obs-1', '2026-08-06T18:00:00.000Z');

    const updated = await getObservation(db, 'obs-1');
    expect(updated.synced).toBe(true);
    expect(updated.syncedAt).toBe('2026-08-06T18:00:00.000Z');
    db.close();
  });

  test('leaves every other field untouched', async () => {
    const db = await openDatabase('obs-store-mark-synced-fields');
    const obs = makeObservation({ note: 'gate post' });
    await putObservation(db, obs);

    await markObservationSynced(db, 'obs-1', '2026-08-06T18:00:00.000Z');

    const updated = await getObservation(db, 'obs-1');
    expect(updated.note).toBe('gate post');
    expect(updated.lat).toBe(obs.lat);
    db.close();
  });

  test('throws when the observation does not exist, rather than silently creating one', async () => {
    const db = await openDatabase('obs-store-mark-synced-missing');
    await expect(markObservationSynced(db, 'nope', '2026-08-06T18:00:00.000Z')).rejects.toThrow(
      /nope/,
    );
    db.close();
  });
});

describe('deleteObservation', () => {
  test('removes a stored observation', async () => {
    const db = await openDatabase('obs-store-delete');
    await putObservation(db, makeObservation());

    await deleteObservation(db, 'obs-1');

    expect(await getObservation(db, 'obs-1')).toBeUndefined();
    db.close();
  });

  test('is idempotent — deleting an observation that does not exist does not throw', async () => {
    const db = await openDatabase('obs-store-delete-missing');
    await expect(deleteObservation(db, 'nope')).resolves.toBeUndefined();
    db.close();
  });
});
