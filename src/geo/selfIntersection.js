// Does a walked boundary cross itself? Used by the trace finish step to put
// a warning — never a refusal — on a figure-eight ring: warn-save-anyway is
// the decided policy, so this must stay out of createObservation or a saved
// boundary would fail its own re-import.
//
// Only proper (transversal) crossings count. Segments merely touching at a
// vertex are what GPS wobble produces on an honest walk; flagging them would
// make the warning fire constantly and mean nothing. Planar test on raw
// lon/lat — at field scale the projection error is irrelevant, the same
// argument centroid.js makes.

const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);

function properlyCross(a, b, c, d) {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// `coordinates` is a closed ring: first position repeated last.
export function ringSelfIntersects(coordinates) {
  if (!coordinates || coordinates.length < 4) return false;
  const segments = coordinates.length - 1;
  for (let i = 0; i < segments; i += 1) {
    for (let j = i + 2; j < segments; j += 1) {
      // The first and last segments are adjacent through the closure vertex,
      // not a crossing — a naive all-pairs test flags every closed ring.
      if (i === 0 && j === segments - 1) continue;
      if (properlyCross(coordinates[i], coordinates[i + 1], coordinates[j], coordinates[j + 1])) {
        return true;
      }
    }
  }
  return false;
}
