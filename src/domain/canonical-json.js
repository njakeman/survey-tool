// Deterministic JSON serialisation: object keys sorted (recursively), fixed
// indentation, single trailing newline. Sync (Phase 5) relies on identical
// logical content always producing identical bytes — Git blobs are content-
// addressed by SHA, so a retry only avoids duplicate work if the same session
// serialises the same way every time, independent of property insertion order.
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
