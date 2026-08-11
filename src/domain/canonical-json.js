// Deterministic JSON serialisation: object keys sorted (recursively), fixed
// indentation, single trailing newline. Identical logical content must always
// produce identical bytes so exports are reproducible and diffable: the same
// session exported twice yields the same file, byte for byte, independent of
// property insertion order. (This originally served the planned GitHub sync's
// idempotency; sync was dropped in favour of export/import, but the guarantee
// is worth keeping — a re-export that differs only in key order would read as
// changed data to any diff or dedupe.)
//
// Array order is left untouched: unlike object keys, array order is
// meaningful (feature order in a FeatureCollection) and is the caller's
// decision, not this function's.

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = sortKeysDeep(value[key]);
        return sorted;
      }, {});
  }
  return value;
}

export function canonicalStringify(value) {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}
