import { describe, expect, test } from 'vitest';
import {
  positionFeature,
  accuracyRadiusExpression,
  observationsFeatureCollection,
  observationShapesCollection,
  metresToPixels,
  observationPaint,
  pickedPointPaint,
  traceShapeLayers,
  activeTraceData,
  activeTraceLayers,
  traceCasingColor,
  stationsCollection,
  stationLayers,
  stationDiamondImage,
  OBSERVATION_SHAPES_SOURCE_ID,
  ACTIVE_TRACE_SOURCE_ID,
  STATIONS_SOURCE_ID,
  STATION_ICONS,
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
    exported: false,
  };

  test('maps each observation to a Point feature carrying its id', () => {
    const collection = observationsFeatureCollection([observation]);

    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].geometry.coordinates).toEqual([-0.14, 51.5]);
    expect(collection.features[0].properties.obs_id).toBe('obs-1');
  });

  test('carries exported state so the marker can show it, per the exported-visible rule', () => {
    const collection = observationsFeatureCollection([
      observation,
      { ...observation, id: 'obs-2', exported: true },
    ]);

    expect(collection.features.map((f) => f.properties.exported)).toEqual([false, true]);
  });

  test('carries changed-since-export state, so a stale marker can go hollow again', () => {
    const collection = observationsFeatureCollection([
      { ...observation, exported: true, changed: true },
      { ...observation, id: 'obs-2', exported: true },
    ]);

    expect(collection.features.map((f) => f.properties.changed)).toEqual([true, false]);
  });

  test('an empty session is still a valid empty FeatureCollection', () => {
    expect(observationsFeatureCollection([])).toEqual({ type: 'FeatureCollection', features: [] });
  });

  test('tolerates a missing list, e.g. before the first load resolves', () => {
    expect(observationsFeatureCollection(undefined).features).toEqual([]);
  });
});

describe('observationPaint', () => {
  // The markers were '#00703c' when exported and '#d4351c' otherwise: green
  // versus red, distinguishable by hue alone. That fails in greyscale, in
  // sunlight, and for the ~8% of men with red-green colour blindness — and
  // it was the one live accessibility defect the design pass named.
  test('distinguishes exported from not by fill, not only by colour', () => {
    const paint = observationPaint();

    // A 'case' expression, filled only when the export is still good —
    // exported AND not edited since (an edited-since-export record's data
    // is no longer safely off the device, which is what hollow means).
    const [operator, condition, whenExported, whenUnexported] = paint['circle-color'];
    expect(operator).toBe('case');
    expect(condition).toEqual(['all', ['get', 'exported'], ['!', ['get', 'changed']]]);
    // Exported is filled; unexported is hollow. The shapes differ before the
    // colours do.
    expect(whenExported).not.toBe('transparent');
    expect(whenUnexported).toBe('transparent');
  });

  test('gives an unexported marker a stroke, so a hollow marker is still visible', () => {
    const paint = observationPaint();

    expect(paint['circle-stroke-width']).toBeGreaterThanOrEqual(2);
  });

  test('the two states never differ by hue alone', () => {
    const paint = observationPaint();
    const [, , whenExported, whenUnexported] = paint['circle-color'];

    // If both branches were opaque colours, the only difference would be
    // hue — exactly the defect this replaced.
    expect([whenExported, whenUnexported]).toContain('transparent');
  });
});

describe('pickedPointPaint', () => {
  test('is hollow, so a provisional mark is not mistaken for a measured point', () => {
    // The two filled treatments on this map — the accent position dot and a
    // synced observation — are both things that were actually measured. A
    // point someone eyeballed must not join them.
    const paint = pickedPointPaint();

    expect(paint['circle-color']).toBe('transparent');
    expect(paint['circle-stroke-width']).toBeGreaterThan(0);
  });

  test('is larger than the observation markers, being the active thing', () => {
    // The live fix is no longer a circle layer to compare against — it is
    // the locator DOM marker (locator.js), which draws larger than any of
    // these by construction.
    expect(pickedPointPaint()['circle-radius']).toBeGreaterThan(
      observationPaint()['circle-radius'],
    );
  });
});

