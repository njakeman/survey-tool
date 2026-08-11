// The one online basemap: Esri World Imagery, fetched tile by tile over the
// network. Pure data — the adapter and the picker both read it, and neither
// should have opinions about which provider it is.
//
// Why Esri and not Bing: Bing Maps' free tier was retired on 30 June 2025
// (the platform is folding into Azure Maps, paid), so it cannot be the
// source. World Imagery's public tile endpoint is the standard satellite
// layer in most web maps; the attribution string below is Esri's required
// credit and must travel with the tiles wherever they are shown.
//
// This is a *region* to the rest of the app — it appears in the picker under
// the offline archives — but a different kind of one: nothing is downloaded,
// nothing touches IndexedDB, and it only shows imagery while there is
// signal. `online: true` is the flag the selection logic and the picker key
// off. It has no `bounds` on purpose: bounds drive the position-based
// suggestion, and an online map that covers the world would otherwise be
// suggested everywhere, violating offered-never-imposed in the other
// direction.
//
// Never bulk-fetch, cache, or store these tiles for offline use — the same
// rule as the OSM/OpenFreeMap prohibition, and Esri's terms are no
// friendlier. Offline imagery is a raster PMTiles archive the user produces
// (docs/making-pmtiles.md).
export const ONLINE_IMAGERY = {
  id: 'online-imagery',
  name: 'Aerial imagery (online)',
  online: true,
  // ArcGIS REST tile scheme is /tile/{level}/{row}/{col} — z/y/x, not z/x/y.
  tiles:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  tileSize: 256,
  // The deepest zoom the service serves real tiles at over most of GB. A
  // source maxzoom, never a map zoom clamp — the map overzooms past it,
  // blurry beats blank, exactly as with archives.
  maxzoom: 19,
  attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  // Where the map opens before the first fix centres it — the same
  // open-at-a-fixed-centre behaviour an archive's header gives it. Roughly
  // the middle of Great Britain, for want of anywhere better.
  centre: { lat: 54.5, lon: -2.5 },
};

export function isOnlineImagery(id) {
  return id === ONLINE_IMAGERY.id;
}
