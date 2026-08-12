import { test, expect } from '@playwright/test';

test('registers a service worker and renders the capture page by default', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Save observation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Device probe' })).toBeVisible();

  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 15_000,
  });
});

test('the device probe is still reachable via the footer link', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Device probe' }).click();

  await expect(page.getByRole('heading', { name: 'Device capability probe' })).toBeVisible();
});

test('a fresh load requests no same-origin resource that 404s', async ({ page }) => {
  // The standing guard against exactly the class of bug an SW-generation
  // mismatch causes: an old page requesting a hashed asset that a newer
  // deploy has already pruned. Listener attached before goto() so it also
  // catches the initial document/module-script requests, not just later
  // ones. Filtered to localhost so a flaky third-party response (the online
  // imagery tiles) can never fail the install check.
  const notFound = [];
  page.on('response', (response) => {
    if (new URL(response.url()).hostname === 'localhost' && response.status() === 404) {
      notFound.push(response.url());
    }
  });

  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 15_000,
  });

  expect(notFound).toEqual([]);
});

test("a fresh install's first load never shows the offline-readiness warning once it settles", async ({
  page,
}) => {
  // Pins the reported false positive directly: readOfflineStatus() used to
  // be sampled once at startup, before the SW had finished precaching, so
  // *every* genuinely-first load showed "No offline cache" even on a
  // correct production build. subscribeOfflineStatus (src/app/offlineStatus.js)
  // reports settled state instead — this must stay hidden throughout.
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 15_000,
  });

  await expect(page.getByText(/no offline cache/i)).not.toBeVisible();
});
