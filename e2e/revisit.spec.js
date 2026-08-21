import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { buildZip } from '../src/import/fixtures/buildZip.js';
import { readZip } from '../src/import/zipReader.js';

// The revisit flow end to end against the built app and real IndexedDB:
// load a reference zip before the session opens, follow the guidance,
// save a paired observation, skip a station, see the summary at the End
// confirm, and prove the export carries survey_revisit and the pairing
// key. Proves wiring, not iOS — the on-device pass is the gate.
test.describe('revisit flow', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'proves wiring; the parsers run in both engines in the browser tier',
  );

  const referenceGeojson = JSON.stringify({
    type: 'FeatureCollection',
    survey_session: {
      id: 'ref-sess-1',
      name: 'Long Barrow south',
      started_at: '2025-04-12T09:00:00.000Z',
      ended_at: '2025-04-12T12:00:00.000Z',
    },
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-0.14, 51.5002] },
        properties: {
          obs_id: 'ref-1',
          recorded_at: '2025-04-12T10:00:00.000Z',
          fix_at: '2025-04-12T10:00:00.000Z',
          lat: 51.5002, // ~22 m north of the mocked fix
          lon: -0.14,
          gps_accuracy_m: 4.1,
          heading_deg: 38,
          note: 'West stile, west boundary.',
          photo: null,
        },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-0.14, 51.51] },
        properties: {
          obs_id: 'ref-2',
          recorded_at: '2025-04-12T10:30:00.000Z',
          fix_at: '2025-04-12T10:30:00.000Z',
          lat: 51.51,
          lon: -0.14,
          gps_accuracy_m: 6.3,
          note: 'Culvert head.',
          photo: null,
        },
      },
    ],
  });

  test('reference in, guidance, pairing, skip, summary, provenance out', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.14, accuracy: 5 });
    await page.goto('/');

    // The session type is chosen at start; the zip loads before the session
    // opens — a revisit can never start without a reference.
    await page.getByRole('button', { name: /revisit a survey/i }).click();
    await expect(page.getByRole('button', { name: 'Start revisit session' })).toBeDisabled();

    await page.locator('.revisit-setup input[type="file"]').setInputFiles({
      name: 'long-barrow-2025-04-12.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(
        new Uint8Array(buildZip([{ name: 'session.geojson', data: referenceGeojson }])),
      ),
    });

    await expect(page.getByText('long-barrow-2025-04-12.zip')).toBeVisible();
    await expect(page.getByText(/2 stations · 0 photos · 12 Apr 2025/)).toBeVisible();
    await expect(page.getByText('Nearest stations')).toBeVisible({ timeout: 15_000 });

    await page.getByLabel(/session name/i).fill('E2E Revisit');
    await page.getByRole('button', { name: 'Start revisit session' }).click();

    // The nearest to-do station is the target; the reference note guides.
    await expect(page.getByText('Station 1 of 2')).toBeVisible();
    await expect(page.getByText('West stile, west boundary.')).toBeVisible();
    await expect(page.getByText('Revisit', { exact: true })).toBeVisible();

    // Save pairs to the station; the guidance advances.
    await page.getByLabel(/note/i).fill('still standing');
    await page.getByRole('button', { name: 'Save observation' }).click();
    await expect(page.getByText('1 of 2 stations')).toBeVisible();
    await expect(page.getByText('Station 2 of 2')).toBeVisible();

    // Skip is cheap: no confirm, an after-the-fact line with an Undo.
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByText(/skipped\. It stays in the list and in the count\./)).toBeVisible();

    // The End confirm is where the four outcomes appear together.
    await page.getByRole('button', { name: 'End session' }).click();
    await expect(page.getByText(/of 2 revisited/)).toBeVisible();
    await expect(page.getByText(/0 no access · 1 skipped · 0 new observations/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm end session' }).click();

    // Export from history; the zip carries the provenance and the pairing.
    await page.getByRole('button', { name: 'Session history' }).click();
    await page.getByRole('button', { name: /E2E Revisit/ }).click();
    await expect(page.getByText(/Revisit of Long Barrow south · 12 Apr 2025/)).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /^export$/i }).click();
    const download = await downloadPromise;
    const bytes = readFileSync(await download.path());
    const entries = await readZip(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const geojson = JSON.parse(
      new TextDecoder().decode(entries.find((entry) => entry.name === 'session.geojson').data),
    );

    expect(geojson.survey_revisit.reference_file).toBe('long-barrow-2025-04-12.zip');
    expect(geojson.survey_revisit.reference_session_name).toBe('Long Barrow south');
    expect(geojson.survey_revisit.reference_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(geojson.survey_revisit.stations).toEqual([
      { ref_obs_id: 'ref-1', state: 'done', reason: null },
      { ref_obs_id: 'ref-2', state: 'skipped', reason: null },
    ]);
    expect(geojson.features[0].properties.ref_obs_id).toBe('ref-1');
  });
});
