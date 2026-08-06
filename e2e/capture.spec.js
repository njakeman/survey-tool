import { test, expect } from '@playwright/test';

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
});
