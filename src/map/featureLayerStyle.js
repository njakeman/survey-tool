import { FONT_STACK } from './glyphs.js';

// Turns a loaded feature layer into the MapLibre source and layers that draw
// it. Pure data, no maplibre import — same rule as style.js and overlays.js,
// so the geometry filters and paint below are node-testable rather than only
// observable on a real map.
//
// Three layers are emitted unconditionally, each filtered to one geometry
// family, rather than being chosen from a declared geometry list. A layer
// matching nothing costs nothing at render time, and this way the style can
// never fall out of step with what the file actually contains — which it
// would the first time someone edited a .geojson without regenerating the
// manifest.

// The paper colour from the app palette, as a literal: MapLibre paints to a
// canvas and cannot read CSS custom properties (see overlays.js).
const HALO = '#f4f0e8';

// Every value a `<id>.style.json` sidecar can declare, and what it means when
// it doesn't. Lives here rather than in featureLayerManifest.js, which is
// Node-only: that module reaches manifest.js for its filename helper, which
// imports node:fs, and importing it from this side dragged the whole build
// step into the browser bundle.
//
// The colour is deliberately not '#c2611f'. That is the live fix and its
// accuracy ring, and a layer defaulting to it would scatter a dozen things
// across the map that read as "you are here".
export const DEFAULT_STYLE = Object.freeze({
  colour: '#1c5f9e',
  lineWidth: 2,
  fillOpacity: 0.15,
  circleRadius: 5,
  // Which property identifies a feature, titles it in the sheet, and labels
  // it on the map. All null by default: guessing at a "name-ish" key gets it
  // wrong on exactly the datasets that matter.
  idProperty: null,
  titleProperty: null,
  labelProperty: null,
  // Which attributes to show first in the sheet, and in what order. The rest
  // follow alphabetically.
  fieldOrder: [],
  minZoom: 0,
});

export function featureLayerSourceId(id) {
  // Namespaced because 'basemap', 'position' and 'observations' are already
  // taken and a layer is named after whatever its file was called.
  return `feature-layer-${id}`;
}

export function featureLayerSource({ geojson }) {
  return { type: 'geojson', data: geojson };
}

function resolve(style) {
  return { ...DEFAULT_STYLE, ...(style ?? {}) };
}

// `fontStack` overrides the label font for basemaps whose glyph server is
// not ours: a remote-style basemap (onlineBasemaps.js styleUrl entries)
// replaces the map's glyphs URL with the provider's, which has no
// 'noto-sans-regular' — labels must ask for a stack that server actually
// serves, or the text silently fails to render.
export function featureLayerLayers(layer, { fontStack = FONT_STACK } = {}) {
  const style = resolve(layer.style);
  const source = featureLayerSourceId(layer.id);
  const prefix = source;
  // Omitted rather than written as 0: a no-op minzoom in the style is noise
  // that reads like a decision.
  const zoom = style.minZoom ? { minzoom: style.minZoom } : {};

  const layers = [
    {
      id: `${prefix}-fill`,
      type: 'fill',
      source,
      ...zoom,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': style.colour, 'fill-opacity': style.fillOpacity },
    },
    {
      // Polygons take the line layer too. A 15%-opacity fill on its own is
      // close to invisible over aerial imagery — the outline is what makes a
      // boundary readable in sunlight.
      id: `${prefix}-line`,
      type: 'line',
      source,
      ...zoom,
      filter: ['match', ['geometry-type'], ['LineString', 'Polygon'], true, false],
      paint: { 'line-color': style.colour, 'line-width': style.lineWidth },
    },
    {
      id: `${prefix}-circle`,
      type: 'circle',
      source,
      ...zoom,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': style.circleRadius,
        'circle-color': style.colour,
        // Without the pale ring, a dark point vanishes against dark imagery.
        'circle-stroke-width': 2,
        'circle-stroke-color': HALO,
      },
    },
  ];

  if (style.labelProperty) {
    layers.push({
      id: `${prefix}-label`,
      type: 'symbol',
      source,
      ...zoom,
      // Features without the property would otherwise draw an empty label.
      filter: ['has', style.labelProperty],
      layout: {
        'text-field': ['to-string', ['get', style.labelProperty]],
        'text-font': [fontStack],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.8],
      },
      paint: {
        'text-color': style.colour,
        // A bare word over aerial imagery is unreadable. The halo is not
        // decoration.
        'text-halo-color': HALO,
        'text-halo-width': 1.5,
      },
    });
  }

  return layers;
}

// What the tap query is restricted to. Labels are included deliberately:
// tapping the word should select the feature, and a duplicate hit costs
// nothing because the query takes the topmost result anyway.
export function featureLayerIds(layer) {
  return featureLayerLayers(layer).map((mapLayer) => mapLayer.id);
}

// The selection highlight: one persistent source holding the currently
// selected feature (or nothing), echoed in every geometry family the layers
// draw. The paint lives here with the rest of the feature-layer visual
// language so "selection reads as selection" is node-testable.
export const HIGHLIGHT_SOURCE_ID = 'feature-highlight';

// Not '#c2611f' (the live fix and the marks — see DEFAULT_STYLE above) and
// not the layer default blue: the selection has to read as "this one", over
// pale paper and dark imagery both. Amber is the one hue neither ground nor
// any sane layer style uses.
const HIGHLIGHT_COLOUR = '#eab308';

export function highlightSourceData(geometry) {
  // Always a FeatureCollection — empty is "no selection", never a missing
  // source — so the map's source can be set unconditionally.
  return {
    type: 'FeatureCollection',
    features: geometry ? [{ type: 'Feature', properties: {}, geometry }] : [],
  };
}

export function highlightLayers() {
  const source = HIGHLIGHT_SOURCE_ID;
  return [
    {
      id: `${source}-fill`,
      type: 'fill',
      source,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': HIGHLIGHT_COLOUR, 'fill-opacity': 0.3 },
    },
    {
      id: `${source}-line`,
      type: 'line',
      source,
      filter: ['match', ['geometry-type'], ['LineString', 'Polygon'], true, false],
      // Wider than any layer's own outline, so the selection shows as a rim
      // around the feature rather than vanishing behind its stroke.
      paint: { 'line-color': HIGHLIGHT_COLOUR, 'line-width': 5 },
    },
    {
      id: `${source}-circle`,
      type: 'circle',
      source,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 9,
        // A ring, not a dot: the layer's own point stays visible inside it.
        'circle-color': 'transparent',
        'circle-stroke-width': 4,
        'circle-stroke-color': HIGHLIGHT_COLOUR,
      },
    },
  ];
}
