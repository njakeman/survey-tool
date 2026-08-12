import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';
import {
  appendTraceVertex,
  deleteTraceDraft,
  listTraceDrafts,
  listTraceVertices,
  putTraceDraft,
} from './traceDraftStore.js';

// Real IndexedDB in chromium + webkit. The trace stores lean on two things
// fake-indexeddb merely simulates: composite-key ordering ([draftId, seq]
// sorting by seq within a draft) and a range delete bounded by the
// empty-array sentinel. Both must hold in real engines or a finished trace
// would orphan its vertices — or delete someone else's.
describe('traceDraftStore against real IndexedDB', () => {
  test('vertices sort by seq under the composite key and range-delete with their draft', async () => {
    const db = await openDatabase(`browser-trace-draft-${Math.random()}`);
    const vertex = (seq) => ({ seq, lat: seq, lon: 0, accuracyM: 5, fixAt: 't' });

    await putTraceDraft(db, { id: 'draft-1', sessionId: 's', mode: 'path', startedAt: 't' });
    await appendTraceVertex(db, 'draft-1', vertex(1));
    await appendTraceVertex(db, 'draft-1', vertex(0));
    await appendTraceVertex(db, 'draft-2', vertex(0));

    expect((await listTraceVertices(db, 'draft-1')).map((v) => v.seq)).toEqual([0, 1]);

    await deleteTraceDraft(db, 'draft-1');

    expect(await listTraceDrafts(db)).toEqual([]);
    expect(await listTraceVertices(db, 'draft-1')).toEqual([]);
    expect(await listTraceVertices(db, 'draft-2')).toHaveLength(1);
    db.close();
  });
});
