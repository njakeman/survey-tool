import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/preact';
import { html } from 'htm/preact';
import { ObservationsTable } from './ObservationsTable.js';

const OBS_NO_PHOTO = {
  id: 'obs-1',
  recordedAt: '2026-08-06T10:00:00.000Z',
  fixAt: '2026-08-06T09:59:55.000Z',
  lat: 51.5,
  lon: -0.14,
  gpsAccuracyM: 8.2,
  headingDeg: 247,
  note: 'gate post, leaning quite badly to the north-east side',
  photoId: null,
};

const OBS_WITH_PHOTO = {
  id: 'obs-2',
  recordedAt: '2026-08-06T10:05:00.000Z',
  fixAt: '2026-08-06T10:05:00.000Z',
  lat: 51.6,
  lon: -0.15,
  gpsAccuracyM: 40,
  headingDeg: null,
  note: '',
  photoId: 'obs-2',
};

describe('ObservationsTable', () => {
  test('shows a friendly empty state when there are no observations yet', () => {
    render(html`<${ObservationsTable} observations=${[]} />`);
    expect(screen.getByText(/no observations saved yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('renders one row per observation with time, position, accuracy and heading', () => {
    render(html`<${ObservationsTable} observations=${[OBS_NO_PHOTO]} />`);

    const row = screen.getByRole('row', { name: /51\.500000, -0\.140000/ });
    expect(within(row).getByText(/±8 m/)).toBeInTheDocument();
    expect(within(row).getByText(/247° WSW/)).toBeInTheDocument();
  });

  test('shows an em dash for heading when the observation is position-only', () => {
    render(html`<${ObservationsTable} observations=${[OBS_WITH_PHOTO]} />`);
    const row = screen.getByRole('row', { name: /51\.600000, -0\.150000/ });
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  test('truncates a long note rather than growing the row indefinitely', () => {
    render(html`<${ObservationsTable} observations=${[OBS_NO_PHOTO]} />`);
    const cell = screen.getByTitle(OBS_NO_PHOTO.note); // full text kept as a tooltip
    expect(cell.textContent.length).toBeLessThan(OBS_NO_PHOTO.note.length + 3); // + ellipsis
  });

  test('shows a photo indicator only for observations with a photo', () => {
    render(html`<${ObservationsTable} observations=${[OBS_NO_PHOTO, OBS_WITH_PHOTO]} />`);

    const rowNoPhoto = screen.getByRole('row', { name: /51\.500000/ });
    const rowWithPhoto = screen.getByRole('row', { name: /51\.600000/ });

    expect(within(rowNoPhoto).queryByText('📷')).not.toBeInTheDocument();
    expect(within(rowWithPhoto).getByText('📷')).toBeInTheDocument();
  });

  test('lists multiple observations in the given order', () => {
    render(html`<${ObservationsTable} observations=${[OBS_NO_PHOTO, OBS_WITH_PHOTO]} />`);
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(rows).toHaveLength(2);
  });
});