describe('observationShapesCollection', () => {
  const LINE = {
    type: 'LineString',
    coordinates: [
      [-0.14, 51.5],
      [-0.141, 51.501],
    ],
  };

  test('carries only the observations that have a geometry', () => {
    const fc = observationShapesCollection([
      { id: 'obs-1', lat: 51.5, lon: -0.14, exported: true },
      { id: 'obs-2', lat: 51.5, lon: -0.14, geometry: LINE, exported: false },
    ]);

    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual(LINE);
    expect(fc.features[0].properties).toEqual({
      obs_id: 'obs-2',
      exported: false,
      changed: false,
      part: 'walked',
    });
  });

  test('is an empty collection for no observations', () => {
    expect(observationShapesCollection(null).features).toEqual([]);
  });

  describe('inferred segments', () => {
    const LINE4 = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [0, 1],
        [0, 2],
        [0, 3],
      ],
    };

    test('a gapped path splits into walked runs and inferred segments', () => {
      const fc = observationShapesCollection([
        { id: 'obs-1', geometry: LINE4, traceGaps: [2], exported: false },
      ]);

      const walked = fc.features.find((f) => f.properties.part === 'walked');
      const inferred = fc.features.find((f) => f.properties.part === 'inferred');
      expect(fc.features).toHaveLength(2);
      expect(walked.geometry).toEqual({
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [0, 1],
          ],
          [
            [0, 2],
            [0, 3],
          ],
        ],
      });
      expect(inferred.geometry).toEqual({
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 1],
            [0, 2],
          ],
        ],
      });
      // Both halves carry the export decoration — the walked line still
      // splits solid-versus-dashed like any other trace.
      expect(inferred.properties).toEqual({ obs_id: 'obs-1', exported: false, changed: false, part: 'inferred' });
    });

    test('adjacent gap segments merge into one inferred run', () => {
      const fc = observationShapesCollection([
        { id: 'obs-1', geometry: LINE4, traceGaps: [2, 3], exported: false },
      ]);

      const inferred = fc.features.find((f) => f.properties.part === 'inferred');
      expect(inferred.geometry.coordinates).toEqual([
        [
          [0, 1],
          [0, 2],
          [0, 3],
        ],
      ]);
    });

    test('a gapped boundary keeps its full-ring fill, and its closure stays walked', () => {
      const ring = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ];
      const fc = observationShapesCollection([
        {
          id: 'obs-1',
          geometry: { type: 'Polygon', coordinates: [ring] },
          traceGaps: [2],
          exported: true,
        },
      ]);

      // The fill must not lose the polygon when the outline splits.
      const fill = fc.features.find((f) => f.properties.part === 'fill');
      expect(fill.geometry.type).toBe('Polygon');
      expect(fill.geometry.coordinates).toEqual([ring]);

      const walked = fc.features.find((f) => f.properties.part === 'walked');
      // Segments 1, 3 and the synthetic closure 4 were walked; 2 was not.
      expect(walked.geometry).toEqual({
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [1, 0],
          ],
          [
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      });
      const inferred = fc.features.find((f) => f.properties.part === 'inferred');
      expect(inferred.geometry.coordinates).toEqual([
        [
          [1, 0],
          [1, 1],
        ],
      ]);
    });

    test('an ungapped polygon stays one feature, filled and outlined from the same ring', () => {
      const ring = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ];
      const fc = observationShapesCollection([
        { id: 'obs-1', geometry: { type: 'Polygon', coordinates: [ring] } },
      ]);

      expect(fc.features).toHaveLength(1);
      expect(fc.features[0].geometry.type).toBe('Polygon');
      expect(fc.features[0].properties.part).toBe('walked');
    });
  });
});

