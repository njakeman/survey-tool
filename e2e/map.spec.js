import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

// The recorded Phase 4 acceptance criterion: "map renders offline
// immediately after a fresh install, no network at all"
// (docs/ios-manual-checklist.md), now across several regions. Everything
// below this is unit-tested; this is the only check that the manifest, the
// download, the IndexedDB archives, the precached glyphs and the service
// worker actually add up to a working offline map.
//
// Archives come from the committed fixtures, so CI needs no real extract.
const SOUTH = readFileSync(
  fileURLToPath(new URL('./fixtures/test-basemap.pmtiles', import.meta.url)),
);
const NORTH = readFileSync(
  fileURLToPath(new URL('./fixtures/test-basemap-north.pmtiles', import.meta.url)),
);

const MANIFEST = [
  {
    id: 'test-south',
    name: 'Test South',
    url: 'basemaps/test-south.pmtiles',
    sizeBytes: SOUTH.byteLength,
    bounds: [-1, 51, 0.5, 52],
    minZoom: 0,
    maxZoom: 0,
  },
  {
    id: 'test-north',
    name: 'Test North',
    url: 'basemaps/test-north.pmtiles',
    sizeBytes: NORTH.byteLength,
    bounds: [-2.5, 53, -1, 54],
    minZoom: 0,
    maxZoom: 0,
  },
];

test.describe('offline basemap', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'setOffline does not propagate to the service worker target on WebKit at this Playwright version',
  );

  async function serveRegions(context) {
    // Routed before goto: the app reads the manifest at startup to decide
    // what the picker offers.
    await context.route('**/basemaps/manifest.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MANIFEST),
      }),
    );
    await context.route('**/basemaps/*.pmtiles', (route) => {
      const body = route.request().url().includes('north') ? NORTH : SOUTH;
      route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: { etag: '"fixture-v1"' },
        body,
      });
    });
  }

  function openPicker(page) {
    return page.getByRole('button', { name: /choose a region|change map/i }).click();
  }

  // Downloading leaves you in the picker — only choosing a region already on
  // the device closes it — so the row is waited on rather than the map.
  async function downloadRegion(page, name) {
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toContainText(
      /in use|on this device/i,
      { timeout: 20_000 },
    );
  }

  test('downloads a region, then renders it with the network cut', async ({ page, context }) => {
    await serveRegions(context);
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 15_000,
    });

    await openPicker(page);
    await downloadRegion(page, 'Test South');
    await page.getByRole('button', { name: /back to capture/i }).click();
    await expect(page.locator('[data-map-loaded="true"]')).toBeAttached({ timeout: 20_000 });

    // Nothing may reach the network from here on: the archive must come from
    // IndexedDB and every style asset, glyphs included, from the precache.
    // The manifest fetch is among the things that now fail — the app must
    // fall back to the regions already on the device rather than losing the
    // map it holds.
    await context.setOffline(true);
    await context.route('**/*', (route) => route.abort('internetdisconnected'));

    const response = await page.reload();

    expect(response.fromServiceWorker()).toBe(true);
    await expect(page.locator('[data-map-loaded="true"]')).toBeAttached({ timeout: 20_000 });
    await expect(page.locator('.capture-map canvas')).toBeVisible();
  });

  test('holds two regions and switches between them with no network', async ({ page, context }) => {
    await serveRegions(context);
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 15_000,
    });

    await openPicker(page);
    await downloadRegion(page, 'Test South');
    await downloadRegion(page, 'Test North');
    await page.getByRole('button', { name: /back to capture/i }).click();
    await expect(page.locator('[data-map-loaded="true"]')).toBeAttached({ timeout: 20_000 });

    await context.setOffline(true);
    await context.route('**/*', (route) => route.abort('internetdisconnected'));
    await page.reload();
    await expect(page.locator('[data-map-loaded="true"]')).toBeAttached({ timeout: 20_000 });

    // Both are on the device now, so switching is a local operation.
    await page.getByRole('button', { name: /change map/i }).click();
    await expect(page.getByRole('button', { name: /^Test South/ })).toBeVisible();
    await page.getByRole('button', { name: /^Test South/ }).click();

    await expect(page.locator('[data-map-loaded="true"]')).toBeAttached({ timeout: 20_000 });
    await expect(page.locator('.capture-map canvas')).toBeVisible();
  });

  test('Expand map makes the panel the screen on the same map, and Close map puts the page back', async ({
    page,
    context,
  }) => {
    await serveRegions(context);
    await page.goto('/');
    await openPicker(page);
    await downloadRegion(page, 'Test South');
    await page.getByRole('button', { name: /back to capture/i }).click();
    await expect(page.locator('[data-map-loaded="true"]')).toBeAttached({ timeout: 20_000 });

    // Tag the live container so a rebuild (a new node) would be caught.
    await page.evaluate(() => {
      document.querySelector('[data-map-loaded="true"]').dataset.sameMap = 'yes';
      window.scrollTo(0, 120);
    });
    const before = await page.locator('.capture-map').boundingBox();
    expect(before.height).toBeLessThan(400);

    await page.getByRole('button', { name: /expand map/i }).click();

    const viewport = page.viewportSize();
    const box = await page.locator('.capture-map').boundingBox();
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBe(viewport.width);
    expect(box.height).toBe(viewport.height);
    await expect(page.locator('[data-map-loaded="true"][data-same-map="yes"]')).toBeAttached();
    await expect(page.locator('.capture-map canvas')).toBeVisible();

    await page.getByRole('button', { name: /close map/i }).click();

    const after = await page.locator('.capture-map').boundingBox();
    expect(after.height).toBe(before.height);
    await expect(page.locator('[data-map-loaded="true"][data-same-map="yes"]')).toBeAttached();
    expect(await page.evaluate(() => window.scrollY)).toBe(120);
  });

  test('an install with no region says so instead of showing a broken map', async ({
    page,
    context,
  }) => {
    await serveRegions(context);
    await page.goto('/');

    await expect(page.getByRole('button', { name: /choose a region/i })).toBeVisible();
    await expect(page.locator('.capture-map canvas')).toHaveCount(0);
  });
});
