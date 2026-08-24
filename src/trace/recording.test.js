import { describe, expect, test } from 'vitest';
import {
  ACCURACY_GATE_M,
  GAP_THRESHOLD_MS,
  MIN_SPACING_M,
  acceptFix,
  createTraceState,
  finishTrace,
  noteInterruption,
  pauseTrace,
  resumeTrace,
  traceStats,
} from './recording.js';
import { distanceM } from '../geo/distance.js';

const DEGREE_M = distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });

// A reading standing `metres` north of the origin. Trace rules are all about
// distances, so the fixtures speak metres and convert to degrees once here.
function fix(metres, { accuracyM = 5, fixAt = '2026-08-12T10:00:00.000Z', fixAtMs } = {}) {
  return { lat: metres / DEGREE_M, lon: 0, accuracyM, fixAt, fixAtMs };
}

function walk(state, readings) {
  const vertices = [];
  for (const reading of readings) {
    const result = acceptFix(state, reading);
    state = result.state;
    if (result.vertex) vertices.push(result.vertex);
  }
  return { state, vertices };
}

describe('acceptFix', () => {
  test('the first good fix is accepted with no distance rule', () => {
    const { vertex } = acceptFix(createTraceState({ mode: 'path' }), fix(0));

    expect(vertex).not.toBeNull();
    expect(vertex.seq).toBe(0);
  });

  test('a fix worse than the accuracy gate is rejected, even as the first', () => {
    const state = createTraceState({ mode: 'path' });
    const { state: after, vertex } = acceptFix(state, fix(0, { accuracyM: ACCURACY_GATE_M + 1 }));

    expect(vertex).toBeNull();
    expect(traceStats(after).vertexCount).toBe(0);
  });

  test('movement below the minimum spacing does not add a vertex', () => {
    const { vertices } = walk(createTraceState({ mode: 'path' }), [
      fix(0, { accuracyM: 2 }),
      fix(MIN_SPACING_M - 2, { accuracyM: 2 }),
    ]);

    expect(vertices).toHaveLength(1);
  });

  test('movement past the minimum spacing does', () => {
    const { vertices } = walk(createTraceState({ mode: 'path' }), [
      fix(0, { accuracyM: 2 }),
      fix(MIN_SPACING_M + 1, { accuracyM: 2 }),
    ]);

    expect(vertices).toHaveLength(2);
    expect(vertices[1].seq).toBe(1);
  });

  test('a poor fix must move at least its own error bar', () => {
    // 10 m of apparent movement on a ±15 m fix is noise; 16 m is walking.
    const { vertices } = walk(createTraceState({ mode: 'path' }), [
      fix(0, { accuracyM: 2 }),
      fix(10, { accuracyM: 15 }),
      fix(16, { accuracyM: 15 }),
    ]);

    expect(vertices).toHaveLength(2);
    expect(vertices[1].lat).toBeCloseTo(fix(16).lat, 9);
  });

  test('pause gates the appender; resume applies the distance rule against the last vertex', () => {
    let { state } = acceptFix(createTraceState({ mode: 'path' }), fix(0, { accuracyM: 2 }));
    state = pauseTrace(state);

    const paused = acceptFix(state, fix(50, { accuracyM: 2 }));
    expect(paused.vertex).toBeNull();

    state = resumeTrace(paused.state);
    const standingStill = acceptFix(state, fix(1, { accuracyM: 2 }));
    expect(standingStill.vertex).toBeNull();

    const walkedAway = acceptFix(standingStill.state, fix(40, { accuracyM: 2 }));
    expect(walkedAway.vertex).not.toBeNull();
  });

  test('a vertex carries everything the draft store persists', () => {
    const { vertex } = acceptFix(
      createTraceState({ mode: 'path' }),
      fix(0, { accuracyM: 7, fixAt: '2026-08-12T09:30:00.000Z' }),
    );

    expect(vertex).toEqual({
      seq: 0,
      lat: 0,
      lon: 0,
      accuracyM: 7,
      fixAt: '2026-08-12T09:30:00.000Z',
      gapBefore: false,
    });
  });
});

