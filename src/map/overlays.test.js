import { describe, expect, test } from 'vitest';
import {
  positionFeature,
  accuracyRadiusExpression,
  observationsFeatureCollection,
  metresToPixels,
} from './overlays.js';

describe('positionFeature', () => {
  test('emits a Point in GeoJSON [lon, lat] order, not the [lat, lon] the sensors use', () => {
    const feature = positionFeature({ lat: 51.5, lon: -0.14 });

    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [-0.14, 51.5] });
  });

  test('returns null when there is no fix yet', () => {
    expect(positionFeature(null)).toBeNull();
  });
});

describe('metresToPixels', () => {
  // Web Mercator: 156543.03392 m/px at the equator at z0, halving per zoom
  // level and shrinking with cos(latitude).
  test('matches the Web Mercator ground resolution at the equator', () => {
    expect(metresToPixels(156543.03392, 0, 0)).toBeCloseTo(1, 5);
  });

  test('doubles for each zoom level', () => {
    const atZ10 = metresToPixels(100, 51.5, 10);
    const atZ11 = metresToPixels(100, 51.5, 11);

    expect(atZ11 / atZ10).toBeCloseTo(2, 6);
  });

  test('a given distance covers more pixels at higher latitude', () => {
    expect(metresToPixels(100, 60, 12)).toBeGreaterThan(metresToPixels(100, 0, 12));
  });
});

describe('accuracyRadiusExpression', () => {
  test('interpolates on zoom with base 2, so the ring tracks real-world metres', () => {
    const expression = accuracyRadiusExpression({ accuracyM: 8, lat: 51.5 });

    expect(expression[0]).toBe('interpolate');
    expect(expression[1]).toEqual(['exponential', 2]);
    expect(expression[2]).toEqual(['zoom']);
  });

  test('its anchor radii are the true pixel sizes at those zooms', () => {
    const expression = accuracyRadiusExpression({ accuracyM: 8, lat: 51.5 });
    const [, , , lowZoom, lowRadius, highZoom, highRadius] = expression;

    expect(lowRadius).toBeCloseTo(metresToPixels(8, 51.5, lowZoom), 6);
    expect(highRadius).toBeCloseTo(metresToPixels(8, 51.5, highZoom), 6);
  });

  test('returns null without a fix, so the layer can be left empty', () => {
    expect(accuracyRadiusExpression(null)).toBeNull();
  });
});

describe('observationsFeatureCollection', () => {
  const observation = {
    id: 'obs-1',
    lat: 51.5,
    lon: -0.14,
    note: 'gate post',
    photoId: 'obs-1',
    synced: false,
  };

  test('maps each observation to a Point feature carrying its id', () => {
    const collection = observationsFeatureCollection([observation]);

    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].geometry.coordinates).toEqual([-0.14, 51.5]);
    expect(collection.features[0].properties.obs_id).toBe('obs-1');
  });

  test('carries synced state so the marker can show it, per the pending/synced rule', () => {
    const collection = observationsFeatureCollection([observation, { ...observation, id: 'obs-2', synced: true }]);

    expect(collection.features.map((f) => f.properties.synced)).toEqual([false, true]);
  });

  test('an empty session is still a valid empty FeatureCollection', () => {
    expect(observationsFeatureCollection([])).toEqual({ type: 'FeatureCollection', features: [] });
  });

  test('tolerates a missing list, e.g. before the first load resolves', () => {
    expect(observationsFeatureCollection(undefined).features).toEqual([]);
  });
});
