// The online basemaps: map ground fetched live over the network, never
// stored. Pure data — the adapter and the picker both read it, and neither
// should have opinions about which provider it is.
//
// Each is a *region* to the rest of the app — it appears in the picker under
// the offline archives — but a different kind of one: nothing is downloaded,
// nothing touches IndexedDB, and it only shows ground while there is signal.
// `online: true` is the flag the selection logic and the picker key off.
// None has `bounds`, on purpose: bounds drive the position-based suggestion,
// and an online map that covers the world would otherwise be suggested
// everywhere, violating offered-never-imposed in the other direction.
//
// Two kinds of entry, told apart by which field they carry:
// - `tiles`: a raster tile URL template (aerial imagery). The adapter builds
//   the style locally around it.
// - `styleUrl`: a complete remote MapLibre style (the OpenFreeMap styles).
//   The adapter fetches the JSON itself and falls back to a local blank
//   style if that fails, so a dead network can never stop the map loading.
//
// Never bulk-fetch, cache, or store any of these tiles or styles for offline
// use. Esri's terms forbid it, and OpenFreeMap's public instance is offered
// for live per-tile use — bulk collection is the act their ToS is hostile
// to. Streaming tiles on demand is their documented quick-start usage.
// Offline ground is a PMTiles archive the user produces
// (docs/making-pmtiles.md).

// Where the map opens before the first fix centres it — the same
// open-at-a-fixed-centre behaviour an archive's header gives it. Roughly the
// middle of Great Britain, for want of anywhere better.
const CENTRE = { lat: 54.5, lon: -2.5 };

// OpenFreeMap's required credit. Their style JSON declares no attribution on
// any source, so it has to travel with the region and be injected
// (style.js prepareRemoteStyle) or the map would show none.
const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> · Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Their glyph endpoint serves OpenMapTiles fontstacks ('Noto Sans Regular'),
// not our vendored hyphenated stack — feature-layer labels drawn over these
// styles must ask for a stack the active glyph server actually has, or the
// text silently fails to render (the failure vendoring was built to end).
const OPENFREEMAP_FONT_STACK = 'Noto Sans Regular';

function openFreeMapStyle({ id, name, style }) {
  return {
    id,
    name,
    online: true,
    styleUrl: `https://tiles.openfreemap.org/styles/${style}`,
    attribution: OPENFREEMAP_ATTRIBUTION,
    featureFontStack: OPENFREEMAP_FONT_STACK,
    description: 'streetmap streamed over the network',
    centre: CENTRE,
  };
}

export const ONLINE_BASEMAPS = [
  // Aerial imagery. Why Esri and not Bing: Bing Maps' free tier was retired
  // on 30 June 2025 (the platform is folding into Azure Maps, paid), so it
  // cannot be the source. World Imagery's public tile endpoint is the
  // standard satellite layer in most web maps; the attribution string is
  // Esri's required credit and must travel with the tiles wherever they are
  // shown.
  {
    id: 'online-imagery',
    name: 'Aerial imagery (online)',
    online: true,
    // ArcGIS REST tile scheme is /tile/{level}/{row}/{col} — z/y/x, not
    // z/x/y.
    tiles:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    // The deepest zoom the service serves real tiles at over most of GB. A
    // source maxzoom, never a map zoom clamp — the map overzooms past it,
    // blurry beats blank, exactly as with archives.
    maxzoom: 19,
    attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    description: 'imagery streamed over the network',
    centre: CENTRE,
  },
  // The OpenFreeMap styles, under field names rather than product names:
  // what the ground looks like, not which upstream style built it.
  openFreeMapStyle({ id: 'online-light', name: 'Light (online)', style: 'positron' }),
  openFreeMapStyle({ id: 'online-simple', name: 'Simple (online)', style: 'liberty' }),
  openFreeMapStyle({ id: 'online-dark', name: 'Dark (online)', style: 'dark' }),
];

export function getOnlineBasemap(id) {
  return ONLINE_BASEMAPS.find((region) => region.id === id) ?? null;
}

export function isOnlineBasemap(id) {
  return getOnlineBasemap(id) !== null;
}
