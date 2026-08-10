import { describe, expect, test } from 'vitest';
import { buildStyle } from './style.js';

const GLYPHS_URL = 'https://example.test/survey-tool/fonts/{fontstack}/{range}.pbf';

function makeStyle() {
  return buildStyle({ glyphsUrl: GLYPHS_URL });
}

describe('buildStyle', () => {
  test('is a version-8 style with a single pmtiles vector source and attribution', () => {
    const style = makeStyle();

    expect(style.version).toBe(8);
    expect(Object.keys(style.sources)).toEqual(['basemap']);
    expect(style.sources.basemap.type).toBe('vector');
    expect(style.sources.basemap.url).toBe('pmtiles://basemap');
    expect(style.sources.basemap.attribution).toMatch(/OpenStreetMap/);
  });

  test('addresses the archive by key, so two open regions cannot collide', () => {
    // The scheme must stay `pmtiles` — the library parses tile URLs with a
    // hardcoded prefix — so per-map uniqueness lives in the key. The source
    // id stays 'basemap' because @protomaps/basemaps binds every layer it
    // emits to that name.
    const style = buildStyle({ glyphsUrl: GLYPHS_URL, archiveKey: 'basemap-7' });

    expect(Object.keys(style.sources)).toEqual(['basemap']);
    expect(style.sources.basemap.url).toBe('pmtiles://basemap-7');
    expect(style.layers.every((layer) => !layer.source || layer.source === 'basemap')).toBe(true);
  });

  test('uses the given glyphs URL', () => {
    expect(makeStyle().glyphs).toBe(GLYPHS_URL);
  });

  test('needs no sprite: no sprite key, no icon-image in any layer', () => {
    // Sprites are a second hosted-asset dependency; the style must be fully
    // served by the precached glyphs alone to keep "offline immediately
    // after download" true.
    const style = makeStyle();

    expect(style).not.toHaveProperty('sprite');
    for (const layer of style.layers) {
      expect(layer.layout ?? {}).not.toHaveProperty('icon-image');
    }
  });

  test('drops the icon-only layers outright', () => {
    const ids = makeStyle().layers.map((layer) => layer.id);
    expect(ids).not.toContain('roads_oneway');
    expect(ids).not.toContain('roads_shields');
  });

  // text-font comes in two shapes: a plain stack (["Noto Sans Regular"]) and
  // an expression whose branches carry ["literal", [stack]] — places_locality
  // switches on min_zoom. Only one glyph directory is vendored and precached,
  // so EVERY stack a renderer could select has to be that one; a stray second
  // stack would mean silently missing labels offline.
  function fontStacksIn(textFont) {
    if (!Array.isArray(textFont)) return [];
    if (textFont.every((entry) => typeof entry === 'string')) return [textFont];
    return literalStacksIn(textFont);
  }

  function literalStacksIn(node) {
    if (!Array.isArray(node)) return [];
    if (node[0] === 'literal' && Array.isArray(node[1])) return [node[1]];
    return node.flatMap(literalStacksIn);
  }

  test('every font stack any text layer could select is the single vendored one', () => {
    const style = makeStyle();
    const textLayers = style.layers.filter((layer) => layer.layout?.['text-font']);

    expect(textLayers.length).toBeGreaterThan(0); // labels ARE wanted in the field

    const stacks = textLayers.flatMap((layer) => fontStacksIn(layer.layout['text-font']));
    expect(stacks.length).toBeGreaterThanOrEqual(textLayers.length);
    for (const stack of stacks) {
      // Must match the vendored directory name exactly — glyphs.test.js
      // holds the other end of that contract.
      expect(stack).toEqual(['noto-sans-regular']);
    }
  });

  test('includes label layers (lang en) and no POI layers', () => {
    const style = makeStyle();
    const ids = style.layers.map((layer) => layer.id);

    expect(ids.some((id) => id.startsWith('places_'))).toBe(true);
    expect(ids.some((id) => id.startsWith('pois'))).toBe(false);
  });
});
