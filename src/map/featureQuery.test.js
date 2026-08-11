import { describe, expect, test } from 'vitest';
import { describeTappedFeature } from './featureQuery.js';

const LAYERS = [
  {
    id: 'parcels',
    name: 'Field parcels',
    style: { idProperty: 'parcel_id', titleProperty: 'ref', fieldOrder: ['ref', 'area_ha'] },
  },
  { id: 'designations', name: 'Designations', style: {} },
];

function hit(overrides = {}) {
  return {
    source: 'feature-layer-parcels',
    layer: { id: 'feature-layer-parcels-fill' },
    properties: { parcel_id: 'P-42', ref: 'SU1408 3921', area_ha: 4.2, tenure: 'owned' },
    ...overrides,
  };
}

describe('describeTappedFeature', () => {
  test('reports nothing when the tap hit nothing', () => {
    expect(describeTappedFeature([], LAYERS)).toBeNull();
    expect(describeTappedFeature(undefined, LAYERS)).toBeNull();
  });

  test('names the layer the feature came from, resolved through its source', () => {
    const result = describeTappedFeature([hit()], LAYERS);

    expect(result.layerId).toBe('parcels');
    expect(result.layerName).toBe('Field parcels');
  });

  test('takes the topmost hit, which is what the surveyor saw under their thumb', () => {
    const beneath = hit({
      source: 'feature-layer-designations',
      layer: { id: 'feature-layer-designations-fill' },
      properties: { name: 'SSSI' },
    });

    expect(describeTappedFeature([hit(), beneath], LAYERS).layerId).toBe('parcels');
  });

  test('reads the id and title from the declared properties', () => {
    const result = describeTappedFeature([hit()], LAYERS);

    expect(result.featureId).toBe('P-42');
    expect(result.title).toBe('SU1408 3921');
  });

  test("falls back to the feature's own id when no id property is declared", () => {
    const undeclared = hit({
      source: 'feature-layer-designations',
      layer: { id: 'feature-layer-designations-fill' },
      id: 7,
      properties: { name: 'SSSI' },
    });

    const result = describeTappedFeature([undeclared], LAYERS);

    expect(result.featureId).toBe('7');
    // Titled by the id rather than the layer name: "7" is at least something
    // the surveyor can quote, where repeating "Designations" under a heading
    // that already says "Designations" tells them nothing.
    expect(result.title).toBe('7');
  });

  test('has a null feature id rather than inventing one when there is nothing to use', () => {
    // A GeoJSON feature need carry no id at all. Fabricating one would put a
    // meaningless value on a saved observation, which is worse than no link.
    const anonymous = hit({
      source: 'feature-layer-designations',
      layer: { id: 'feature-layer-designations-fill' },
      properties: { name: 'SSSI' },
    });

    const result = describeTappedFeature([anonymous], LAYERS);
    expect(result.featureId).toBeNull();
    // Only with nothing at all to identify it does the layer name stand in.
    expect(result.title).toBe('Designations');
  });

  test('orders fields by the declaration first, then alphabetically', () => {
    const result = describeTappedFeature([hit()], LAYERS);

    expect(result.fields.map((field) => field.key)).toEqual([
      'ref',
      'area_ha',
      'parcel_id',
      'tenure',
    ]);
  });

  test('drops empty values, which would otherwise be rows of nothing', () => {
    const sparse = hit({
      properties: { ref: 'SU1408', area_ha: null, tenure: '', notes: undefined, count: 0 },
    });

    const keys = describeTappedFeature([sparse], LAYERS).fields.map((field) => field.key);
    expect(keys).toEqual(['ref', 'count']);
  });

  test('keeps a zero — it is a value, not an absence', () => {
    const withZero = hit({ properties: { area_ha: 0 } });

    expect(describeTappedFeature([withZero], LAYERS).fields).toEqual([
      { key: 'area_ha', value: '0' },
    ]);
  });

  test('drops underscore-prefixed keys, which are plumbing rather than attributes', () => {
    const withInternals = hit({ properties: { ref: 'SU1408', _rowid: 12, __id: 'x' } });

    expect(describeTappedFeature([withInternals], LAYERS).fields.map((f) => f.key)).toEqual([
      'ref',
    ]);
  });

  test('renders every value as a string, so the sheet has nothing to decide', () => {
    const mixed = hit({ properties: { n: 4.2, flag: true, nested: { a: 1 } } });

    expect(describeTappedFeature([mixed], LAYERS).fields).toEqual([
      { key: 'flag', value: 'true' },
      { key: 'n', value: '4.2' },
      { key: 'nested', value: '{"a":1}' },
    ]);
  });

  test('ignores a hit from a layer that is no longer loaded', () => {
    // Layers can be switched off between the tap and the query resolving.
    const orphan = hit({ source: 'feature-layer-gone', layer: { id: 'feature-layer-gone-fill' } });

    expect(describeTappedFeature([orphan], LAYERS)).toBeNull();
  });

  test('survives a feature with no properties at all', () => {
    const bare = hit({ properties: undefined });

    expect(describeTappedFeature([bare], LAYERS).fields).toEqual([]);
  });
});
