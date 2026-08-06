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
