import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import {
  appendTraceVertex,
  deleteTraceDraft,
  listTraceDrafts,
  listTraceVertices,
  putTraceDraft,
} from './traceDraftStore.js';

const DRAFT = {
  id: 'draft-1',
  sessionId: 'sess-1',
  mode: 'path',
  startedAt: '2026-08-12T09:00:00.000Z',
};

const vertex = (seq) => ({
  seq,
  lat: seq * 0.0001,
  lon: 0,
  accuracyM: 5,
  fixAt: '2026-08-12T09:00:00.000Z',
});

let db;
let counter = 0;
beforeEach(async () => {
  counter += 1;
  db = await openDatabase(`trace-draft-store-test-${counter}`);
});

describe('traceDraftStore', () => {
  test('a draft round-trips through the store', async () => {
    await putTraceDraft(db, DRAFT);

    expect(await listTraceDrafts(db)).toEqual([DRAFT]);
  });

  test('vertices append one record at a time and list back in walked order', async () => {
    await putTraceDraft(db, DRAFT);
    // Deliberately out of insertion order — the composite key sorts by seq.
    await appendTraceVertex(db, 'draft-1', vertex(1));
    await appendTraceVertex(db, 'draft-1', vertex(0));
    await appendTraceVertex(db, 'draft-1', vertex(2));

    const vertices = await listTraceVertices(db, 'draft-1');
    expect(vertices.map((v) => v.seq)).toEqual([0, 1, 2]);
    expect(vertices[0]).toMatchObject({ draftId: 'draft-1', lat: 0, accuracyM: 5 });
  });

  test('a gap flag on a vertex survives the round trip — recovery must keep it', async () => {
    // The appender spreads the whole vertex into the record; a field
    // allowlist here would silently drop gapBefore and a recovered draft
    // would draw its suspension gap as measured ground.
    await appendTraceVertex(db, 'draft-1', { ...vertex(0), gapBefore: false });
    await appendTraceVertex(db, 'draft-1', { ...vertex(1), gapBefore: true });

    const vertices = await listTraceVertices(db, 'draft-1');
    expect(vertices.map((v) => v.gapBefore)).toEqual([false, true]);
  });

  test("one draft's vertices never leak into another's", async () => {
    await appendTraceVertex(db, 'draft-1', vertex(0));
    await appendTraceVertex(db, 'draft-2', vertex(0));
    await appendTraceVertex(db, 'draft-2', vertex(1));

    expect(await listTraceVertices(db, 'draft-1')).toHaveLength(1);
    expect(await listTraceVertices(db, 'draft-2')).toHaveLength(2);
  });

  test('deleting a draft removes its meta record and every vertex, and nothing else', async () => {
    await putTraceDraft(db, DRAFT);
    await putTraceDraft(db, { ...DRAFT, id: 'draft-2' });
    await appendTraceVertex(db, 'draft-1', vertex(0));
    await appendTraceVertex(db, 'draft-1', vertex(1));
    await appendTraceVertex(db, 'draft-2', vertex(0));

    await deleteTraceDraft(db, 'draft-1');

    expect(await listTraceDrafts(db)).toEqual([{ ...DRAFT, id: 'draft-2' }]);
    expect(await listTraceVertices(db, 'draft-1')).toEqual([]);
    expect(await listTraceVertices(db, 'draft-2')).toHaveLength(1);
  });

  test('deleting a draft that does not exist is a no-op, like captureDelete', async () => {
    await expect(deleteTraceDraft(db, 'draft-9')).resolves.toBeUndefined();
  });
});
