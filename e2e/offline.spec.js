import { test, expect } from '@playwright/test';

// Proves the app survives a real network cut, served entirely by the
// service worker's precache — not just that a SW registered (install.spec.js
// already covers that). Chromium only: Playwright's setOffline reaches
// Chromium's service worker target at our pinned version, but not
// WebKit's — confirmed by reading Playwright's own source, not assumed.
test.describe('offline reload', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'setOffline does not propagate to the service worker target on WebKit at this Playwright version',
  );

  test('a reload with the network cut is served by the service worker, not the network', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 15_000,
    });

    await context.setOffline(true);
    // Tripwire: anything the service worker's precache doesn't actually
    // cover falls through to this and fails loudly, instead of `setOffline`
    // alone silently letting a request slip through uncaught.
    await context.route('**/*', (route) => route.abort('internetdisconnected'));

    const response = await page.reload();

    expect(response).not.toBeNull();
    expect(response.fromServiceWorker()).toBe(true);
    await expect(page.getByRole('button', { name: 'Save observation' })).toBeVisible();

    // Pins the happy path, not just the failure path: a real production
    // build must never show the "no offline cache" warning that exists
    // specifically to catch someone mistaking the dev server for this.
    await expect(page.getByText(/no offline cache/i)).not.toBeVisible();
  });
});
