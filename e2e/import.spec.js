import { test, expect } from '@playwright/test';

// The import flow against the real built app: pick a file, see the summary,
// see the session appear. A bare session.geojson is used here because the
// zip-bytes round trip (real client-zip output through the app's own reader)
// is already proven in the browser tier — this covers the UI wiring no unit
// test touches: the file input, IndexedDB writes, and the list refresh.
test.describe('import session', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'proves wiring; the reader itself runs in both engines in the browser tier',
  );

  const GEOJSON = JSON.stringify({
    type: 'FeatureCollection',
    survey_session: {
      id: 'orig-1',
      name: 'Imported walkover',
      started_at: '2026-08-06T09:00:00.000Z',
      ended_at: '2026-08-06T11:00:00.000Z',
    },
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-0.14, 51.5] },
        properties: {
          obs_id: 'o1',
          recorded_at: '2026-08-06T10:00:00.000Z',
          fix_at: '2026-08-06T09:59:20.000Z',
          lat: 51.5,
          lon: -0.14,
          gps_accuracy_m: 8.2,
          note: 'gate post',
          session_name: 'Imported walkover',
        },
      },
    ],
  });

  test('imports a session.geojson and lists the new session', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Session history' }).click();

    await expect(page.getByText('No past sessions yet')).toBeVisible();

    // CapturePage stays mounted behind this view with its own (photo) file
    // input, so match on the accept list rather than the bare type.
    await page.locator('input[accept*=".zip"]').setInputFiles({
      name: 'imported-walkover-2026-08-06.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(GEOJSON),
    });

    await expect(page.getByText(/Imported 'Imported walkover' — 1 observations/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Imported walkover/ })).toBeVisible();
    await expect(page.getByText(/1 saved/)).toBeVisible();

    // The copy survives a reload — it is really in IndexedDB, not view state.
    await page.reload();
    await page.getByRole('button', { name: 'Session history' }).click();
    await expect(page.getByRole('button', { name: /Imported walkover/ })).toBeVisible();
  });
});
