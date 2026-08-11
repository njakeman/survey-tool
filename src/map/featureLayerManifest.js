import { regionNameFromFilename } from './manifest.js';
import { DEFAULT_STYLE } from './featureLayerStyle.js';

// Reading a feature layer well enough to publish a manifest entry: the facts
// that can be measured from the data (size, feature count, bounds, which
// geometry types are present) merged with the style declaration that cannot
// be, authored in a `<id>.style.json` sidecar.
//
// Pure — text in, entry out — so the coordinate walk and the validation below
// are node-testable without touching the filesystem. The generator script
// does the file reading.
//
// **Node-only**, like manifest.js next to it, and for the same reason: that
// module imports node:fs. Nothing the app ships may import this one. The
// dependency runs this way — manifest → style, never the reverse — because
// featureLayerStyle.js is browser code and importing it the other way round
// dragged node:fs into the bundle.

// Longitude/latitude, not eastings/northings. Anything outside this is not a
// judgement call about accuracy — it is a different coordinate system.
function assertGeographic(lon, lat) {
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new Error(
      `coordinate ${lon}, ${lat} is outside longitude/latitude range — reproject with ` +
        '`ogr2ogr -t_srs EPSG:4326` (British National Grid, EPSG:27700, is the usual culprit)',
    );
  }
}

// Coordinates nest to arbitrary depth across the geometry types, and a
// GeometryCollection nests geometries as well. One recursive walk handles
// every case, including types added later.
function walkCoordinates(coordinates, visit) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === 'number') {
    visit(coordinates[0], coordinates[1]);
    return;
  }
  for (const child of coordinates) walkCoordinates(child, visit);
}

function walkGeometry(geometry, visit) {
  if (!geometry) return;
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries ?? []) walkGeometry(child, visit);
    return;
  }
  walkCoordinates(geometry.coordinates, visit);
}

export function describeFeatureLayer({
  filename,
  text,
  style = null,
  urlPrefix = 'feature-layers',
}) {
  const parsed = JSON.parse(text);
  if (parsed?.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
    throw new Error('not a GeoJSON FeatureCollection');
  }
  if (parsed.features.length === 0) {
    throw new Error('no features — an empty layer is a mistake, not a layer');
  }

  const geometryTypes = new Set();
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const feature of parsed.features) {
    // A feature with no geometry is legal GeoJSON (an attribute-only row) and
    // costs nothing to carry — it simply contributes no bounds and no type.
    if (!feature?.geometry) continue;
    geometryTypes.add(feature.geometry.type);
    walkGeometry(feature.geometry, (lon, lat) => {
      assertGeographic(lon, lat);
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    });
  }

  // `name` is the entry's, not the style's — carried in both places the two
  // could disagree, and the UI would have to pick a winner.
  const { name, ...styleKeys } = style ?? {};

  return {
    id: filename.replace(/\.geojson$/i, ''),
    name: name ?? regionNameFromFilename(filename),
    url: `${urlPrefix}/${filename}`,
    sizeBytes: new TextEncoder().encode(text).length,
    featureCount: parsed.features.length,
    bounds: Number.isFinite(minLon) ? [minLon, minLat, maxLon, maxLat] : null,
    geometryTypes: [...geometryTypes],
    // Spread over the defaults rather than replacing them: a sidecar that
    // declares only a colour must not silently drop the line width with it.
    style: { ...DEFAULT_STYLE, ...styleKeys },
  };
}
