import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/preact';
import { html } from 'htm/preact';
import { ObservationsList } from './ObservationsList.js';

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

describe('ObservationsList', () => {
  test('shows a friendly empty state when there are no observations yet', () => {
    render(html`<${ObservationsList} observations=${[]} />`);
    expect(screen.getByText(/no observations saved yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  test('renders one row per observation with time, position, accuracy and heading', () => {
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO]} />`);

    const [row] = screen.getAllByRole('listitem');
    expect(within(row).getByText(/51\.500000, -0\.140000/)).toBeInTheDocument();
    expect(within(row).getByText(/±8 m/)).toBeInTheDocument();
    expect(within(row).getByText(/247° WSW/)).toBeInTheDocument();
  });

  test('a position-only observation collapses to an em dash rather than leaving a hole', () => {
    // Em-separated rather than a grid: a missing heading reads as "· —" in
    // the flow, not as an empty cell that looks like a rendering fault.
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} />`);

    const [row] = screen.getAllByRole('listitem');
    expect(within(row).getByText(/·\s*—/)).toBeInTheDocument();
  });

  test('the whole note is shown, with nothing hidden behind a tooltip', () => {
    // The old table clipped it to 40 characters and put the rest in a title
    // attribute, which touch has no way to reveal. The card has the room.
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO]} />`);

    const note = screen.getByText(OBS_NO_PHOTO.note);
    expect(note).not.toHaveAttribute('title');
    expect(note).not.toHaveClass('observations-note-clipped');
  });

  test('shows a photo indicator only for observations with a photo', () => {
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO, OBS_WITH_PHOTO]} />`);

    const [rowNoPhoto, rowWithPhoto] = screen.getAllByRole('listitem');
    expect(within(rowNoPhoto).queryByText(/photo/i)).not.toBeInTheDocument();
    expect(within(rowWithPhoto).getByText(/photo/i)).toBeInTheDocument();
  });

  test('calls out a poor fix, which is the one thing worth re-taking on the spot', () => {
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO, OBS_WITH_PHOTO]} />`);

    const [good, poor] = screen.getAllByRole('listitem');
    expect(within(good).queryByText(/accuracy poor/i)).not.toBeInTheDocument();
    expect(within(poor).getByText(/accuracy poor/i)).toBeInTheDocument();
  });

  test('every observation states whether it has been exported', () => {
    // A fresh save has left the device in no way — the badge says so rather
    // than saying nothing.
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO]} />`);

    const [row] = screen.getAllByRole('listitem');
    expect(within(row).getByText(/not exported/i)).toBeInTheDocument();
  });

  test('an exported observation is marked by more than its colour', () => {
    render(html`<${ObservationsList} observations=${[{ ...OBS_NO_PHOTO, exported: true }]} />`);

    const [row] = screen.getAllByRole('listitem');
    expect(within(row).getByText(/^Exported$/)).toBeInTheDocument();
    expect(within(row).queryByText(/not exported/i)).not.toBeInTheDocument();
  });

  test('lists multiple observations in the given order', () => {
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO, OBS_WITH_PHOTO]} />`);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('ObservationsList — grid references', () => {
  const observation = {
    id: 'obs-1',
    fixAt: '2026-08-06T10:00:00.000Z',
    lat: 51.5,
    lon: -0.14,
    gpsAccuracyM: 8,
    headingDeg: null,
    note: '',
    photoId: null,
  };

  test('shows the grid reference on its own line, not buried in the metadata', () => {
    // It is the value a surveyor reads out or pastes into a report. Making it
    // the fourth item on a dot-separated run means hunting for it.
    render(
      html`<${ObservationsList} observations=${[observation]} gridRef=${() => 'SU 14082 39216'} />`,
    );

    const ref = screen.getByText('SU 14082 39216');
    expect(ref).toBeInTheDocument();
    expect(ref).not.toHaveClass('observations-meta');
  });

  test('renders nothing extra when there is no grid reference', () => {
    // Outside Great Britain, or before the shift grid has loaded. An empty
    // row would be a permanent question rather than an occasional absence.
    const { container } = render(
      html`<${ObservationsList} observations=${[observation]} gridRef=${() => null} />`,
    );

    expect(container.querySelector('.observations-gridref')).toBeNull();
  });

  test('works with no gridRef function at all', () => {
    const { container } = render(html`<${ObservationsList} observations=${[observation]} />`);

    expect(container.querySelector('.observations-gridref')).toBeNull();
    expect(screen.getByText(/51\.500000, -0\.140000/)).toBeInTheDocument();
  });
});

describe('ObservationsList — how the position was obtained', () => {
  const base = {
    id: 'obs-1',
    fixAt: '2026-08-06T10:00:00.000Z',
    lat: 51.5,
    lon: -0.14,
    gpsAccuracyM: 12,
    headingDeg: null,
    note: '',
    photoId: null,
  };

  test('says when a point was marked on the map rather than measured', () => {
    // The accuracy figure reads the same either way. Without this line, a
    // point eyeballed from 300 m away is indistinguishable from a fix.
    render(html`<${ObservationsList} observations=${[{ ...base, positionSource: 'map' }]} />`);

    expect(screen.getByText(/marked on the map/i)).toBeInTheDocument();
  });

  test('says nothing extra for an ordinary GPS observation', () => {
    render(html`<${ObservationsList} observations=${[{ ...base, positionSource: 'gps' }]} />`);

    expect(screen.queryByText(/marked on the map/i)).not.toBeInTheDocument();
  });

  test('treats an observation saved before the field existed as a GPS fix', () => {
    render(html`<${ObservationsList} observations=${[base]} />`);

    expect(screen.queryByText(/marked on the map/i)).not.toBeInTheDocument();
  });
});
