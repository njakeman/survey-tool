// Generates public/basemaps/manifest.json — the list of offline map regions
// the app offers. Reads each archive's real header, so the published bounds,
// zooms and sizes can never drift from the files actually deployed. Run:
//
//   node scripts/build-basemap-manifest.mjs
//
// Also runs automatically before `npm run build` (package.json `prebuild`),
// so dropping a new .pmtiles into public/basemaps/ and deploying is enough —
// there is no second step to forget. Commit the regenerated manifest too, so
// `npm run dev`, which serves public/ without a build, shows the same list.
//
// Only headers are read, a few KB per archive, never whole files: see
// FileHandleSource in src/map/manifest.js.

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describeArchive } from '../src/map/manifest.js';

const BASEMAPS_DIR = fileURLToPath(new URL('../public/basemaps/', import.meta.url));
const MANIFEST_PATH = `${BASEMAPS_DIR}manifest.json`;

async function listArchives() {
  try {
    const files = await readdir(BASEMAPS_DIR);
    return files.filter((file) => file.endsWith('.pmtiles')).sort();
  } catch {
    // No directory yet — a clean checkout with no regions added. An empty
    // manifest is still worth writing: the app fetches it, gets an honest
    // "no regions published", and shows that rather than a 404.
    return [];
  }
}

const archives = await listArchives();
const entries = [];
for (const file of archives) {
  entries.push(await describeArchive(`${BASEMAPS_DIR}${file}`));
}

await mkdir(BASEMAPS_DIR, { recursive: true });
await writeFile(MANIFEST_PATH, `${JSON.stringify(entries, null, 2)}\n`);

if (entries.length === 0) {
  console.log(`no .pmtiles archives in public/basemaps/ — wrote an empty manifest`);
} else {
  for (const entry of entries) {
    const mb = (entry.sizeBytes / 1_000_000).toFixed(1);
    console.log(`${entry.id.padEnd(24)} ${mb.padStart(7)} MB  z${entry.minZoom}-${entry.maxZoom}`);
  }
  console.log(`wrote ${MANIFEST_PATH} (${entries.length} regions)`);
}
