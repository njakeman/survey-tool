import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

// The recorded Phase 4 acceptance criterion: "map renders offline
// immediately after a fresh install, no network at all"
// (docs/ios-manual-checklist.md). Everything below it is unit-tested; this
// is the only check that the download, the IndexedDB archive, the precached
// glyphs and the service worker actually add up to a working offline map.
//
// The archive is served from the committed fixture rather than a real
// extract, so CI needs no multi-megabyte asset.
const FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/test-basemap.pmtiles', import.meta.url)),
);

test.describe('offline basemap', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'setOffline does not propagate to the service worker target on WebKit at this Playwright version',
  );

  const MANIFEST = [
    {
      id: 'test-region',
      name: 'Test Region',
      url: 'basemaps/test-region.pmtiles',
      sizeBytes: FIXTURE.byteLength,
      bounds: [-1, 51, 0.5, 52],
      minZoom: 0,
      maxZoom: 0,
    },
  ];

  async function serveArchive(context) {
    // Routed before goto: the app reads the manifest at startup to decide
    // what the map panel offers.
    await context.route('**/basemaps/manifest.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MANIFEST),
      }),
    );
    await context.route('**/basemaps/*.pmtiles', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: { etag: '"fixture-v1"' },
        body: FIXTURE,
      }),
    );
  }

  test('downloads once online, then renders with the network cut', async ({ page, context }) => {
    await serveArchive(context);
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 15_000,
    });

    await page.getByRole('button', { name: /download offline map/i }).click();
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
    // The download offer must not reappear for an archive already held.
    await expect(page.getByRole('button', { name: /download offline map/i })).toHaveCount(0);
  });

  test('an install with no archive says so instead of showing a broken map', async ({
    page,
    context,
  }) => {
    await serveArchive(context);
    await page.goto('/');

    await expect(page.getByRole('button', { name: /download offline map/i })).toBeVisible();
    await expect(page.locator('.capture-map canvas')).toHaveCount(0);
  });
});
