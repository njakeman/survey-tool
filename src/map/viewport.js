// Turning a PMTiles header into the map's opening viewport. Pure, because
// both rules below were learned the hard way and are worth pinning down
// without a renderer.

export function maxBoundsFromHeader(header) {
  // A whole-world maxBounds crashes MapLibre outright during construction —
  // verified against real Chromium and WebKit ("Cannot read properties of
  // null"). There is nothing to clamp there in any case: the map already
  // cannot pan beyond the world.
  if (header.minLon <= -180 && header.maxLon >= 180) return null;
  return [
    [header.minLon, header.minLat],
    [header.maxLon, header.maxLat],
  ];
}

export function minZoomFromHeader(header) {
  // Regional extracts often start well in (cissbury.pmtiles begins at z12),
  // and zooming out below that shows nothing at all. Skipped when the range
  // is degenerate — min === max is the case that breaks MapLibre's viewport
  // maths outright — or when the archive already covers the world view.
  if (header.maxZoom <= header.minZoom) return null;
  if (header.minZoom <= 0) return null;
  return header.minZoom;
}

export function initialZoomFromHeader(header, surveyZoom) {
  // Open where surveying happens rather than at the archive's overview zoom
  // (follow mode recentres on the first fix anyway), but never claim a depth
  // the archive has no tiles for, and respect its floor.
  return Math.max(header.minZoom, Math.min(surveyZoom, header.maxZoom));
}
