// WGS84/ETRS89 latitude and longitude to an Ordnance Survey grid reference,
// offline and exactly.
//
// Two steps, and the second is the one people skip. Projecting lat/lon onto
// the National Grid's transverse Mercator gets you *ETRS89* eastings and
// northings — the right map projection on the wrong datum, out by around
// 100 m. OSTN15 is the correction: a grid of measured shifts, interpolated at
// the point, that carries you from ETRS89 to OSGB36. Skipping it, or
// substituting a single-parameter Helmert transform, leaves 4–5 m of error on
// a reading whose GPS accuracy is 5–10 m — roughly doubling the uncertainty
// the surveyor is being asked to trust.
//
// The shift grid is passed in rather than imported: it is 34 kB of data
// fetched from public/geodesy/, and this module stays pure and node-testable
// against Ordnance Survey's own published test points (osgb.test.js). Same
// dependency-injection rule as sensors/position.js taking navigator.geolocation.
//
// Contains OS data © Crown copyright and database right 2026.

// GRS80, the ETRS89 ellipsoid. Deliberately not Airy 1830: the projection
// happens *before* the datum shift, so it runs on the ellipsoid the GPS fix
// is expressed on.
const A = 6378137.0;
const B = 6356752.314140356;

// National Grid transverse Mercator parameters.
const F0 = 0.9996012717;
const LAT_ORIGIN = (49 * Math.PI) / 180;
const LON_ORIGIN = (-2 * Math.PI) / 180;
const EAST_ORIGIN = 400000;
const NORTH_ORIGIN = -100000;

// The National Grid's lettered squares run 7 wide by 13 tall at 100 km each.
const SQUARE_M = 100000;
const SQUARES_EAST = 7;
const SQUARES_NORTH = 13;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

// Lat/lon to eastings and northings on the National Grid projection, still on
// the ETRS89 datum. Ordnance Survey's "Guide to coordinate systems in Great
// Britain", Annex C — the series expansion, not an approximation of it.
function project(latDeg, lonDeg) {
  const lat = toRadians(latDeg);
  const lon = toRadians(lonDeg);

  const e2 = (A * A - B * B) / (A * A);
  const n = (A - B) / (A + B);
  const n2 = n * n;
  const n3 = n2 * n;

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);
  const tan2 = tanLat * tanLat;
  const tan4 = tan2 * tan2;
  const cos3 = cosLat * cosLat * cosLat;
  const cos5 = cos3 * cosLat * cosLat;

  const nu = (A * F0) / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (A * F0 * (1 - e2)) / (1 - e2 * sinLat * sinLat) ** 1.5;
  const eta2 = nu / rho - 1;

  const dLat = lat - LAT_ORIGIN;
  const sLat = lat + LAT_ORIGIN;
  const m =
    B *
    F0 *
    ((1 + n + (5 / 4) * n2 + (5 / 4) * n3) * dLat -
      (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(dLat) * Math.cos(sLat) +
      ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * dLat) * Math.cos(2 * sLat) -
      (35 / 24) * n3 * Math.sin(3 * dLat) * Math.cos(3 * sLat));

  const i = m + NORTH_ORIGIN;
  const ii = (nu / 2) * sinLat * cosLat;
  const iii = (nu / 24) * sinLat * cos3 * (5 - tan2 + 9 * eta2);
  const iiia = (nu / 720) * sinLat * cos5 * (61 - 58 * tan2 + tan4);
  const iv = nu * cosLat;
  const v = (nu / 6) * cos3 * (nu / rho - tan2);
  const vi = (nu / 120) * cos5 * (5 - 18 * tan2 + tan4 + 14 * eta2 - 58 * tan2 * eta2);

  const dLon = lon - LON_ORIGIN;
  const dLon2 = dLon * dLon;
  const dLon3 = dLon2 * dLon;
  const dLon4 = dLon2 * dLon2;
  const dLon5 = dLon4 * dLon;
  const dLon6 = dLon4 * dLon2;

  return {
    easting: EAST_ORIGIN + iv * dLon + v * dLon3 + vi * dLon5,
    northing: i + ii * dLon2 + iii * dLon4 + iiia * dLon6,
  };
}

