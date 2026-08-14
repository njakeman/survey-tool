import { test, expect } from '@playwright/test';

// The trace walk, end to end against real IndexedDB: start a path, step the
// geolocation through a short walk, finish, save with a note, and find the
// traced observation still there after a reload. Chromium only, like
// capture.spec.js — this proves wiring, not iOS.
test.describe('trace flow', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'proves wiring, not iOS — real sensor/permission behaviour is checked on-device',
  );

  test('walk a path trace, save it, and it survives a reload', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.14, accuracy: 5 });

    await page.goto('/');

    await page.getByLabel(/session name/i).fill('E2E Trace Session');
    await page.getByRole('button', { name: 'Start session' }).click();

    // Path stands as its own control now — no chooser, one tap deep
    // (design pass 3 §5d). Its accessible name includes the caption.
    await expect(page.getByRole('button', { name: /^Path/ })).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /^Path/ }).click();

    // The first fix is accepted as vertex zero as soon as recording starts.
    await expect(page.getByText(/Tracing path/)).toBeVisible();
    await expect(page.getByText(/1 point\b/)).toBeVisible();

    // Walk ~22 m north twice — each step clears max(MIN_SPACING_M, accuracy).
    await context.setGeolocation({ latitude: 51.5002, longitude: -0.14, accuracy: 5 });
    await expect(page.getByText(/2 points/)).toBeVisible();
    await context.setGeolocation({ latitude: 51.5004, longitude: -0.14, accuracy: 5 });
    await expect(page.getByText(/3 points/)).toBeVisible();

    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByText(/save to keep it/i)).toBeVisible();

    await page.getByLabel(/note/i).fill('e2e hedgerow');
    await page.getByRole('button', { name: 'Save observation' }).click();

    await expect(page.getByText(/Traced path/)).toBeVisible();
    await expect(page.getByText('e2e hedgerow')).toBeVisible();

    await page.reload();

    await expect(page.getByText('E2E Trace Session')).toBeVisible();
    await expect(page.getByText(/Traced path/)).toBeVisible();
    await expect(page.getByText('e2e hedgerow')).toBeVisible();
  });
});
