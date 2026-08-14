import { test, expect } from '@playwright/test';

test('registers a service worker and renders the capture page by default', async ({ page }) => {
  await page.goto('/');

  // A fresh install has no session, so the first-launch state is the start
  // form — Save appears only once a session opens (design pass 3 §5a).
  await expect(page.getByRole('button', { name: 'Start session' })).toBeVisible();
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

test('a muted cross-origin error paints no fatal banner; a real error still does', async ({
  page,
}) => {
  // The iOS share-sheet symptom: WebKit dispatches a sanitized ErrorEvent
  // (message "Script error.", null error, no filename) for errors the page
  // may not inspect — browser-internal or extension script, never app code,
  // since every app script is same-origin. The global handler must ignore
  // it instead of painting "Something went wrong loading the app: Script
  // error. (:0:0)" over a working app. A genuine error keeps the banner —
  // it is the only diagnostics channel on an installed PWA.
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start session' })).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
  });
  await expect(page.getByText(/something went wrong/i)).not.toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'real failure',
        filename: 'main.js',
        lineno: 12,
        colno: 4,
        error: new Error('real failure'),
      }),
    );
  });
  await expect(page.getByText(/something went wrong/i)).toBeVisible();
  await expect(page.getByText(/real failure/)).toBeVisible();
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
