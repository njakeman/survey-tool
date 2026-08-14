// Pure builders for what the app draws *on top of* the basemap: the current
// fix, its accuracy ring, and the session's saved observations. No maplibre
// import — these produce plain GeoJSON and style expressions, so the fiddly
// parts (coordinate order, the metres→pixels maths) are node-testable.
//
// Deliberately NOT reusing domain/geojson.js: that module's output is the
// export/sync payload, whose bytes sync's idempotency depends on. Map markers
// have different needs (lean properties, synced state) and must never be able
// to perturb those bytes.

// Web Mercator ground resolution at the equator, zoom 0, 256px tiles.
const EQUATOR_METRES_PER_PIXEL = 156543.03392;

// The zoom range the ring expression is anchored across. Base-2 exponential
// interpolation between two anchors is exact for this relationship (the
// pixel size of a fixed distance doubles per zoom level), so two suffice.
const MIN_ANCHOR_ZOOM = 0;
const MAX_ANCHOR_ZOOM = 22;

export function metresToPixels(metres, lat, zoom) {
  const metresPerPixel = (EQUATOR_METRES_PER_PIXEL * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  return metres / metresPerPixel;
}

export function positionFeature(reading) {
  if (!reading) return null;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [reading.lon, reading.lat] },
    properties: {},
  };
}

export function accuracyRadiusExpression(reading) {
  if (!reading) return null;
  const { accuracyM, lat } = reading;
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    MIN_ANCHOR_ZOOM,
    metresToPixels(accuracyM, lat, MIN_ANCHOR_ZOOM),
    MAX_ANCHOR_ZOOM,
    metresToPixels(accuracyM, lat, MAX_ANCHOR_ZOOM),
  ];
}

// Marker colours are literals rather than CSS tokens: MapLibre paints on a
// canvas and cannot read custom properties, and the basemap style itself does
// not follow the OS colour scheme — so these are keyed to the map's own light
// flavour, not to the interface around it.
const MARKER_INK = '#1e2433';
const MARKER_OUTLINE = '#f4f0e8';

// Exported versus not, at map scale. The pair this replaced was '#00703c'
// and '#d4351c' — green and red, telling the two apart by hue alone, which
// fails in greyscale and for red-green colour blindness. Fill against hollow
// survives both.
//
// The design's rotated square with a dashed stroke is not expressible in a
// circle layer: MapLibre has no dashed circle stroke, and a rotated square
// would need a symbol layer with two bundled sprite images. Fill-versus-
// hollow carries the distinction on its own, so the sprites stay unbuilt —
// see docs/styling.md if the dash turns out to matter on a real archive.
// Filled only while the export is still good: an observation edited after
// the export that carried it (`changed`, decorated from isChangedSinceExport)
// goes hollow again — its data is no longer safely off the device, which is
// exactly what hollow means.
const SAFELY_EXPORTED = ['all', ['get', 'exported'], ['!', ['get', 'changed']]];

export function observationPaint() {
  return {
    'circle-radius': 7,
    'circle-color': ['case', SAFELY_EXPORTED, MARKER_INK, 'transparent'],
    'circle-stroke-width': 2,
    'circle-stroke-color': ['case', SAFELY_EXPORTED, MARKER_OUTLINE, MARKER_INK],
  };
}

// The ring of the fix's reported accuracy. The fix itself is no longer a
// circle layer: it is the locator DOM marker (locator.js), which a canvas
// layer cannot express — dashed stale ring, rotating beam, per-mode CSS
// tokens. The accuracy ring stays here because the metres-to-pixels zoom
// expression already works and is already tested.
export function accuracyPaint() {
  return {
    'circle-radius': 0,
    'circle-color': '#c2611f',
    'circle-opacity': 0.18,
    'circle-stroke-width': 1,
    'circle-stroke-color': '#c2611f',
    'circle-stroke-opacity': 0.4,
  };
}

// A point the surveyor has marked on the map but not yet saved. Hollow with a
// thick accent ring rather than a filled dot: it is provisional, and it must
// not be mistaken at a glance for either the live fix or a saved observation
// — the two things on this map that are actually measured.
export function pickedPointPaint() {
  return {
    'circle-radius': 9,
    'circle-color': 'transparent',
    'circle-stroke-width': 3,
    'circle-stroke-color': '#c2611f',
  };
}