// Bilinear interpolation of the shift at a point, from the four grid nodes
// around it. The node order matches Ordnance Survey's own worked examples:
// south-west, south-east, north-east, north-west.
function interpolateShift(easting, northing, grid) {
  const { spacing, eastCount, northCount, se, sn } = grid;

  const eastIndex = Math.floor(easting / spacing);
  const northIndex = Math.floor(northing / spacing);

  // Needs a complete square of four nodes. On the far edge there is no
  // fourth corner, and extrapolating a datum shift past the edge of the
  // measured grid produces a confident number with nothing behind it.
  if (
    eastIndex < 0 ||
    northIndex < 0 ||
    eastIndex >= eastCount - 1 ||
    northIndex >= northCount - 1
  ) {
    return null;
  }

  const t = (easting - eastIndex * spacing) / spacing;
  const u = (northing - northIndex * spacing) / spacing;

  const sw = northIndex * eastCount + eastIndex;
  const seIdx = sw + 1;
  const nw = sw + eastCount;
  const ne = nw + 1;

  const blend = (values) =>
    (1 - t) * (1 - u) * values[sw] +
    t * (1 - u) * values[seIdx] +
    t * u * values[ne] +
    (1 - t) * u * values[nw];

  return { shiftEast: blend(se), shiftNorth: blend(sn) };
}

// OSGB36 eastings and northings, or null if the point is off the grid.
export function toEastingNorthing(lat, lon, grid) {
  if (!grid || lat == null || lon == null) return null;

  const projected = project(lat, lon);
  const shift = interpolateShift(projected.easting, projected.northing, grid);
  if (!shift) return null;

  return {
    easting: projected.easting + shift.shiftEast,
    northing: projected.northing + shift.shiftNorth,
  };
}

// The 100 km square's two letters. Both positions skip 'I' — the National
// Grid has no square containing it, and forgetting that shifts every square
// east of H by one, which is the kind of error that looks entirely plausible
// on a printout.
function squareLetters(easting, northing) {
  const e100k = Math.floor(easting / SQUARE_M);
  const n100k = Math.floor(northing / SQUARE_M);
  if (e100k < 0 || e100k >= SQUARES_EAST || n100k < 0 || n100k >= SQUARES_NORTH) return null;

  const first = 19 - n100k - ((19 - n100k) % 5) + Math.floor((e100k + 10) / 5);
  const second = (((19 - n100k) * 5) % 25) + (e100k % 5);
  const letter = (index) => String.fromCharCode(index + (index > 7 ? 1 : 0) + 'A'.charCodeAt(0));

  return letter(first) + letter(second);
}

// Eastings and northings to a grid reference like "SU 14082 39216".
// `digits` is per axis: 5 is metre precision, 3 is the 100 m form a surveyor
// reads over a radio.
//
// Separate from the transformation because it is separately testable: OS's
// published test points give numeric eastings and northings only, so the
// lettering is the one part of this module their file cannot check.
export function formatGridRef(easting, northing, digits = 5) {
  if (easting == null || northing == null) return null;
  const letters = squareLetters(easting, northing);
  if (!letters) return null;

  // Truncated, never rounded: rounding 99999.6 up carries into the next
  // 100 km square and prints a reference in a square the point is not in.
  const scale = SQUARE_M / 10 ** digits;
  const east = Math.floor((easting % SQUARE_M) / scale);
  const north = Math.floor((northing % SQUARE_M) / scale);

  // Padded, because "432" where "00432" was meant reads as 43 km away.
  return `${letters} ${String(east).padStart(digits, '0')} ${String(north).padStart(digits, '0')}`;
}

export function toGridRef(lat, lon, grid, digits = 5) {
  const point = toEastingNorthing(lat, lon, grid);
  if (!point) return null;
  return formatGridRef(point.easting, point.northing, digits);
}
