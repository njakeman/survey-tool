// Generates public/feature-layers/manifest.json — the list of GIS overlays
// the app offers. Reads each .geojson to measure it (feature count, bounds,
// geometry types) and merges in the matching `<id>.style.json` sidecar, which
// carries what cannot be measured: colour, width, which property to label by.
// Run:
//
//   node scripts/build-feature-layer-manifest.mjs
//
// Also runs automatically before `npm run build` (package.json `prebuild`),
// alongside the basemap manifest. Commit the regenerated file so `npm run
// dev`, which serves public/ without a build, shows the same list.
//
// Unlike the basemap archives, these files are read whole — which is the
// point: a feature layer that is big enough for that to hurt is big enough to
// want tiling instead (docs/making-pmtiles.md), and this warns when it sees
// one.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describeFeatureLayer } from '../src/map/featureLayerManifest.js';

const LAYERS_DIR = fileURLToPath(new URL('../public/feature-layers/', import.meta.url));
const MANIFEST_PATH = `${LAYERS_DIR}manifest.json`;

// Past this, a layer is really a tileset. Not an error — a 6 MB GeoJSON works
// perfectly well — but worth saying once, because the surveyor pays for it in
// fetch time and memory on the weakest device in the system.
const TILING_TERRITORY_BYTES = 5_000_000;

async function listLayerFiles() {
  try {
    const files = await readdir(LAYERS_DIR);
    return files.filter((file) => file.endsWith('.geojson')).sort();
  } catch {
    // No directory yet — a clean checkout with no layers added. An empty
    // manifest is still worth writing: the app fetches it, gets an honest
    // "no layers published", and shows that rather than a 404.
    return [];
  }
}

async function readStyle(id) {
  try {
    return JSON.parse(await readFile(`${LAYERS_DIR}${id}.style.json`, 'utf-8'));
  } catch (error) {
    // A missing sidecar is the normal case — every value has a default. A
    // *malformed* one is not, and silently falling back to defaults would
    // leave the author wondering why their colour never took effect.
    if (error.code !== 'ENOENT') {
      throw new Error(`${id}.style.json is not valid JSON — ${error.message}`, { cause: error });
    }
    return null;
  }
}

const files = await listLayerFiles();
const entries = [];
const skipped = [];
for (const file of files) {
  try {
    const id = file.replace(/\.geojson$/i, '');
    const text = await readFile(`${LAYERS_DIR}${file}`, 'utf-8');
    entries.push(describeFeatureLayer({ filename: file, text, style: await readStyle(id) }));
  } catch (error) {
    // Never fatal, for the same reason as the basemap generator: this is a
    // prebuild step, so throwing takes down the build, the e2e webServer and
    // the deploy together. A bad file costs one layer.
    skipped.push({ file, reason: error.message });
  }
}

await mkdir(LAYERS_DIR, { recursive: true });
await writeFile(MANIFEST_PATH, `${JSON.stringify(entries, null, 2)}\n`);

for (const entry of entries) {
  const kb = (entry.sizeBytes / 1000).toFixed(0);
  console.log(
    `${entry.id.padEnd(24)} ${kb.padStart(7)} kB  ${String(entry.featureCount).padStart(6)} features  ${entry.geometryTypes.join('+') || 'no geometry'}`,
  );
  if (entry.sizeBytes > TILING_TERRITORY_BYTES) {
    console.warn(
      `  ${entry.id} is ${(entry.sizeBytes / 1_000_000).toFixed(1)} MB — large for a feature layer. ` +
        'Consider vector tiles instead (docs/making-pmtiles.md).',
    );
  }
}
for (const { file, reason } of skipped) {
  console.warn(`SKIPPED ${file} — ${reason}`);
}

if (entries.length === 0) {
  console.log('no usable .geojson layers in public/feature-layers/ — wrote an empty manifest');
} else {
  console.log(`wrote ${MANIFEST_PATH} (${entries.length} layers)`);
}
