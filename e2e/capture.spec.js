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

  test('ending an empty session discards it — nothing lands in history', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.14, accuracy: 10 });

    await page.goto('/');
    await page.getByLabel(/session name/i).fill('Mistaken Start');
    await page.getByRole('button', { name: 'Start session' }).click();
    await expect(page.getByText('0 saved')).toBeVisible();

    // Export has nothing to act on yet.
    await expect(page.getByRole('button', { name: /^export$/i })).toBeDisabled();
    await expect(page.getByText(/nothing to export yet/i)).toBeVisible();

    await page.getByRole('button', { name: 'End session' }).click();
    await page.getByRole('button', { name: 'Nothing recorded — discard session' }).click();

    await page.getByRole('button', { name: 'Session history' }).click();
    await expect(page.getByText('No past sessions yet')).toBeVisible();
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

    // Tap-to-load in the open session's list (the attachment strip's chip),
    // scoped to the row: the compose field's file input is also a button
    // named "Photo" to ARIA. exact: "Add photo" is a near-miss.
    await page
      .locator('li.observations-row')
      .getByRole('button', { name: 'Photo', exact: true })
      .click();
    const thumb = page.locator('img.observations-photo-thumb');
    await expect(thumb).toBeVisible();
    const firstUrl = await thumb.getAttribute('src');
    expect(firstUrl).toMatch(/^blob:/);

    await thumb.click();
    await expect(page.getByRole('dialog', { name: /photo/i })).toBeVisible();

    // Retake (design pass 4 §7e): the picked file runs the real downscale
    // pipeline, the record repoints, and the open view swaps the image.
    await page
      .locator('.photo-lightbox input[capture="environment"]')
      .setInputFiles({ name: 'retake.png', mimeType: 'image/png', buffer: PHOTO });
    await expect
      .poll(async () => page.locator('.photo-lightbox-image').getAttribute('src'))
      .not.toBe(firstUrl);
    // The edit marks the record: the row now reads Changed since export
    // once exported — here it was never exported, so Not exported stands.

    // exact: the Boundary trace button's caption ("Closes back to the
    // start") substring-matches 'Close'.
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // History detail offers the same read — photos are not capture-only.
    await page.getByRole('button', { name: 'End session' }).click();
    await page.getByRole('button', { name: 'Confirm end session' }).click();
    await page.getByRole('button', { name: 'Session history' }).click();
    await page.getByRole('button', { name: /Photo Session/ }).click();
    await page
      .locator('li.observations-row')
      .getByRole('button', { name: 'Photo', exact: true })
      .click();
    await expect(page.locator('img.observations-photo-thumb')).toBeVisible();
    // Read-only there: the full view offers no Retake or Delete.
    await page.locator('img.observations-photo-thumb').click();
    await expect(page.getByRole('dialog', { name: /photo/i })).toBeVisible();
    await expect(page.getByText('Retake')).toHaveCount(0);
  });

  test('a saved photo can be deleted — two-step — and another added in its place', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.14, accuracy: 10 });

    await page.goto('/');
    await page.getByLabel(/session name/i).fill('Delete Photo Session');
    await page.getByRole('button', { name: 'Start session' }).click();
    await expect(page.getByRole('button', { name: 'Save observation' })).toBeEnabled({
      timeout: 15_000,
    });
    await page.locator('input[capture="environment"]').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: PHOTO,
    });
    await expect(page.getByRole('button', { name: 'Remove photo' })).toBeVisible();
    await page.getByRole('button', { name: 'Save observation' }).click();
    await expect(page.getByText('1 saved')).toBeVisible();

    await page
      .locator('li.observations-row')
      .getByRole('button', { name: 'Photo', exact: true })
      .click();
    await page.locator('img.observations-photo-thumb').click();
    await expect(page.getByRole('dialog', { name: /photo/i })).toBeVisible();

    // Two-step: Delete arms, Delete photo commits, the view closes.
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete photo' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The empty slot offers Add photo (a link, not a chip), and adding one
    // lands the strip back on a chip that opens.
    const row = page.locator('li.observations-row').first();
    await expect(row.getByText('Add photo')).toBeVisible();
    await row.locator('input[capture="environment"]').setInputFiles({
      name: 'added.png',
      mimeType: 'image/png',
      buffer: PHOTO,
    });
    await expect(row.getByRole('button', { name: 'Photo', exact: true })).toBeVisible();
  });
});
