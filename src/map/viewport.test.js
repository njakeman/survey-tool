import { describe, expect, test } from 'vitest';
import {
  maxBoundsFromHeader,
  initialZoomFromHeader,
  minZoomFromHeader,
  observationBounds,
  fitViewport,
} from './viewport.js';

const londonHeader = {
  minLon: -1,
  minLat: 51,
  maxLon: 0.5,
  maxLat: 52,
  minZoom: 0,
  maxZoom: 15,
  centerZoom: 12,
};

describe('maxBoundsFromHeader', () => {
  test('clamps panning to a regional extract, so the surveyor cannot wander off the tiles', () => {
    expect(maxBoundsFromHeader(londonHeader)).toEqual([
      [-1, 51],
      [0.5, 52],
    ]);
  });

  test('returns null for a world-covering archive', () => {
    // Verified against real MapLibre in both Chromium and WebKit: passing
    // maxBounds that span the full -180..180 throws during construction
    // ("Cannot read properties of null"). There is nothing to clamp in that
    // case anyway — the map already cannot leave the world.
    expect(maxBoundsFromHeader({ ...londonHeader, minLon: -180, maxLon: 180 })).toBeNull();
  });

  test('treats bounds beyond the world as world-covering rather than passing them on', () => {
    expect(maxBoundsFromHeader({ ...londonHeader, minLon: -181, maxLon: 181 })).toBeNull();
  });

  test('still clamps latitude-only extracts that span all longitudes... by not clamping', () => {
    // A full-longitude band is the same crash case; latitude alone cannot
    // rescue it.
    expect(
      maxBoundsFromHeader({ ...londonHeader, minLon: -180, maxLon: 180, maxLat: 60 }),
    ).toBeNull();
  });
});

describe('minZoomFromHeader', () => {
  test('stops the surveyor zooming out past where the archive has tiles', () => {
    // A regional extract typically starts well in — cissbury.pmtiles begins
    // at z12 — so zooming out below that shows nothing at all.
    expect(minZoomFromHeader({ ...londonHeader, minZoom: 12, maxZoom: 17 })).toBe(12);
  });

  test('sets no floor for a degenerate range, which breaks MapLibre outright', () => {
    // min === max is the crash case the adapter already avoids; keep it out
    // of the zoom options entirely.
    expect(minZoomFromHeader({ ...londonHeader, minZoom: 0, maxZoom: 0 })).toBeNull();
  });

  test('sets no floor for an archive that already starts at the world view', () => {
    expect(minZoomFromHeader({ ...londonHeader, minZoom: 0, maxZoom: 15 })).toBeNull();
  });
});

describe('observationBounds', () => {
  const point = (lat, lon) => ({ lat, lon });

  test('is null with nothing to fit — no observations means no viewport claim', () => {
    expect(observationBounds([])).toBeNull();
    expect(observationBounds(undefined)).toBeNull();
  });

  test('wraps a set of points as [[west,south],[east,north]]', () => {
    expect(observationBounds([point(51.5, -0.14), point(51.6, -0.2), point(51.4, -0.1)])).toEqual([
      [-0.2, 51.4],
      [-0.1, 51.6],
    ]);
  });

  test('a traced observation widens the bounds to the whole walked geometry', () => {
    // The representative point is the distance-midpoint — fitting to it alone
    // would crop the ends of the walk.
    const traced = {
      lat: 51.5005,
      lon: -0.14,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-0.14, 51.5],
          [-0.15, 51.501],
        ],
      },
    };
    expect(observationBounds([traced])).toEqual([
      [-0.15, 51.5],
      [-0.14, 51.501],
    ]);
  });

  test('a traced boundary widens the bounds to its ring', () => {
    const ring = [
      [-0.14, 51.5],
      [-0.1386, 51.5],
      [-0.1386, 51.501],
      [-0.14, 51.501],
      [-0.14, 51.5],
    ];
    const traced = {
      lat: 51.5005,
      lon: -0.1393,
      geometry: { type: 'Polygon', coordinates: [ring] },
    };
    expect(observationBounds([traced])).toEqual([
      [-0.14, 51.5],
      [-0.1386, 51.501],
    ]);
  });

  test('a single point yields degenerate equal-corner bounds — the fit decides what to do', () => {
    expect(observationBounds([point(51.5, -0.14)])).toEqual([
      [-0.14, 51.5],
      [-0.14, 51.5],
    ]);
  });
});

describe('fitViewport', () => {
  test('null bounds fit nothing', () => {
    expect(fitViewport(null)).toBeNull();
  });

  test('degenerate bounds become a centre at max zoom — MapLibre must never see a zero-extent fit', () => {
    expect(
      fitViewport(
        [
          [-0.14, 51.5],
          [-0.14, 51.5],
        ],
        { maxZoom: 16 },
      ),
    ).toEqual({ center: [-0.14, 51.5], zoom: 16 });
  });

  test('real bounds pass through with padding and a zoom ceiling', () => {
    expect(
      fitViewport([
        [-0.2, 51.4],
        [-0.1, 51.6],
      ]),
    ).toEqual({
      bounds: [
        [-0.2, 51.4],
        [-0.1, 51.6],
      ],
      fitBoundsOptions: { padding: 40, maxZoom: 16 },
    });
  });
});

describe('initialZoomFromHeader', () => {
  test('opens at survey zoom when the archive goes that deep', () => {
    expect(initialZoomFromHeader({ ...londonHeader, maxZoom: 18 }, 16)).toBe(16);
  });

  test('never opens deeper than the archive actually has tiles for', () => {
    expect(initialZoomFromHeader({ ...londonHeader, maxZoom: 12 }, 16)).toBe(12);
  });

  test('respects a minimum-zoom floor above the survey zoom', () => {
    expect(initialZoomFromHeader({ ...londonHeader, minZoom: 17, maxZoom: 18 }, 16)).toBe(17);
  });
});
