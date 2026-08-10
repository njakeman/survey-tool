import { monotonicFactory } from 'ulid';

// monotonicFactory (not the bare `ulid()` export) guarantees strictly
// increasing IDs even for two calls in the same millisecond — GeoJSON
// feature order is recordedAt with id as the tiebreak (see
// domain/geojson.js), so same-instant saves stay stably ordered, which
// plain ulid()'s random suffix doesn't promise.
const ulid = monotonicFactory();

export function newId() {
  return ulid();
}

export function nowIso() {
  return new Date().toISOString();
}