describe('traceShapeLayers', () => {
  test('fills polygons only, and splits solid from dashed by exported state', () => {
    const layers = traceShapeLayers();
    const fill = layers.find((l) => l.type === 'fill');
    const lines = layers.filter((l) => l.type === 'line' && !l.id.endsWith('-casing'));

    expect(fill.filter).toEqual(['==', ['geometry-type'], 'Polygon']);
    expect(lines).toHaveLength(3);

    // Solid-versus-dashed is the line-scale analogue of the markers
    // filled-versus-hollow: it must survive greyscale. Two layers rather
    // than a data-driven dasharray, which MapLibre does not support.
    // Solid only while the export is still good — an edited-since-export
    // trace goes dashed again, like its marker goes hollow. Both draw only
    // the walked parts: the inferred parts have their own dotted layer.
    const solidFilter = ['all', ['get', 'exported'], ['!', ['get', 'changed']]];
    const walkedPart = ['==', ['get', 'part'], 'walked'];
    const exported = lines.find((l) => l.id === 'trace-line-exported');
    const pending = lines.find((l) => l.id === 'trace-line-pending');
    expect(exported.filter).toEqual(['all', solidFilter, walkedPart]);
    expect(pending.filter).toEqual(['all', ['!', solidFilter], walkedPart]);
    expect(exported.paint['line-dasharray']).toBeUndefined();
    expect(pending.paint['line-dasharray']).toBeDefined();
  });

  test('inferred segments draw dotted in the same ink, one layer for both export states', () => {
    // Dotted = "the app inferred this stretch, it was not walked under a
    // live fix". Dash already means unexported, so the dot rhythm must read
    // clearly shorter than the [2,2] pending dash. Export-ness stays
    // readable from the rest of the line and the marker fill.
    const layers = traceShapeLayers();
    const inferred = layers.find((l) => l.id === 'trace-line-inferred');
    const pending = layers.find((l) => l.id === 'trace-line-pending');

    expect(inferred.filter).toEqual(['==', ['get', 'part'], 'inferred']);
    expect(inferred.paint['line-color']).toBe(pending.paint['line-color']);
    expect(inferred.paint['line-width']).toBe(pending.paint['line-width']);
    expect(inferred.paint['line-dasharray'][0]).toBeLessThan(
      pending.paint['line-dasharray'][0] / 2,
    );
  });

  test('every layer draws from the one observation-shapes source', () => {
    for (const layer of traceShapeLayers()) {
      expect(layer.source).toBe(OBSERVATION_SHAPES_SOURCE_ID);
    }
  });

  test('the line layers outline polygons as well as paths', () => {
    // A boundary with no outline would be a faint wash with no edge; the
    // line layers must not be filtered down to LineString geometry.
    for (const layer of traceShapeLayers().filter((l) => l.type === 'line')) {
      expect(JSON.stringify(layer.filter ?? [])).not.toContain('geometry-type');
    }
  });

  test('the polygon fill is strong enough to read over imagery', () => {
    const fill = traceShapeLayers().find((l) => l.type === 'fill');

    expect(fill.paint['fill-opacity']).toBe(0.12);
  });

  test('every line sits on a solid pale casing directly beneath it', () => {
    // Over dark aerial both ink lines disappear, and solid-versus-dashed
    // cannot carry a distinction when neither line is visible — a
    // constraint-6 failure. The casing is the standard cartographic fix:
    // it stays SOLID under the dashed line deliberately, so the dash gaps
    // read pale against dark ground and dark against pale.
    const layers = traceShapeLayers();
    const ids = layers.map((l) => l.id);

    expect(ids.indexOf('trace-line-exported-casing')).toBe(ids.indexOf('trace-line-exported') - 1);
    expect(ids.indexOf('trace-line-pending-casing')).toBe(ids.indexOf('trace-line-pending') - 1);
    expect(ids.indexOf('trace-line-inferred-casing')).toBe(ids.indexOf('trace-line-inferred') - 1);

    for (const casing of layers.filter((l) => l.id.endsWith('-casing'))) {
      const line = layers.find((l) => l.id === casing.id.replace('-casing', ''));
      expect(casing.type).toBe('line');
      expect(casing.filter).toEqual(line.filter);
      expect(casing.paint['line-color']).toBe(traceCasingColor());
      expect(casing.paint['line-width']).toBeGreaterThan(line.paint['line-width']);
      if (line.id === 'trace-line-inferred') continue; // asserted below
      expect(casing.paint['line-dasharray']).toBeUndefined();
    }
  });

  test('the inferred casing is dotted in step with its line, never solid beneath the dots', () => {
    // A solid 5px casing under a dotted 3px line would read as a solid line
    // with dots on top — the one place the solid-casing rule must bend.
    // Dasharray units are multiples of line-width, so the casing's values
    // scale by width ratio to land the same dots on the ground.
    const layers = traceShapeLayers();
    const line = layers.find((l) => l.id === 'trace-line-inferred');
    const casing = layers.find((l) => l.id === 'trace-line-inferred-casing');

    const ratio = line.paint['line-width'] / casing.paint['line-width'];
    expect(casing.paint['line-dasharray']).toEqual(
      line.paint['line-dasharray'].map((v) => v * ratio),
    );
  });
});

