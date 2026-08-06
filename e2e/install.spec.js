import { test, expect } from '@playwright/test';

test('registers a service worker and renders the probe page', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Device capability probe' })).toBeVisible();

  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 15_000,
  });
});
