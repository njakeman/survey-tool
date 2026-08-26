import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildZip } from '../src/import/fixtures/buildZip.js';
import { readZip } from '../src/import/zipReader.js';

const PHOTO = readFileSync(fileURLToPath(new URL('./fixtures/test-photo.png', import.meta.url)));

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
          photos: [],
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
          photos: [],
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

  test('a station with two reference photos is framed one at a time, each shot paired', async ({
    page,
    context,
  }) => {
    // The same reference with two photos at the first station, both backed
    // by an entry in the zip.
    const parsed = JSON.parse(referenceGeojson);
    parsed.features[0].properties.photo = 'a.jpg';
    parsed.features[0].properties.photos = [
      { photo: 'a.jpg', ref_photo: null },
      { photo: 'b.jpg', ref_photo: null },
    ];

    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.14, accuracy: 5 });
    await page.goto('/');

    await page.getByRole('button', { name: /revisit a survey/i }).click();
    await page.locator('.revisit-setup input[type="file"]').setInputFiles({
      name: 'long-barrow-2025-04-12.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(
        new Uint8Array(
          buildZip([
            { name: 'session.geojson', data: JSON.stringify(parsed) },
            { name: 'photos/a.jpg', data: new Uint8Array(PHOTO) },
            { name: 'photos/b.jpg', data: new Uint8Array(PHOTO) },
          ]),
        ),
      ),
    });
    await expect(page.getByText(/2 stations · 2 photos · 12 Apr 2025/)).toBeVisible();
    await expect(page.getByText('Nearest stations')).toBeVisible({ timeout: 15_000 });
    await page.getByLabel(/session name/i).fill('E2E Two Refs');
    await page.getByRole('button', { name: 'Start revisit session' }).click();
    await expect(page.getByText('Station 1 of 2')).toBeVisible();

    // The button says there are several; the step opens on the first and
    // pages to the second.
    await page.getByRole('button', { name: 'Frame the photos' }).click();
    const label = page.locator('.framing-screen-label');
    await expect(label).toHaveText(/^Reference 1 of 2/);
    await expect(page.locator('.framing-screen-photo')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous reference' })).toBeDisabled();
    await page.getByRole('button', { name: 'Next reference' }).click();
    await expect(label).toHaveText(/^Reference 2 of 2/);
    await expect(page.getByRole('button', { name: 'Next reference' })).toBeDisabled();

    // A shot on the second: the step stays open, wrapped round to the first,
    // which is still to do.
    const shutter = page.locator('.framing-screen input[type="file"]');
    await shutter.setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: PHOTO });
    await expect(label).toHaveText(/^Reference 1 of 2/);
    await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();

    // The last one closes the step; both shots sit in the compose strip.
    await shutter.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: PHOTO });
    await expect(page.locator('.framing-screen')).toHaveCount(0);
    await expect(page.getByRole('img', { name: /^Photo \d of 2$/ })).toHaveCount(2);

    await page.getByRole('button', { name: 'Save observation' }).click();
    await expect(page.getByText('1 of 2 stations')).toBeVisible();

    await page.getByRole('button', { name: 'End session' }).click();
    await page.getByRole('button', { name: 'Confirm end session' }).click();
    await page.getByRole('button', { name: 'Session history' }).click();
    await page.getByRole('button', { name: /E2E Two Refs/ }).click();

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

    // Shot order, each paired to the reference it framed — b first.
    expect(geojson.features[0].properties.ref_obs_id).toBe('ref-1');
    expect(geojson.features[0].properties.photos.map((entry) => entry.ref_photo)).toEqual([
      'b.jpg',
      'a.jpg',
    ]);
    expect(
      entries.filter((entry) => entry.name.startsWith('photos/') && entry.name.endsWith('.jpg')),
    ).toHaveLength(2);
  });
});
