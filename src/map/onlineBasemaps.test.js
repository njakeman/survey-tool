import { describe, expect, test } from 'vitest';
import { ONLINE_BASEMAPS, getOnlineBasemap, isOnlineBasemap } from './onlineBasemaps.js';
import { chooseActive, coversPosition } from './basemapSelection.js';

const IMAGERY = getOnlineBasemap('online-imagery');

describe('the online basemaps', () => {
  test('every entry is flagged online, identifiable, and unique', () => {
    expect(ONLINE_BASEMAPS.length).toBeGreaterThanOrEqual(4);
    for (const region of ONLINE_BASEMAPS) {
      expect(region.online).toBe(true);
      expect(isOnlineBasemap(region.id)).toBe(true);
      expect(getOnlineBasemap(region.id)).toBe(region);
    }
    expect(new Set(ONLINE_BASEMAPS.map((r) => r.id)).size).toBe(ONLINE_BASEMAPS.length);
    expect(isOnlineBasemap('cotswolds')).toBe(false);
    expect(getOnlineBasemap('cotswolds')).toBe(null);
  });

  test('each entry is either a tile template or a remote style, never both', () => {
    // The adapter branches on which one is present; an entry carrying both
    // would take the style arm and silently ignore the tiles.
    for (const region of ONLINE_BASEMAPS) {
      expect(Boolean(region.tiles) !== Boolean(region.styleUrl)).toBe(true);
    }
  });

  test('every entry carries its own attribution and a picker description', () => {
    // OpenFreeMap's style JSON declares no attribution at all, so the credit
    // has to travel with the region or the map would show none.
    for (const region of ONLINE_BASEMAPS) {
      expect(region.attribution).toBeTruthy();
      expect(region.description).toBeTruthy();
      expect(region.centre).toBeTruthy();
    }
  });

  test('aerial imagery keeps the ArcGIS z/y/x tile scheme', () => {
    // /tile/{level}/{row}/{col} — row before column. A z/x/y template would
    // fetch tiles mirrored about the diagonal and render the wrong ground.
    expect(IMAGERY.tiles.endsWith('/tile/{z}/{y}/{x}')).toBe(true);
  });

  test('the OpenFreeMap styles are Light, Simple and Dark', () => {
    expect(getOnlineBasemap('online-light')).toMatchObject({
      name: 'Light (online)',
      styleUrl: 'https://tiles.openfreemap.org/styles/positron',
    });
    expect(getOnlineBasemap('online-simple')).toMatchObject({
      name: 'Simple (online)',
      styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
    });
    expect(getOnlineBasemap('online-dark')).toMatchObject({
      name: 'Dark (online)',
      styleUrl: 'https://tiles.openfreemap.org/styles/dark',
    });
  });

  test('style-URL regions name the fontstack feature-layer labels should use', () => {
    // Their glyph server has 'Noto Sans Regular', not our vendored
    // 'noto-sans-regular' — without this, feature-layer labels over an
    // OpenFreeMap basemap would silently fail to render.
    for (const region of ONLINE_BASEMAPS.filter((r) => r.styleUrl)) {
      expect(region.featureFontStack).toBe('Noto Sans Regular');
    }
  });

  test('no entry has bounds, so none can ever be suggested from a fix', () => {
    // Bounds drive the position suggestion; a world-covering online map
    // would otherwise be suggested everywhere. Offered, never imposed.
    for (const region of ONLINE_BASEMAPS) {
      expect(region.bounds).toBeUndefined();
      expect(coversPosition(region, { lat: 51.5, lon: -1.8 })).toBe(false);
    }
  });

  test('none is ever auto-selected in place of a downloaded region, or as a default', () => {
    const downloaded = { id: 'cotswolds', downloaded: true, bounds: [-2, 51, -1, 52] };

    // With a downloaded region present, that region wins.
    expect(chooseActive({ regions: [...ONLINE_BASEMAPS, downloaded] }).activeId).toBe('cotswolds');
    // With nothing downloaded, no map is offered rather than an online one —
    // an online default would look like a working basemap on a device that
    // has nothing usable in the field.
    expect(chooseActive({ regions: [...ONLINE_BASEMAPS] }).activeId).toBe(null);
  });

  test('a remembered selection of each is honoured', () => {
    const downloaded = { id: 'cotswolds', downloaded: true, bounds: [-2, 51, -1, 52] };
    for (const region of ONLINE_BASEMAPS) {
      const { activeId } = chooseActive({
        regions: [...ONLINE_BASEMAPS, downloaded],
        selectedId: region.id,
      });
      expect(activeId).toBe(region.id);
    }
  });

  test('while one is active, a downloaded region covering the fix is still offered', () => {
    // Same rule as between two archives: the offer appears, the map never
    // switches without a tap.
    const downloaded = { id: 'cotswolds', downloaded: true, bounds: [-2, 51, -1, 52] };
    const { activeId, suggestionId } = chooseActive({
      regions: [...ONLINE_BASEMAPS, downloaded],
      selectedId: 'online-light',
      position: { lat: 51.5, lon: -1.5 },
    });

    expect(activeId).toBe('online-light');
    expect(suggestionId).toBe('cotswolds');
  });
});
