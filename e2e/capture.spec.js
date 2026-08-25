import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readZip } from '../src/import/zipReader.js';

// A real (tiny) PNG: the capture pipeline decodes and re-encodes the photo
// through a real Canvas, so the fixture must actually be an image.
const PHOTO = readFileSync(fileURLToPath(new URL('./fixtures/test-photo.png', import.meta.url)));

// Covers the one thing no unit test can: real IndexedDB persistence across a
// reload with real geolocation plumbing. Runs on every Chromium-engine
// project (desktop chromium and mobile-chrome) — this proves wiring, not a
// real device; see docs/ios-manual-checklist.md and
// docs/android-manual-checklist.md for on-device verification
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
    await expect(page.getByRole('button', { name: /^Remove photo/ })).toBeVisible();

    await page.getByRole('button', { name: 'Save observation' }).click();
    await expect(page.getByText('1 saved')).toBeVisible();

    // The thumb appears in the row's attachment strip on its own — no chip
    // to tap through, since the strip owns the photo now.
    const thumb = page.locator('li.observations-row img.observations-photo-thumb');
    await expect(thumb).toBeVisible();
    const firstUrl = await thumb.getAttribute('src');
    expect(firstUrl).toMatch(/^blob:/);

    await thumb.click();
    await expect(page.getByRole('dialog', { name: /photo/i })).toBeVisible();

    // Retake (design pass 4 §7e): the picked file runs the real downscale
    // pipeline, the record repoints, and the open view swaps the image.
    // Scoped to Retake's own input — the lightbox also carries an Add
    // input (a lone photo is still under the cap) and an unscoped
    // `.photo-lightbox input[capture="environment"]` would match both.
    await page
      .locator('.photo-lightbox-retake input[capture="environment"]')
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
    await expect(page.getByRole('button', { name: /^Remove photo/ })).toBeVisible();
    await page.getByRole('button', { name: 'Save observation' }).click();
    await expect(page.getByText('1 saved')).toBeVisible();

    await page.locator('img.observations-photo-thumb').click();
    await expect(page.getByRole('dialog', { name: /photo/i })).toBeVisible();

    // Two-step: Delete arms, Delete photo commits, the view closes.
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete photo' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The empty slot offers Add photo (a link, not a chip), and the added
    // photo shows straight away as the thumbnail — no second tap (field
    // report, 2026-08-14).
    const row = page.locator('li.observations-row').first();
    await expect(row.getByText('Add photo')).toBeVisible();
    await row.locator('input[capture="environment"]').setInputFiles({
      name: 'added.png',
      mimeType: 'image/png',
      buffer: PHOTO,
    });
    await expect(row.locator('img.observations-photo-thumb')).toBeVisible();
  });

  test('several photos per observation, end to end', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.14, accuracy: 10 });

    await page.goto('/');
    await page.getByLabel(/session name/i).fill('Multi Photo Session');
    await page.getByRole('button', { name: 'Start session' }).click();
    await expect(page.getByRole('button', { name: 'Save observation' })).toBeEnabled({
      timeout: 15_000,
    });

    // Two shots into the compose strip before Save — scoped to the compose
    // field, since a row's own file input can also match this selector once
    // a photo exists elsewhere on the page.
    const composeInput = page.locator('.photo-field input[capture="environment"]');
    await composeInput.setInputFiles({
      name: 'first.png',
      mimeType: 'image/png',
      buffer: PHOTO,
    });
    await expect(page.getByRole('button', { name: 'Remove photo 1 of 1' })).toBeVisible();
    await composeInput.setInputFiles({
      name: 'second.png',
      mimeType: 'image/png',
      buffer: PHOTO,
    });
    await expect(page.getByRole('button', { name: 'Remove photo 2 of 2' })).toBeVisible();

    await page.getByRole('button', { name: 'Save observation' }).click();
    await expect(page.getByText('1 saved')).toBeVisible();

    // Two thumbs land in the row's saved strip on their own — no chip.
    const row = page.locator('li.observations-row').first();
    await expect(row.locator('img.observations-photo-thumb')).toHaveCount(2);

    // Open the first thumb — the pager shows 1 of 2, Previous disabled.
    await row.locator('img.observations-photo-thumb').first().click();
    const dialog = page.getByRole('dialog', { name: /photo/i });
    await expect(dialog).toBeVisible();
    await expect(page.locator('.photo-lightbox-caption')).toContainText('1 of 2');
    await expect(page.getByRole('button', { name: 'Previous photo' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Next photo' })).toBeEnabled();

    await page.getByRole('button', { name: 'Next photo' }).click();
    await expect(page.locator('.photo-lightbox-caption')).toContainText('2 of 2');
    await expect(page.getByRole('button', { name: 'Next photo' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Previous photo' })).toBeEnabled();

    // Retake the second photo — the record repoints and the open view swaps
    // the image (poll the src, as the single-photo test does).
    const secondUrl = await page.locator('.photo-lightbox-image').getAttribute('src');
    await page
      .locator('.photo-lightbox-retake input[capture="environment"]')
      .setInputFiles({ name: 'retake-2.png', mimeType: 'image/png', buffer: PHOTO });
    await expect
      .poll(async () => page.locator('.photo-lightbox-image').getAttribute('src'))
      .not.toBe(secondUrl);

    // Delete the (retaken) second photo — two-step — leaving one, and the
    // caption drops " of " with nothing to page between.
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete photo' }).click();
    await expect(dialog).toBeVisible();
    await expect(page.locator('.photo-lightbox-caption')).not.toContainText('of');
    await expect(page.getByRole('button', { name: 'Next photo' })).toHaveCount(0);

    // Add a photo from inside the open view — back to 2 of 2, landing on the
    // one just added.
    await page
      .locator('.photo-lightbox-add input[capture="environment"]')
      .setInputFiles({ name: 'added.png', mimeType: 'image/png', buffer: PHOTO });
    await expect(page.locator('.photo-lightbox-caption')).toContainText('2 of 2');

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // End the session, export from history, and check the zip carries
    // exactly two photo entries.
    await page.getByRole('button', { name: 'End session' }).click();
    await page.getByRole('button', { name: 'Confirm end session' }).click();
    await page.getByRole('button', { name: 'Session history' }).click();
    await page.getByRole('button', { name: /Multi Photo Session/ }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /^export$/i }).click();
    const download = await downloadPromise;
    const bytes = readFileSync(await download.path());
    const entries = await readZip(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const photoEntries = entries.filter(
      (entry) => entry.name.startsWith('photos/') && entry.name.endsWith('.jpg'),
    );
    expect(photoEntries).toHaveLength(2);

    // Two files in the zip proves the bytes shipped; the feature's photos[]
    // is what a re-import reads them back through, so assert that too — a
    // record whose array disagreed with its own attachments would import as
    // an observation missing a photo.
    const geojson = JSON.parse(
      new TextDecoder().decode(entries.find((entry) => entry.name === 'session.geojson').data),
    );
    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0].properties.photos).toHaveLength(2);
  });
});
