import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { FONT_STACK, GLYPH_RANGES, glyphsUrl } from './glyphs.js';

const fontsDir = fileURLToPath(new URL('../../public/fonts/', import.meta.url));

describe('glyphsUrl', () => {
  test('keeps the {fontstack} and {range} placeholders literal', () => {
    // MapLibre substitutes these itself. Building the URL with `new URL()`
    // percent-encodes the braces (%7Bfontstack%7D) and every glyph request
    // 404s — offline that means silently unlabelled map, with no error the
    // surveyor would ever see.
    const url = glyphsUrl('https://example.test/survey-tool/');

    expect(url).toBe('https://example.test/survey-tool/fonts/{fontstack}/{range}.pbf');
    expect(url).not.toContain('%7B');
  });

  test('joins cleanly whatever the base path is', () => {
    expect(glyphsUrl('https://example.test/')).toBe(
      'https://example.test/fonts/{fontstack}/{range}.pbf',
    );
  });
});

describe('vendored glyphs', () => {
  test('the font stack name is URL-safe, so precache keys and glyph requests cannot disagree', () => {
    // The upstream directory is "Noto Sans Regular". A space means the
    // service worker stores one encoding of the key and MapLibre may request
    // another; a hyphenated name removes the failure mode entirely, and the
    // stack name is only ever a URL path segment.
    expect(FONT_STACK).toBe('noto-sans-regular');
    expect(encodeURIComponent(FONT_STACK)).toBe(FONT_STACK);
  });

  test('every declared range is actually vendored under the font stack directory', () => {
    // If the style asks for a range that was never committed, the map loses
    // those characters the moment it is offline. This is the check that keeps
    // the declared list and the shipped files honest.
    for (const range of GLYPH_RANGES) {
      const path = `${fontsDir}${FONT_STACK}/${range}.pbf`;
      expect(existsSync(path), `missing glyph range: ${range}`).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(0);
    }
  });

  test('covers Latin and the punctuation range place names actually use', () => {
    expect(GLYPH_RANGES).toContain('0-255');
    expect(GLYPH_RANGES).toContain('256-511');
    expect(GLYPH_RANGES).toContain('8192-8447');
  });
});
