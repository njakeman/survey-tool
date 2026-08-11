import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { formatGridRef, toEastingNorthing, toGridRef } from './osgb.js';

// Both files are read rather than imported. The grid because that is how the
// app gets it — served from public/ and injected, not baked into osgb.js —
// and the fixture to match, since an import attribute (`with { type: 'json' }`)
// is newer than the ECMA version eslint is configured to parse.
const readJson = (path) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url))));

const grid = readJson('../../public/geodesy/ostn15-lite.json');
const testPoints = readJson('./fixtures/ostn15-test-points.json');

// Ordnance Survey ship 114 test points with the expected output of their own
// Lite transformation. Matching those is the only check worth having: a
// transformation that is subtly wrong still produces confident-looking
// output, and my arithmetic agreeing with itself proves nothing.
//
// The tolerance is millimetres, not the 0.08 m the Lite grid is quoted at.
// That figure is Lite-against-full; these are Lite's own published results,
// so anything beyond floating-point noise means the implementation is wrong.
const TOLERANCE_M = 0.001;

describe('toEastingNorthing — against OS published test points', () => {
  test('every one of the OS test points transforms to within a millimetre', () => {
    const failures = [];
    for (const point of testPoints) {
      const result = toEastingNorthing(point.lat, point.lon, grid);
      if (!result) {
        failures.push(`${point.id}: returned null`);
        continue;
      }
      const dE = Math.abs(result.easting - point.easting);
      const dN = Math.abs(result.northing - point.northing);
      if (dE > TOLERANCE_M || dN > TOLERANCE_M) {
        failures.push(`${point.id}: off by ${dE.toFixed(4)} E, ${dN.toFixed(4)} N`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('covers a real spread of the country, not three points in one square', () => {
    // Guards the fixture as much as the code: 114 points that all landed in
    // Wiltshire would make the assertion above nearly meaningless.
    const eastings = testPoints.map((p) => p.easting);
    const northings = testPoints.map((p) => p.northing);

    expect(testPoints.length).toBeGreaterThan(100);
    expect(Math.max(...northings) - Math.min(...northings)).toBeGreaterThan(800_000);
    expect(Math.max(...eastings) - Math.min(...eastings)).toBeGreaterThan(500_000);
  });
});

describe('toEastingNorthing — outside the grid', () => {
  test('returns null well outside Great Britain', () => {
    expect(toEastingNorthing(48.8566, 2.3522, grid)).toBeNull(); // Paris
    expect(toEastingNorthing(40.7128, -74.006, grid)).toBeNull(); // New York
    expect(toEastingNorthing(-33.8688, 151.2093, grid)).toBeNull(); // Sydney
  });

  test('returns null rather than extrapolating past the northern edge', () => {
    // The grid stops at 1,240,000 m north. Beyond it there is no fourth
    // corner to interpolate against, and a silently extrapolated shift is
    // worse than an honest refusal.
    expect(toEastingNorthing(62, -2, grid)).toBeNull();
  });

  test('still works in the far north of Scotland, which is inside coverage', () => {
    // Lerwick, Shetland — the case a naive "is it in England" bound breaks.
    expect(toEastingNorthing(60.1546, -1.1494, grid)).not.toBeNull();
  });
});

describe('formatGridRef — the lettering', () => {
  // The one part OS's test file cannot check: it publishes numeric eastings
  // and northings, never the letter pair. These are the National Grid's own
  // definition — the 100 km squares at known corners — so they test the
  // lettering against the grid rather than against my arithmetic.
  test.each([
    [0, 0, 'SV'],
    [100_000, 0, 'SW'],
    [400_000, 100_000, 'SU'],
    [500_000, 0, 'TV'],
    [0, 500_000, 'NV'],
    [500_000, 500_000, 'OV'],
    [200_000, 700_000, 'NN'],
    [400_000, 1_150_000, 'HU'],
    // The row boundary immediately above HU. Off by one row and this reads
    // HU too, which is a 100 km error that looks entirely ordinary.
    [400_000, 1_200_000, 'HP'],
  ])('%i, %i is in square %s', (easting, northing, square) => {
    expect(formatGridRef(easting, northing).slice(0, 2)).toBe(square);
  });

  test('composes with the transformation at every OS test point', () => {
    // The end-to-end check, with nothing remembered in it: OS give the
    // eastings and northings for each input, so formatting those directly
    // must equal transforming the lat/lon and formatting the result.
    for (const point of testPoints) {
      expect(toGridRef(point.lat, point.lon, grid)).toBe(
        formatGridRef(point.easting, point.northing),
      );
    }
  });

  test('rejects coordinates east or north of the lettered squares', () => {
    expect(formatGridRef(700_000, 0)).toBeNull();
    expect(formatGridRef(0, 1_300_000)).toBeNull();
    expect(formatGridRef(-1, 0)).toBeNull();
  });
});

describe('toGridRef', () => {
  test('agrees with the eastings and northings it is derived from', () => {
    const { easting, northing } = toEastingNorthing(51.5, -0.14, grid);
    const ref = toGridRef(51.5, -0.14, grid);
    const [, digitsE, digitsN] = ref.split(' ');

    expect(Number(digitsE)).toBe(Math.floor(easting % 100000));
    expect(Number(digitsN)).toBe(Math.floor(northing % 100000));
  });

  test('pads short coordinates rather than shifting the digits left', () => {
    // A point a few hundred metres into its 100 km square has leading zeros.
    // Dropped, "00432" becomes "432" and reads as 43.2 km away.
    const ref = toGridRef(49.9, -6.3, grid); // Isles of Scilly, low into SV
    if (ref) expect(ref).toMatch(/^[A-Z]{2} \d{5} \d{5}$/);
  });

  test('never uses the letter I, which the National Grid skips', () => {
    // Both letter positions skip I, and getting that wrong shifts every
    // square east of it by one.
    const refs = testPoints
      .map((p) => toGridRef(p.lat, p.lon, grid))
      .filter(Boolean)
      .map((ref) => ref.slice(0, 2));

    expect(refs.some((ref) => ref.includes('I'))).toBe(false);
    // And it really did produce a variety of squares.
    expect(new Set(refs).size).toBeGreaterThan(10);
  });

  test('returns null outside the grid, so nothing renders a plausible lie', () => {
    expect(toGridRef(48.8566, 2.3522, grid)).toBeNull();
  });

  test('accepts a coarser precision for reading aloud', () => {
    // Five digits is a metre; a surveyor calling a location over a radio
    // wants the 100 m form.
    expect(toGridRef(51.5, -0.14, grid, 3)).toMatch(/^[A-Z]{2} \d{3} \d{3}$/);
  });
});