export function observationsFeatureCollection(observations) {
  return {
    type: 'FeatureCollection',
    features: (observations ?? []).map((observation) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [observation.lon, observation.lat] },
      properties: {
        obs_id: observation.id,
        // Exported-or-not has to stay visible wherever observations are
        // shown (CLAUDE.md), markers included. The caller decorates each
        // observation (domain/session.js isExported/isChangedSinceExport) —
        // this module keeps no opinion about what either means.
        exported: Boolean(observation.exported),
        changed: Boolean(observation.changed),
      },
    })),
  };
}

// Saved traces: the walked lines and boundaries behind the markers. A
// separate source from the markers because these are the observations'
// geometries, not their representative points — every traced observation
// appears in both (its shape here, its marker dot above).
export const OBSERVATION_SHAPES_SOURCE_ID = 'observation-shapes';

export function observationShapesCollection(observations) {
  return {
    type: 'FeatureCollection',
    features: (observations ?? [])
      .filter((observation) => observation.geometry)
      .map((observation) => ({
        type: 'Feature',
        geometry: observation.geometry,
        properties: {
          obs_id: observation.id,
          exported: Boolean(observation.exported),
          changed: Boolean(observation.changed),
        },
      })),
  };
}

// The casing under every trace line: 5px of solid pale (or, at night,
// near-black) beneath the 3px line. The ink lines were tuned against pale
// vector paper and disappear over dark aerial — and solid-versus-dashed
// cannot carry the exported distinction when neither line is visible. A
// casing is the standard cartographic fix and makes the lines basemap-
// independent. It stays SOLID under the dashed lines deliberately: the dash
// gaps then read pale against dark ground and dark against pale, so the
// dash gets more legible, not less.
export function traceCasingColor(night = false) {
  // Against a dimmed night map the contrast a line needs is downward.
  return night ? '#0b0604' : '#f4f0e8';
}

function casingLayer(line) {
  return {
    id: `${line.id}-casing`,
    type: 'line',
    source: line.source,
    ...(line.filter ? { filter: line.filter } : {}),
    paint: { 'line-color': traceCasingColor(), 'line-width': 5, 'line-opacity': 0.75 },
  };
}

// Solid versus dashed is the line-scale analogue of the markers'
// filled-versus-hollow: exported-or-not must survive greyscale, so it is
// never carried by hue. Two line layers split by filter rather than one
// with a data-driven dash — MapLibre's line-dasharray is not data-drivable.
// The line layers carry no geometry-type filter, deliberately: a boundary
// polygon needs its outline drawn by them, or it is a faint wash with no
// edge. Each line's casing sits immediately before it in the returned
// array, so adding the layers in order stacks every line directly on its
// own casing.
export function traceShapeLayers() {
  const source = OBSERVATION_SHAPES_SOURCE_ID;
  const exported = {
    id: 'trace-line-exported',
    type: 'line',
    source,
    // Solid only while the export is still good — an edited-since-export
    // trace goes dashed again, the line-scale analogue of hollow.
    filter: SAFELY_EXPORTED,
    paint: { 'line-color': MARKER_INK, 'line-width': 3 },
  };
  const pending = {
    id: 'trace-line-pending',
    type: 'line',
    source,
    filter: ['!', SAFELY_EXPORTED],
    paint: { 'line-color': MARKER_INK, 'line-width': 3, 'line-dasharray': [2, 2] },
  };
  return [
    {
      id: 'trace-fill',
      type: 'fill',
      source,
      // Faint either way — the fill says "this area", the outline carries
      // the exported distinction.
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': MARKER_INK, 'fill-opacity': 0.12 },
    },
    casingLayer(exported),
    exported,
    casingLayer(pending),
    pending,
  ];
}

// The trace being walked right now. Accent and dashed — the provisional
// visual language of the picked point, against the ink of saved shapes.
export const ACTIVE_TRACE_SOURCE_ID = 'active-trace';

export function activeTraceData(coordinates) {
  // Always a FeatureCollection, empty below two vertices — a source set
  // unconditionally, like the highlight, and a dot is not a line.
  const enough = Array.isArray(coordinates) && coordinates.length >= 2;
  return {
    type: 'FeatureCollection',
    features: enough
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }]
      : [],
  };
}

export function activeTraceLayers() {
  const line = {
    id: 'active-trace-line',
    type: 'line',
    source: ACTIVE_TRACE_SOURCE_ID,
    paint: { 'line-color': '#c2611f', 'line-width': 3, 'line-dasharray': [1.5, 1.5] },
  };
  return [casingLayer(line), line];
}