describe('traceCasingColor', () => {
  test('is paper by day and near-black at night', () => {
    // Against a dimmed night map the contrast a line needs is downward.
    expect(traceCasingColor()).toBe('#f4f0e8');
    expect(traceCasingColor(true)).toBe('#0b0604');
  });
});

describe('active trace', () => {
  test('fewer than two vertices draws nothing - a dot is not a line', () => {
    expect(activeTraceData([]).features).toEqual([]);
    expect(activeTraceData([[0, 0]]).features).toEqual([]);
    expect(activeTraceData(null).features).toEqual([]);
  });

  test('two or more vertices draw as one walked LineString', () => {
    const fc = activeTraceData([
      [0, 0],
      [0, 0.001],
    ]);

    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe('LineString');
    expect(fc.features[0].properties.part).toBe('walked');
  });

  test('gap segments split out of the live line as an inferred feature', () => {
    const fc = activeTraceData(
      [
        [0, 0],
        [0, 1],
        [0, 2],
      ],
      [2],
    );

    const walked = fc.features.find((f) => f.properties.part === 'walked');
    const inferred = fc.features.find((f) => f.properties.part === 'inferred');
    expect(walked.geometry).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 0],
          [0, 1],
        ],
      ],
    });
    expect(inferred.geometry).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 1],
          [0, 2],
        ],
      ],
    });
  });

  test('the live line is accent-coloured and dashed - provisional, like the picked point', () => {
    const layers = activeTraceLayers();
    const line = layers.find((l) => l.id === 'active-trace-line');

    expect(line.source).toBe(ACTIVE_TRACE_SOURCE_ID);
    expect(line.filter).toEqual(['==', ['get', 'part'], 'walked']);
    expect(line.paint['line-color']).toBe('#c2611f');
    expect(line.paint['line-dasharray']).toBeDefined();
  });

  test('the live line rides its own casing, like the saved ones', () => {
    const ids = activeTraceLayers().map((l) => l.id);

    expect(ids).toEqual([
      'active-trace-line-casing',
      'active-trace-line',
      'active-trace-inferred-casing',
      'active-trace-inferred',
    ]);

    const casing = activeTraceLayers().find((l) => l.id === 'active-trace-line-casing');
    expect(casing.paint['line-color']).toBe(traceCasingColor());
    expect(casing.paint['line-dasharray']).toBeUndefined();
  });

  test('the live gap stretch draws dotted accent, its casing in step', () => {
    // Same grammar as the saved shapes: dots mean inferred. The dot rhythm
    // must read against the [1.5,1.5] dash of the live walked line.
    const layers = activeTraceLayers();
    const line = layers.find((l) => l.id === 'active-trace-inferred');
    const casing = layers.find((l) => l.id === 'active-trace-inferred-casing');
    const walkedLine = layers.find((l) => l.id === 'active-trace-line');

    expect(line.filter).toEqual(['==', ['get', 'part'], 'inferred']);
    expect(line.paint['line-color']).toBe(walkedLine.paint['line-color']);
    expect(line.paint['line-dasharray'][0]).toBeLessThan(
      walkedLine.paint['line-dasharray'][0] / 2,
    );
    const ratio = line.paint['line-width'] / casing.paint['line-width'];
    expect(casing.paint['line-dasharray']).toEqual(
      line.paint['line-dasharray'].map((v) => v * ratio),
    );
  });
});

