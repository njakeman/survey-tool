import { describe, expect, test } from 'vitest';
import {
  ACCURACY_GATE_M,
  MIN_SPACING_M,
  acceptFix,
  createTraceState,
  finishTrace,
  pauseTrace,
  resumeTrace,
  traceStats,
} from './recording.js';
import { distanceM } from '../geo/distance.js';

const DEGREE_M = distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });

// A reading standing `metres` north of the origin. Trace rules are all about
// distances, so the fixtures speak metres and convert to degrees once here.
function fix(metres, { accuracyM = 5, fixAt = '2026-08-12T10:00:00.000Z' } = {}) {
  return { lat: metres / DEGREE_M, lon: 0, accuracyM, fixAt };
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
    });
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
  });

  test('cannot finish with fewer than two vertices', () => {
    const { state } = acceptFix(createTraceState({ mode: 'path' }), fix(0));

    expect(() => finishTrace(state)).toThrow(/at least two/i);
  });
});

describe('finishTrace — boundary', () => {
  // A rough square walked ~100 m on a side.
  const squareWalk = [fix(0), fix(100), { ...fix(100), lon: 100 / DEGREE_M }, { ...fix(0), lon: 100 / DEGREE_M }];

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
