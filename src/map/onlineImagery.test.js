import { describe, expect, test } from 'vitest';
import { ONLINE_IMAGERY, isOnlineImagery } from './onlineImagery.js';
import { chooseActive, coversPosition } from './basemapSelection.js';

describe('the online imagery region', () => {
  test('is flagged online and identifiable by id', () => {
    expect(ONLINE_IMAGERY.online).toBe(true);
    expect(isOnlineImagery(ONLINE_IMAGERY.id)).toBe(true);
    expect(isOnlineImagery('cotswolds')).toBe(false);
  });

  test('uses the ArcGIS z/y/x tile scheme', () => {
    // /tile/{level}/{row}/{col} — row before column. A z/x/y template would
    // fetch tiles mirrored about the diagonal and render the wrong ground.
    expect(ONLINE_IMAGERY.tiles.endsWith('/tile/{z}/{y}/{x}')).toBe(true);
  });

  test('has no bounds, so it can never be suggested from a fix', () => {
    // Bounds drive the position suggestion; a world-covering online map
    // would otherwise be suggested everywhere. Offered, never imposed.
    expect(ONLINE_IMAGERY.bounds).toBeUndefined();
    expect(coversPosition(ONLINE_IMAGERY, { lat: 51.5, lon: -1.8 })).toBe(false);
  });

  test('is never auto-selected in place of a downloaded region, or as a default', () => {
    const downloaded = { id: 'cotswolds', downloaded: true, bounds: [-2, 51, -1, 52] };

    // With a downloaded region present, that region wins.
    expect(chooseActive({ regions: [ONLINE_IMAGERY, downloaded] }).activeId).toBe('cotswolds');
    // With nothing downloaded, no map is offered rather than the online one —
    // an online default would look like a working basemap on a device that
    // has nothing usable in the field.
    expect(chooseActive({ regions: [ONLINE_IMAGERY] }).activeId).toBe(null);
  });

  test('a remembered selection of it is honoured', () => {
    const downloaded = { id: 'cotswolds', downloaded: true, bounds: [-2, 51, -1, 52] };
    const { activeId } = chooseActive({
      regions: [ONLINE_IMAGERY, downloaded],
      selectedId: ONLINE_IMAGERY.id,
    });

    expect(activeId).toBe(ONLINE_IMAGERY.id);
  });

  test('while it is active, a downloaded region covering the fix is still offered', () => {
    // Same rule as between two archives: the offer appears, the map never
    // switches without a tap.
    const downloaded = { id: 'cotswolds', downloaded: true, bounds: [-2, 51, -1, 52] };
    const { activeId, suggestionId } = chooseActive({
      regions: [ONLINE_IMAGERY, downloaded],
      selectedId: ONLINE_IMAGERY.id,
      position: { lat: 51.5, lon: -1.5 },
    });

    expect(activeId).toBe(ONLINE_IMAGERY.id);
    expect(suggestionId).toBe('cotswolds');
  });
});
