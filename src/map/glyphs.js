// The vendored label fonts. Glyphs are the one style asset MapLibre fetches
// lazily at render time, so they have to ship with the app and be precached —
// a hosted glyph server would mean an unlabelled map the moment the surveyor
// is offline, with no error anywhere they'd see it.
//
// Named without a space (upstream is "Noto Sans Regular") so the precache key
// and the request URL cannot disagree over encoding. The stack name is only a
// URL path segment as far as MapLibre is concerned.
//
// Files are vendored by scripts/fetch-glyphs.mjs; glyphs.test.js asserts the
// declared ranges are actually on disk.

export const FONT_STACK = 'noto-sans-regular';

// Latin (basic, Extended-A, Extended-B/IPA, diacritics) plus General
// Punctuation, which place names use for en-dashes and curly apostrophes.
// Enough for the UK and western Europe; other scripts need extra ranges
// added here and re-vendored (see README).
export const GLYPH_RANGES = ['0-255', '256-511', '512-767', '768-1023', '8192-8447'];

// Plain string concatenation, never `new URL()` — that percent-encodes the
// braces MapLibre needs to substitute into.
export function glyphsUrl(baseUrl) {
  return `${baseUrl}fonts/{fontstack}/{range}.pbf`;
}
