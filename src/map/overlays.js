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
  const metresPerPixel =
    (EQUATOR_METRES_PER_PIXEL * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
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