describe('station markers', () => {
  const stations = [
    { id: 'ref-1', lat: 51.5, lon: -0.14, state: 'done' },
    { id: 'ref-2', lat: 51.501, lon: -0.141, state: 'todo' },
    { id: 'ref-3', lat: 51.502, lon: -0.142, state: 'noAccess' },
  ];

  test('stationsCollection bakes one icon per station, the current one outranking its state', () => {
    const fc = stationsCollection(stations, 'ref-2');

    expect(fc.features.map((f) => f.properties.icon)).toEqual([
      STATION_ICONS.done,
      STATION_ICONS.current,
      STATION_ICONS.todo,
    ]);
    expect(fc.features.map((f) => f.properties.station_id)).toEqual(['ref-1', 'ref-2', 'ref-3']);
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [-0.14, 51.5] });
  });

  test('a skipped or no-access station draws hollow like to-do — no new photo yet either way', () => {
    const fc = stationsCollection(stations, null);

    expect(fc.features[2].properties.icon).toBe(STATION_ICONS.todo);
  });

  test('an empty or missing list is an empty collection', () => {
    expect(stationsCollection(null, null).features).toEqual([]);
  });

  test('the symbol layer reads the baked icon and never hides overlapping stations', () => {
    const [layer] = stationLayers();

    expect(layer.type).toBe('symbol');
    expect(layer.source).toBe(STATIONS_SOURCE_ID);
    expect(layer.layout['icon-image']).toEqual(['get', 'icon']);
    // Two stations ten metres apart must both stay visible — symbol
    // placement culling would silently drop one.
    expect(layer.layout['icon-allow-overlap']).toBe(true);
    expect(layer.layout['icon-ignore-placement']).toBe(true);
  });

  // The image assertions read alpha, not hue: filled-versus-hollow is the
  // signal that has to survive greyscale and the night filter.
  function alphaAt(image, x, y) {
    return image.data[(y * image.width + x) * 4 + 3];
  }

  test('done is a filled diamond, to-do a hollow one — alpha at the centre tells them apart', () => {
    const done = stationDiamondImage('done');
    const todo = stationDiamondImage('todo');
    const cx = Math.floor(done.width / 2);
    const cy = Math.floor(done.height / 2);

    expect(done.width).toBe(todo.width);
    expect(alphaAt(done, cx, cy)).toBe(255);
    expect(alphaAt(todo, cx, cy)).toBe(0);
    // Both still draw a diamond: an opaque band sits on the diagonal edge.
    expect(alphaAt(todo, cx, cy - 14)).toBe(255);
    expect(alphaAt(done, cx, cy - 14)).toBe(255);
  });

  test('the current image adds a ring beyond the diamond — shape, not colour, marks the target', () => {
    const done = stationDiamondImage('done');
    const current = stationDiamondImage('current');

    const maxOpaqueRadius = (image) => {
      const c = (image.width - 1) / 2;
      let max = 0;
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          if (image.data[(y * image.width + x) * 4 + 3] > 0) {
            max = Math.max(max, Math.hypot(x - c, y - c));
          }
        }
      }
      return max;
    };

    expect(maxOpaqueRadius(current)).toBeGreaterThan(maxOpaqueRadius(done) + 4);
  });

  test('the image data is plain bytes at a declared pixel ratio, addImage-ready', () => {
    const image = stationDiamondImage('done');

    expect(image.data).toBeInstanceOf(Uint8ClampedArray);
    expect(image.data.length).toBe(image.width * image.height * 4);
    expect(image.pixelRatio).toBe(2);
  });
});
