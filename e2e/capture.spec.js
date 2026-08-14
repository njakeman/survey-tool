import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A real (tiny) PNG: the capture pipeline decodes and re-encodes the photo
// through a real Canvas, so the fixture must actually be an image.
const PHOTO = readFileSync(fileURLToPath(new URL('./fixtures/test-photo.png', import.meta.url)));

// Covers the one thing no unit test can: real IndexedDB persistence across a
// reload with real geolocation plumbing. Chromium only — this proves wiring,
// not iOS; see docs/ios-manual-checklist.md for the real device verification
// (standalone-mode permission prompts, WebKit's webkitCompassHeading, etc).
test.describe('capture flow', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'proves wiring, not iOS — real sensor/permission behaviour is checked on-device',
  );

  test('start a session, get a fix, save an observation, and it survives a reload', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.14, accuracy: 10 });

    await page.goto('/');

    await page.getByLabel(/session name/i).fill('E2E Test Session');
    await page.getByRole('button', { name: 'Start session' }).click();

    await expect(page.getByRole('button', { name: 'Save observation' })).toBeEnabled({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Save observation' }).click();
    await expect(page.getByText('1 saved')).toBeVisible();

    await page.reload();

    await expect(page.getByText('E2E Test Session')).toBeVisible();
    await expect(page.getByText('1 saved')).toBeVisible();
  });

  test('a saved photo can be viewed again — thumbnail and full-screen, in session and history', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.14, accuracy: 10 });

    await page.goto('/');
    await page.getByLabel(/session name/i).fill('Photo Session');
    await page.getByRole('button', { name: 'Start session' }).click();
    await expect(page.getByRole('button', { name: 'Save observation' })).toBeEnabled({
      timeout: 15_000,
    });

    // The real pipeline decodes and downscales the photo before storing it.
    await page.locator('input[capture="environment"]').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: PHOTO,
    });
    await expect(page.getByRole('button', { name: 'Remove photo' })).toBeVisible();

    await page.getByRole('button', { name: 'Save observation' }).click();
    await expect(page.getByText('1 saved')).toBeVisible();

    // Tap-to-load in the open session's list, then the full-screen view.
    await page.getByRole('button', { name: /show photo/i }).click();
    const thumb = page.locator('img.observations-photo-thumb');
    await expect(thumb).toBeVisible();
    expect(await thumb.getAttribute('src')).toMatch(/^blob:/);

    await thumb.click();
    await expect(page.getByRole('dialog', { name: /photo/i })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // History detail offers the same read — photos are not capture-only.
    await page.getByRole('button', { name: 'End session' }).click();
    await page.getByRole('button', { name: 'Confirm end session' }).click();
    await page.getByRole('button', { name: 'Session history' }).click();
    await page.getByRole('button', { name: /Photo Session/ }).click();
    await page.getByRole('button', { name: /show photo/i }).click();
    await expect(page.locator('img.observations-photo-thumb')).toBeVisible();
  });
});