describe('gap detection', () => {
  test('a silence in the fix stream flags the next accepted vertex as gapBefore', () => {
    let { state } = acceptFix(createTraceState({ mode: 'path' }), fix(0, { fixAtMs: 0 }));
    const { vertex } = acceptFix(state, fix(20, { fixAtMs: GAP_THRESHOLD_MS + 1 }));

    expect(vertex.gapBefore).toBe(true);
  });

  test('steady fixes never flag, even when the vertices are minutes apart', () => {
    // Standing still: every fix is rejected by the distance rule, but the
    // stream itself never went silent — the eventual move is measured ground.
    let state = acceptFix(createTraceState({ mode: 'path' }), fix(0, { fixAtMs: 0 })).state;
    for (let i = 1; i <= 60; i++) {
      state = acceptFix(state, fix(1, { fixAtMs: i * 1000 })).state;
    }
    const { vertex } = acceptFix(state, fix(20, { fixAtMs: 61_000 }));

    expect(vertex.gapBefore).toBe(false);
  });

  test('a gap noticed on a rejected fix still flags the next accepted vertex', () => {
    // The resume fix after a suspension is often cold-start junk; the gap
    // must not be forgotten just because that first fix failed the gate.
    let state = acceptFix(createTraceState({ mode: 'path' }), fix(0, { fixAtMs: 0 })).state;
    state = acceptFix(
      state,
      fix(20, { accuracyM: ACCURACY_GATE_M + 10, fixAtMs: GAP_THRESHOLD_MS + 1 }),
    ).state;
    const { vertex } = acceptFix(state, fix(20, { fixAtMs: GAP_THRESHOLD_MS + 2000 }));

    expect(vertex.gapBefore).toBe(true);
  });

  test('noteInterruption flags the next accepted vertex without any time gap', () => {
    let state = acceptFix(createTraceState({ mode: 'path' }), fix(0, { fixAtMs: 0 })).state;
    state = noteInterruption(state);
    const { vertex } = acceptFix(state, fix(20, { fixAtMs: 1000 }));

    expect(vertex.gapBefore).toBe(true);
  });

  test('resuming after a pause flags the next accepted vertex', () => {
    // A paused stretch was walked unmeasured — inferred ground, same as a
    // background gap (user decision 2026-08-24).
    let state = acceptFix(createTraceState({ mode: 'path' }), fix(0, { fixAtMs: 0 })).state;
    state = resumeTrace(pauseTrace(state));
    const { vertex } = acceptFix(state, fix(20, { fixAtMs: 1000 }));

    expect(vertex.gapBefore).toBe(true);
  });

  test('the first vertex never carries a gap — there is no preceding segment', () => {
    const state = noteInterruption(createTraceState({ mode: 'path' }));
    const { vertex } = acceptFix(state, fix(0, { fixAtMs: GAP_THRESHOLD_MS * 2 }));

    expect(vertex.gapBefore).toBe(false);
  });

  test('the flag clears once claimed — the vertex after a gap vertex is clean', () => {
    let state = acceptFix(createTraceState({ mode: 'path' }), fix(0, { fixAtMs: 0 })).state;
    state = acceptFix(state, fix(20, { fixAtMs: GAP_THRESHOLD_MS + 1 })).state;
    const { vertex } = acceptFix(state, fix(40, { fixAtMs: GAP_THRESHOLD_MS + 2000 }));

    expect(vertex.gapBefore).toBe(false);
  });

  test('a rejected fix with nothing new returns the same state reference', () => {
    // The appender re-offers the same fix when its effect re-runs; a fresh
    // state object each time would make that effect loop forever.
    const { state } = acceptFix(createTraceState({ mode: 'path' }), fix(0, { fixAtMs: 0 }));
    const rejected = acceptFix(state, fix(1, { fixAtMs: 0 }));

    expect(rejected.vertex).toBeNull();
    expect(rejected.state).toBe(state);
  });

  test('readings without fixAtMs never trip the time rule', () => {
    // Older fixtures and fakes omit it; absence of a clock is not a gap.
    let { state } = acceptFix(createTraceState({ mode: 'path' }), fix(0));
    const { vertex } = acceptFix(state, fix(20));

    expect(vertex.gapBefore).toBe(false);
  });
});

describe('createTraceState', () => {
  test('rebuilds from persisted vertices after a relaunch', () => {
    const persisted = [
      { seq: 0, lat: 0, lon: 0, accuracyM: 3, fixAt: '2026-08-12T09:00:00.000Z' },
      { seq: 1, lat: fix(10).lat, lon: 0, accuracyM: 9, fixAt: '2026-08-12T09:01:00.000Z' },
    ];
    const state = createTraceState({ mode: 'path', vertices: persisted });

    expect(traceStats(state).vertexCount).toBe(2);
    expect(traceStats(state).worstAccuracyM).toBe(9);
    // The next accepted vertex continues the persisted sequence.
    const { vertex } = acceptFix(state, fix(50, { accuracyM: 2 }));
    expect(vertex.seq).toBe(2);
  });

  test('persisted gap flags survive the rebuild into finishTrace', () => {
    const persisted = [
      { seq: 0, lat: 0, lon: 0, accuracyM: 3, fixAt: 'a', gapBefore: false },
      { seq: 1, lat: fix(20).lat, lon: 0, accuracyM: 3, fixAt: 'b', gapBefore: true },
      { seq: 2, lat: fix(40).lat, lon: 0, accuracyM: 3, fixAt: 'c', gapBefore: false },
    ];
    const state = createTraceState({ mode: 'path', vertices: persisted });

    expect(finishTrace(state).gaps).toEqual([1]);
  });
});

