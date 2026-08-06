import { monotonicFactory } from 'ulid';

// monotonicFactory (not the bare `ulid()` export) guarantees strictly
// increasing IDs even for two calls in the same millisecond — sessions and
// observations are sorted by id for a stable GeoJSON feature order (see
// domain/geojson.js), and plain ulid()'s random suffix doesn't promise that.
const ulid = monotonicFactory();

export function newId() {
  return ulid();
}

export function nowIso() {
  return new Date().toISOString();
}
