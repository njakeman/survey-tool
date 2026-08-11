// Vendors the UI typeface into public/fonts/atkinson/, where the service
// worker precaches it. Same rule as the map glyphs next door: the app has to
// render with no network at all, so a hosted webfont is not an option — these
// files ship with the build.
//
// Source: Google Fonts (Atkinson Hyperlegible, SIL Open Font License 1.1 —
// the same licence as the vendored Noto Sans, so the precedent covers it).
// Run: node scripts/fetch-fonts.mjs
//
// Only the *latin* subset of each weight is taken. Google's CSS also offers
// latin-ext; nothing in this app's copy needs it, and the point of vendoring
// is to keep the precache small. If a region's UI ever needs accented Latin
// beyond U+00FF, add 'latin-ext' to SUBSETS and re-run.
//
// A browser User-Agent is required, not politeness: Google's CSS API serves
// TTF to clients it doesn't recognise and woff2 only to those it does, so
// without this header the script silently vendors ~10x the bytes in the wrong
// format.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap';
const LICENCE_URL =
  'https://raw.githubusercontent.com/googlefonts/atkinson-hyperlegible/main/OFL.txt';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SUBSETS = ['latin'];
const WEIGHTS = { 400: 'atkinson-regular.woff2', 700: 'atkinson-bold.woff2' };

const outDir = fileURLToPath(new URL('../public/fonts/atkinson/', import.meta.url));

async function fetchWithRetry(url, { headers } = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`failed to fetch ${url}: ${lastError.message}`);
}

// Google's CSS is emitted as `/* subset */ @font-face { … }` pairs. Reading
// the subset comment is what lets us take latin and skip latin-ext, which are
// otherwise indistinguishable without parsing unicode-range.
function parseFaces(css) {
  const faces = [];
  const pattern = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const [, subset, body] of css.matchAll(pattern)) {
    const weight = body.match(/font-weight:\s*(\d+)/)?.[1];
    const url = body.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (weight && url) faces.push({ subset, weight, url });
  }
  return faces;
}

const css = await (await fetchWithRetry(CSS_URL, { headers: { 'User-Agent': CHROME_UA } })).text();
const faces = parseFaces(css);

await mkdir(outDir, { recursive: true });

let total = 0;
for (const [weight, filename] of Object.entries(WEIGHTS)) {
  const face = faces.find((f) => f.weight === weight && SUBSETS.includes(f.subset));
  if (!face) throw new Error(`no ${SUBSETS.join('/')} face at weight ${weight} in the Google CSS`);
  const bytes = new Uint8Array(await (await fetchWithRetry(face.url)).arrayBuffer());
  await writeFile(`${outDir}${filename}`, bytes);
  total += bytes.byteLength;
  console.log(`${filename}  ${(bytes.byteLength / 1024).toFixed(0)} KB`);
}

const licence = await (await fetchWithRetry(LICENCE_URL)).text();
await writeFile(`${outDir}OFL.txt`, licence);

console.log(
  `vendored ${Object.keys(WEIGHTS).length} weights into ${outDir} (${Math.round(total / 1024)} KB)`,
);
