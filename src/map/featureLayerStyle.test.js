import { describe, expect, test } from 'vitest';
import {
  DEFAULT_STYLE,
  featureLayerSourceId,
  featureLayerSource,
  featureLayerLayers,
  featureLayerIds,
  HIGHLIGHT_SOURCE_ID,
  highlightSourceData,
  highlightLayers,
} from './featureLayerStyle.js';

const GEOJSON = { type: 'FeatureCollection', features: [] };

function layer(overrides = {}) {
  return {
    id: 'parcels',
    name: 'Field parcels',
    geojson: GEOJSON,
    style: { ...DEFAULT_STYLE, ...(overrides.style ?? {}) },
    ...overrides,
  };
}

function byId(layers) {
  return Object.fromEntries(layers.map((l) => [l.id, l]));
}

describe('featureLayerSource', () => {
  test('is a geojson source carrying the parsed data', () => {
    const source = featureLayerSource(layer());

    expect(source.type).toBe('geojson');
    expect(source.data).toBe(GEOJSON);
  });

  test('namespaces the source id, so a layer cannot collide with basemap or markers', () => {
    // 'basemap', 'position' and 'observations' are all taken, and a layer is
    // named by whatever its file was called.
    expect(featureLayerSourceId('position')).not.toBe('position');
    expect(featureLayerSourceId('parcels')).toBe('feature-layer-parcels');
  });
});

describe('featureLayerLayers', () => {
  test('always emits fill, line and circle, each filtered to its own geometry', () => {
    // Emitted unconditionally rather than from a declared geometry list: a
    // layer that matches nothing costs nothing, and this cannot fall out of
    // step with what the data actually contains.
    const layers = featureLayerLayers(layer());

    expect(layers.map((l) => l.type)).toEqual(['fill', 'line', 'circle']);
  });

  test('polygons get an outline as well as a fill', () => {
    // A 15%-opacity fill alone is close to invisible over aerial imagery.
    // The line layer is what makes a boundary readable in sunlight.
    const line = byId(featureLayerLayers(layer()))['feature-layer-parcels-line'];

    expect(line.filter).toEqual([
      'match',
      ['geometry-type'],
      ['LineString', 'Polygon'],
      true,
      false,
    ]);
  });

  test('applies the declared colour, width and opacity', () => {
    const layers = byId(
      featureLayerLayers(layer({ style: { colour: '#7d2208', lineWidth: 4, fillOpacity: 0.3 } })),
    );

    expect(layers['feature-layer-parcels-fill'].paint['fill-color']).toBe('#7d2208');
    expect(layers['feature-layer-parcels-fill'].paint['fill-opacity']).toBe(0.3);
    expect(layers['feature-layer-parcels-line'].paint['line-color']).toBe('#7d2208');
    expect(layers['feature-layer-parcels-line'].paint['line-width']).toBe(4);
  });

  test('points carry a pale outline, so they stay visible over dark imagery', () => {
    const circle = byId(featureLayerLayers(layer()))['feature-layer-parcels-circle'];

    expect(circle.paint['circle-stroke-width']).toBeGreaterThan(0);
    expect(circle.paint['circle-stroke-color']).not.toBe(circle.paint['circle-color']);
  });

  test('adds a label layer only when a label property is declared', () => {
    expect(featureLayerLayers(layer()).some((l) => l.type === 'symbol')).toBe(false);

    const labelled = featureLayerLayers(layer({ style: { labelProperty: 'ref' } }));
    const symbol = labelled.find((l) => l.type === 'symbol');

    expect(symbol.layout['text-field']).toEqual(['to-string', ['get', 'ref']]);
    // Features missing the property would otherwise render an empty label box.
    expect(symbol.filter).toEqual(['has', 'ref']);
  });

  test('labels are haloed, because a bare word over aerial imagery is unreadable', () => {
    const symbol = featureLayerLayers(layer({ style: { labelProperty: 'ref' } })).find(
      (l) => l.type === 'symbol',
    );

    expect(symbol.paint['text-halo-width']).toBeGreaterThan(0);
  });

  test('a declared minZoom keeps a dense layer off the map until it is useful', () => {
    const layers = featureLayerLayers(layer({ style: { minZoom: 14 } }));

    expect(layers.every((l) => l.minzoom === 14)).toBe(true);
  });

  test('omits minzoom entirely at zoom 0, rather than declaring a no-op', () => {
    expect(featureLayerLayers(layer()).every((l) => !('minzoom' in l))).toBe(true);
  });

  test('every layer binds to its own source', () => {
    expect(featureLayerLayers(layer()).every((l) => l.source === 'feature-layer-parcels')).toBe(
      true,
    );
  });
});

describe('featureLayerIds', () => {
  test('lists every layer id, which is what the tap query is restricted to', () => {
    expect(featureLayerIds(layer({ style: { labelProperty: 'ref' } }))).toEqual([
      'feature-layer-parcels-fill',
      'feature-layer-parcels-line',
      'feature-layer-parcels-circle',
      'feature-layer-parcels-label',
    ]);
  });
});

describe('the selection highlight', () => {
  test('covers every geometry family, filtered like the layers it echoes', () => {
    const layers = byId(highlightLayers());

    expect(highlightLayers().map((l) => l.type)).toEqual(['fill', 'line', 'circle']);
    expect(layers[`${HIGHLIGHT_SOURCE_ID}-fill`].filter).toEqual([
      '==',
      ['geometry-type'],
      'Polygon',
    ]);
    expect(layers[`${HIGHLIGHT_SOURCE_ID}-circle`].filter).toEqual([
      '==',
      ['geometry-type'],
      'Point',
    ]);
    expect(highlightLayers().every((l) => l.source === HIGHLIGHT_SOURCE_ID)).toBe(true);
  });

  test('reads as selection, not as another layer and never as the live fix', () => {
    const layers = byId(highlightLayers());
    const lineColour = layers[`${HIGHLIGHT_SOURCE_ID}-line`].paint['line-color'];

    // '#c2611f' is the live fix and the marks; DEFAULT_STYLE.colour is what
    // an unstyled layer already looks like. The selection must be neither.
    expect(lineColour).not.toBe('#c2611f');
    expect(lineColour).not.toBe(DEFAULT_STYLE.colour);
    // Wider and heavier than the thing it highlights, or it disappears
    // against the layer's own outline.
    expect(layers[`${HIGHLIGHT_SOURCE_ID}-line`].paint['line-width']).toBeGreaterThan(
      DEFAULT_STYLE.lineWidth,
    );
    expect(layers[`${HIGHLIGHT_SOURCE_ID}-fill`].paint['fill-opacity']).toBeGreaterThan(
      DEFAULT_STYLE.fillOpacity,
    );
    expect(layers[`${HIGHLIGHT_SOURCE_ID}-circle`].paint['circle-radius']).toBeGreaterThan(
      DEFAULT_STYLE.circleRadius,
    );
  });

  test('wraps a geometry as the source data, and empties without one', () => {
    const geometry = { type: 'Point', coordinates: [-0.14, 50.86] };

    expect(highlightSourceData(geometry)).toEqual({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry }],
    });
    expect(highlightSourceData(null)).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