describe('traceStats', () => {
  test('reports count, walked length and the worst accuracy so far', () => {
    const { state } = walk(createTraceState({ mode: 'path' }), [
      fix(0, { accuracyM: 3 }),
      fix(15, { accuracyM: 12 }),
      fix(30, { accuracyM: 6 }),
    ]);

    const stats = traceStats(state);
    expect(stats.vertexCount).toBe(3);
    expect(stats.lengthM).toBeCloseTo(30, 3);
    expect(stats.worstAccuracyM).toBe(12);
  });

  test('an empty trace has zero length and no accuracy yet', () => {
    const stats = traceStats(createTraceState({ mode: 'path' }));

    expect(stats).toEqual({ vertexCount: 0, lengthM: 0, worstAccuracyM: null });
  });
});

describe('finishTrace — path', () => {
  test('produces a LineString with midpoint representative and worst-vertex accuracy', () => {
    const { state } = walk(createTraceState({ mode: 'path' }), [
      fix(0, { accuracyM: 3, fixAt: '2026-08-12T09:00:00.000Z' }),
      fix(15, { accuracyM: 12 }),
      fix(30, { accuracyM: 6 }),
    ]);

    const finished = finishTrace(state);
    expect(finished.geometry.type).toBe('LineString');
    expect(finished.geometry.coordinates).toHaveLength(3);
    expect(finished.representative.lat).toBeCloseTo(fix(15).lat, 9);
    expect(finished.gpsAccuracyM).toBe(12);
    expect(finished.fixAt).toBe('2026-08-12T09:00:00.000Z');
    expect(finished.lengthM).toBeCloseTo(30, 3);
    expect(finished.warnings).toEqual([]);
    expect(finished.gaps).toEqual([]);
  });

  test('reports the vertices whose preceding segment was inferred', () => {
    let state = acceptFix(createTraceState({ mode: 'path' }), fix(0, { fixAtMs: 0 })).state;
    state = acceptFix(state, fix(20, { fixAtMs: GAP_THRESHOLD_MS + 1 })).state;
    state = acceptFix(state, fix(40, { fixAtMs: GAP_THRESHOLD_MS + 2000 })).state;

    expect(finishTrace(state).gaps).toEqual([1]);
  });

  test('cannot finish with fewer than two vertices', () => {
    const { state } = acceptFix(createTraceState({ mode: 'path' }), fix(0));

    expect(() => finishTrace(state)).toThrow(/at least two/i);
  });
});

describe('finishTrace — boundary', () => {
  // A rough square walked ~100 m on a side.
  const squareWalk = [
    fix(0),
    fix(100),
    { ...fix(100), lon: 100 / DEGREE_M },
    { ...fix(0), lon: 100 / DEGREE_M },
  ];

  test('closes the ring back to the first vertex', () => {
    const { state } = walk(createTraceState({ mode: 'boundary' }), squareWalk);

    const finished = finishTrace(state);
    expect(finished.geometry.type).toBe('Polygon');
    const ring = finished.geometry.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(finished.warnings).toEqual([]);
  });

  test('the representative point is the area centroid, its length the perimeter', () => {
    const { state } = walk(createTraceState({ mode: 'boundary' }), squareWalk);

    const finished = finishTrace(state);
    expect(finished.representative.lat).toBeCloseTo(fix(50).lat, 6);
    expect(finished.representative.lon).toBeCloseTo(50 / DEGREE_M, 6);
    expect(finished.lengthM).toBeCloseTo(400, 0);
  });

  test('cannot close with fewer than three distinct vertices', () => {
    const { state } = walk(createTraceState({ mode: 'boundary' }), [fix(0), fix(100)]);

    expect(() => finishTrace(state)).toThrow(/three distinct/i);
  });

  test('a figure-eight closes with a warning, never a refusal', () => {
    // Diagonal, down, diagonal back: the first and third legs cross midway.
    const bowTieWalk = [
      fix(0),
      { ...fix(200), lon: 200 / DEGREE_M },
      { ...fix(0), lon: 200 / DEGREE_M },
      { ...fix(200), lon: 0 },
    ];
    const { state } = walk(createTraceState({ mode: 'boundary' }), bowTieWalk);

    const finished = finishTrace(state);
    expect(finished.geometry.type).toBe('Polygon');
    expect(finished.warnings).toEqual(['self-intersection']);
  });
});
