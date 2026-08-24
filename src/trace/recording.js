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

// Fixes arrive at roughly 1 Hz while the app is foregrounded; a silence this
// long means the platform suspended the page (no background geolocation in a
// PWA, on either OS) or the receiver lost the sky. Either way the ground
// walked during it was not measured, and the segment that spans it is
// inferred, not walked. Detection is on the FIX stream, never on vertex
// spacing — standing still keeps fixes flowing while adding no vertices.
export const GAP_THRESHOLD_MS = 15_000;

// `vertices` seeds a state rebuilt from the draft store after a relaunch.
export function createTraceState({
  mode,
  vertices = [],
  minSpacingM = MIN_SPACING_M,
  accuracyGateM = ACCURACY_GATE_M,
}) {
  return {
    mode,
    vertices,
    minSpacingM,
    accuracyGateM,
    paused: false,
    lastFixAtMs: null,
    pendingGap: false,
  };
}

export function pauseTrace(state) {
  return { ...state, paused: true };
}

// Resuming flags the next segment: the paused stretch was walked unmeasured,
// which is the same honesty problem as a background gap (decision 2026-08-24).
export function resumeTrace(state) {
  return { ...state, paused: false, pendingGap: true };
}

// The caller saw the page hide (visibilitychange) — belt to the time rule's
// braces, for the platforms that suspend without ever leaving a silence the
// clock can see (a fix delivered milliseconds before the freeze).
export function noteInterruption(state) {
  return state.pendingGap ? state : { ...state, pendingGap: true };
}

// A rejected fix still moves the stream clock (and may notice a gap) — but
// returns the SAME state object when nothing actually changed, because the
// appender re-offers the current fix whenever its effect re-runs and a fresh
// object each time would make that effect loop.
function observeStream(state, reading) {
  const t = Number.isFinite(reading?.fixAtMs) ? reading.fixAtMs : null;
  const gapNoticed =
    t !== null && state.lastFixAtMs !== null && t - state.lastFixAtMs > GAP_THRESHOLD_MS;
  const lastFixAtMs = t ?? state.lastFixAtMs;
  const pendingGap = state.pendingGap || gapNoticed;
  if (lastFixAtMs === state.lastFixAtMs && pendingGap === state.pendingGap) return state;
  return { ...state, lastFixAtMs, pendingGap };
}

export function acceptFix(state, reading) {
  if (state.paused) return { state, vertex: null };
  const observed = observeStream(state, reading);
  if (!Number.isFinite(reading?.accuracyM) || reading.accuracyM > observed.accuracyGateM) {
    return { state: observed, vertex: null };
  }
  const last = observed.vertices[observed.vertices.length - 1];
  if (last) {
    const moved = distanceM(last, reading);
    if (moved < Math.max(observed.minSpacingM, reading.accuracyM)) {
      return { state: observed, vertex: null };
    }
  }
  const vertex = {
    seq: observed.vertices.length,
    lat: reading.lat,
    lon: reading.lon,
    accuracyM: reading.accuracyM,
    fixAt: reading.fixAt,
    // The first vertex has no preceding segment to infer.
    gapBefore: observed.pendingGap && observed.vertices.length > 0,
  };
  return {
    state: { ...observed, vertices: [...observed.vertices, vertex], pendingGap: false },
    vertex,
  };
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
    // seq i here means "the segment from coordinate i-1 to i was inferred,
    // not walked" — a background gap, a pause, or a recovered draft resumed.
    // A boundary's synthetic closing segment can never be flagged.
    gaps: vertices.filter((v) => v.gapBefore).map((v) => v.seq),
  };
}
