import { layers, namedFlavor } from '@protomaps/basemaps';
import { FONT_STACK } from './glyphs.js';

// Builds the MapLibre style for the offline basemap. Pure data — no browser
// deps — so the offline-critical guarantees below are node-testable.
//
// Two things make this style work with no network, ever:
//
// 1. ONE font stack. @protomaps/basemaps emits labels only when `lang` is
//    passed, and takes its fonts from flavor.regular/bold/italic (three Noto
//    stacks by default). Forcing all three to the same stack means only one
//    glyph directory has to be vendored into public/fonts/ and precached.
// 2. NO sprite. Icons would be a second hosted-asset dependency. Only three
//    non-POI layers reference one: roads_oneway and roads_shields are dropped
//    outright, and places_locality keeps its label with the icon stripped.
//    POI layers are never emitted because the flavor sets `pois: undefined`.
//
// The cost is no city dots below z8 and no highway shields. Labels — place,
// road and water names, the part that actually matters when you're standing
// in a field working out where you are — are kept.

const ICON_ONLY_LAYERS = new Set(['roads_oneway', 'roads_shields']);

const ATTRIBUTION =
  '<a href="https://openstreetmap.org">OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>';

function withoutIcons(layer) {
  if (!layer.layout || !('icon-image' in layer.layout)) return layer;
  const layout = { ...layer.layout };
  delete layout['icon-image'];
  delete layout['icon-size'];
  return { ...layer, layout };
}

// A raster archive is the surveyor's own imagery: one source, one layer, no
// glyphs or sprite because there is nothing to label, and emphatically no
// OpenStreetMap/Protomaps attribution — that would be a false claim about
// whose data it is. Any attribution comes from the archive itself.
function buildRasterStyle({ archiveKey, tileSize, attribution }) {
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        url: `pmtiles://${archiveKey}`,
        tileSize: tileSize ?? 256,
        ...(attribution ? { attribution } : {}),
      },
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  };
}

export function buildStyle({
  glyphsUrl,
  archiveKey = 'basemap',
  tileType = 'vector',
  tileSize,
  attribution,
}) {
  if (tileType === 'raster') return buildRasterStyle({ archiveKey, tileSize, attribution });

  const flavor = {
    ...namedFlavor('light'),
    regular: FONT_STACK,
    bold: FONT_STACK,
    italic: FONT_STACK,
    pois: undefined,
  };

  const styleLayers = layers('basemap', flavor, { lang: 'en' })
    .filter((layer) => !ICON_ONLY_LAYERS.has(layer.id))
    .map(withoutIcons);

  return {
    version: 8,
    glyphs: glyphsUrl,
    sources: {
      // The source id must stay 'basemap': @protomaps/basemaps binds every
      // layer it emits to that name. The archive key inside the URL is what
      // varies per map, so two open regions address different archives in
      // the shared pmtiles protocol registry.
      basemap: {
        type: 'vector',
        url: `pmtiles://${archiveKey}`,
        attribution: ATTRIBUTION,
      },
    },
    layers: styleLayers,
  };
}
