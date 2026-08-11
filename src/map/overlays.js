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

// Pending versus synced, at map scale. The pair this replaced was '#00703c'
// and '#d4351c' — green and red, telling the two apart by hue alone, which
// fails in greyscale and for red-green colour blindness. Fill against hollow
// survives both.
//
// The design's rotated square with a dashed stroke is not expressible in a
// circle layer: MapLibre has no dashed circle stroke, and a rotated square
// would need a symbol layer with two bundled sprite images. Fill-versus-
// hollow carries the distinction on its own, so the sprites stay unbuilt —
// see docs/styling.md if the dash turns out to matter on a real archive.
export function observationPaint() {
  return {
    'circle-radius': 7,
    'circle-color': ['case', ['get', 'synced'], MARKER_INK, 'transparent'],
    'circle-stroke-width': 2,
    'circle-stroke-color': ['case', ['get', 'synced'], MARKER_OUTLINE, MARKER_INK],
  };
}

// The live fix and the ring of its reported accuracy. Accent-coloured so it
// is never mistaken for a saved observation.
export function positionPaint() {
  return {
    'circle-radius': 6,
    'circle-color': '#c2611f',
    'circle-stroke-width': 2,
    'circle-stroke-color': MARKER_OUTLINE,
  };
}

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

export function observationsFeatureCollection(observations) {
  return {
    type: 'FeatureCollection',
    features: (observations ?? []).map((observation) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [observation.lon, observation.lat] },
      properties: {
        obs_id: observation.id,
        // Pending vs synced has to stay visible wherever observations are
        // shown (CLAUDE.md), markers included.
        synced: Boolean(observation.synced),
      },
    })),
  };
}
