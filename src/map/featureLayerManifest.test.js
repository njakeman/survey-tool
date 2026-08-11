import { describe, expect, test } from 'vitest';
import { describeFeatureLayer } from './featureLayerManifest.js';
import { DEFAULT_STYLE } from './featureLayerStyle.js';

function collection(features) {
  return JSON.stringify({ type: 'FeatureCollection', features });
}

const POINT = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-1.92, 51.56] },
  properties: { ref: 'SU1408' },
};
const POLYGON = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-2.0, 51.5],
        [-1.8, 51.5],
        [-1.8, 51.7],
        [-2.0, 51.7],
        [-2.0, 51.5],
      ],
    ],
  },
  properties: { ref: 'field-1' },
};

function describe_(text, style) {
  return describeFeatureLayer({ filename: 'field-parcels.geojson', text, style });
}

describe('describeFeatureLayer', () => {
  test('measures what can be measured and titles the layer from its filename', () => {
    const entry = describe_(collection([POINT]));

    expect(entry.id).toBe('field-parcels');
    expect(entry.name).toBe('Field Parcels');
    expect(entry.url).toBe('feature-layers/field-parcels.geojson');
    expect(entry.featureCount).toBe(1);
    expect(entry.sizeBytes).toBeGreaterThan(0);
  });

  test('a declared name wins over the filename', () => {
    expect(describe_(collection([POINT]), { name: 'OS field parcels' }).name).toBe(
      'OS field parcels',
    );
  });

  test('computes bounds across every coordinate, nested geometry included', () => {
    const entry = describe_(collection([POINT, POLYGON]));

    expect(entry.bounds).toEqual([-2.0, 51.5, -1.8, 51.7]);
  });

  test('reports the geometry types present, so the style knows which layers to build', () => {
    expect(describe_(collection([POINT, POLYGON])).geometryTypes.sort()).toEqual([
      'Point',
      'Polygon',
    ]);
  });

  test('resolves the style declaration over defaults rather than replacing it', () => {
    const entry = describe_(collection([POLYGON]), { colour: '#7d2208', labelProperty: 'ref' });

    expect(entry.style.colour).toBe('#7d2208');
    expect(entry.style.labelProperty).toBe('ref');
    // Untouched keys still carry their defaults, so a sidecar declaring one
    // value doesn't silently drop the rest.
    expect(entry.style.lineWidth).toBe(DEFAULT_STYLE.lineWidth);
    expect(entry.style.fillOpacity).toBe(DEFAULT_STYLE.fillOpacity);
  });

  test('the default colour is not the accent — a feature must never read as the live fix', () => {
    // '#c2611f' is the position dot and its accuracy ring. A layer defaulting
    // to it would put a dozen things on the map that look like where you are.
    expect(DEFAULT_STYLE.colour).not.toBe('#c2611f');
  });

  test('rejects anything that is not a FeatureCollection', () => {
    expect(() => describe_('{"type":"Feature"}')).toThrow(/FeatureCollection/);
    expect(() => describe_('not json at all')).toThrow();
  });

  test('rejects an empty collection — a layer with nothing in it is a mistake, not a layer', () => {
    expect(() => describe_(collection([]))).toThrow(/no features/i);
  });

  test('rejects unprojected coordinates, naming the actual cause', () => {
    // The overwhelmingly common failure with UK data: British National Grid
    // eastings/northings exported without -t_srs EPSG:4326. The numbers are
    // valid JSON and valid GeoJSON shape, and the layer lands in the Atlantic
    // off west Africa with no error at all.
    const bng = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [414082, 139216] },
      properties: {},
    };

    expect(() => describe_(collection([bng]))).toThrow(/EPSG:4326/);
  });

  test('tolerates a feature with no geometry rather than failing the whole layer', () => {
    const entry = describe_(
      collection([POINT, { type: 'Feature', geometry: null, properties: {} }]),
    );

    expect(entry.featureCount).toBe(2);
    expect(entry.bounds).toEqual([-1.92, 51.56, -1.92, 51.56]);
  });
});
