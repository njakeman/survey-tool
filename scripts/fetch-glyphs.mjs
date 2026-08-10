// Vendors the basemap glyph ranges into public/fonts/, where the service
// worker precaches them. Labels have to render with no network at all, so
// hosted glyphs are not an option — these files ship with the app.
//
// Source: protomaps/basemaps-assets (Noto Sans, SIL Open Font License 1.1).
// Run: node scripts/fetch-glyphs.mjs
//
// The local directory is named `noto-sans-regular`, not the upstream
// "Noto Sans Regular": a space in the path invites a mismatch between the
// encoding Workbox stores in its precache manifest and the one MapLibre
// requests. The stack name is only ever a URL path segment, so a
// hyphenated name costs nothing and removes the failure mode.
//
// Adding a region whose labels need other scripts (Cyrillic, Greek, CJK…)
// means adding range names here, re-running, and committing the result —
// see the Offline basemap section of the README.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FONT_STACK, GLYPH_RANGES } from '../src/map/glyphs.js';

const UPSTREAM = 'https://raw.githubusercontent.com/protomaps/basemaps-assets/main/fonts/';
const UPSTREAM_STACK = 'Noto Sans Regular';
const outDir = fileURLToPath(new URL(`../public/fonts/${FONT_STACK}/`, import.meta.url));

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`failed to fetch ${url}: ${lastError.message}`);
}

await mkdir(outDir, { recursive: true });

let total = 0;
for (const range of GLYPH_RANGES) {
  const url = `${UPSTREAM}${encodeURIComponent(UPSTREAM_STACK)}/${range}.pbf`;
  const bytes = await fetchWithRetry(url);
  await writeFile(`${outDir}${range}.pbf`, bytes);
  total += bytes.byteLength;
  console.log(`${range}.pbf  ${(bytes.byteLength / 1024).toFixed(0)} KB`);
}
console.log(
  `vendored ${GLYPH_RANGES.length} ranges into ${outDir} (${Math.round(total / 1024)} KB)`,
);
