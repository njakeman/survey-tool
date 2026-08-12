import { distanceM } from '../geo/distance.js';
import { lineLengthM, midpointOnLine } from '../geo/lineMetrics.js';
import { polygonCentroid } from '../geo/centroid.js';
import { ringSelfIntersects } from '../geo/selfIntersection.js';

// The trace recorder: a pure reducer over position readings, no I/O. The
// caller (CapturePage's appender) feeds it every fix from the shared GPS
// watch; it decides which become vertices. Persisting an accepted vertex is
// the caller's job, keyed on `vertex !== null` — which is what keeps the
// no-watch-persistence carve-out narrow and testable: no write can happen
// without an accepted vertex, and acceptance is unit-tested here.

// Fixes worse than this never become vertices — cold-start and
// under-canopy junk would otherwise scribble on the line.
export const ACCURACY_GATE_M = 20;

// A vertex at least every this-many metres — but a fix must also move at
// least its own error bar (max of the two below), because 10 m of apparent
// movement on a ±15 m fix is noise, not walking. At walking pace this
// works out to roughly one vertex every four seconds at worst.
export const MIN_SPACING_M = 5;

// `vertices` seeds a state rebuilt from the draft store after a relaunch.
export function createTraceState({
  mode,
  vertices = [],
  minSpacingM = MIN_SPACING_M,
  accuracyGateM = ACCURACY_GATE_M,
}) {
  return { mode, vertices, minSpacingM, accuracyGateM, paused: false };
}

export function pauseTrace(state) {
  return { ...state, paused: true };
}

export function resumeTrace(state) {
  return { ...state, paused: false };
}

export function acceptFix(state, reading) {
  if (state.paused) return { state, vertex: null };
  if (!Number.isFinite(reading?.accuracyM) || reading.accuracyM > state.accuracyGateM) {
    return { state, vertex: null };
  }
  const last = state.vertices[state.vertices.length - 1];
  if (last) {
    const moved = distanceM(last, reading);
    if (moved < Math.max(state.minSpacingM, reading.accuracyM)) {
      return { state, vertex: null };
    }
  }
  const vertex = {
    seq: state.vertices.length,
    lat: reading.lat,
    lon: reading.lon,
    accuracyM: reading.accuracyM,
    fixAt: reading.fixAt,
  };
  return { state: { ...state, vertices: [...state.vertices, vertex] }, vertex };
}

export function traceStats(state) {
  const coordinates = state.vertices.map((v) => [v.lon, v.lat]);
  return {
    vertexCount: state.vertices.length,
    lengthM: lineLengthM(coordinates) ?? 0,
    worstAccuracyM: state.vertices.length
      ? Math.max(...state.vertices.map((v) => v.accuracyM))
      : null,
  };
}

function distinctCount(vertices) {
  return new Set(vertices.map((v) => `${v.lon},${v.lat}`)).size;
}

export function finishTrace(state) {
  const { mode, vertices } = state;
  if (mode === 'path' && vertices.length < 2) {
    throw new Error('finishTrace: a path needs at least two vertices');
  }
  if (mode === 'boundary' && distinctCount(vertices) < 3) {
    throw new Error('finishTrace: a boundary needs at least three distinct vertices');
  }

  const line = vertices.map((v) => [v.lon, v.lat]);
  const warnings = [];
  let geometry;
  let representative;

  if (mode === 'boundary') {
    const ring = [...line, line[0]];
    geometry = { type: 'Polygon', coordinates: [ring] };
    representative = polygonCentroid(geometry);
    if (ringSelfIntersects(ring)) warnings.push('self-intersection');
  } else {
    geometry = { type: 'LineString', coordinates: line };
    representative = midpointOnLine(line);
  }

  return {
    geometry,
    representative,
    gpsAccuracyM: traceStats(state).worstAccuracyM,
    // When measurement began; recordedAt (the Save tap, later) closes the
    // span — the existing two-timestamp semantics carry a trace's timing.
    fixAt: vertices[0].fixAt,
    lengthM: mode === 'boundary' ? lineLengthM(geometry.coordinates[0]) : lineLengthM(line),
    warnings,
  };
}
