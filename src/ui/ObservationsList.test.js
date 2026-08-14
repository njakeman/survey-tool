import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/preact';
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

describe('ObservationsList - traced observations', () => {
  const TRACED_PATH = {
    id: 'obs-t',
    recordedAt: '2026-08-06T10:10:00.000Z',
    fixAt: '2026-08-06T09:40:00.000Z',
    lat: 51.5005,
    lon: -0.14,
    gpsAccuracyM: 12,
    headingDeg: null,
    note: 'north hedgerow',
    photoId: null,
    positionSource: 'trace',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-0.14, 51.5],
        [-0.14, 51.501],
      ],
    },
  };

  test('a traced path says so, with its walked length', () => {
    render(html`<${ObservationsList} observations=${[TRACED_PATH]} />`);

    // ~111 m of northing.
    expect(screen.getByText(/Traced path · 111 m/)).toBeInTheDocument();
  });

  test('the traced line is the identity of the row: glyph-led, directly under the head', () => {
    // It says what the record IS — everything below it describes that thing —
    // so it sits above the grid reference and metadata, not among the
    // caveats at the bottom (design pass 2d).
    render(html`<${ObservationsList} observations=${[TRACED_PATH]} />`);

    const traced = screen.getByText(/Traced path · 111 m/).closest('.observations-traced');
    expect(traced.querySelector('svg.trace-glyph')).not.toBeNull();
    expect(traced.previousElementSibling.className).toContain('observations-row-head');
  });

  test('a traced boundary reports its perimeter', () => {
    const ring = [
      [-0.14, 51.5],
      [-0.1386, 51.5],
      [-0.1386, 51.501],
      [-0.14, 51.501],
      [-0.14, 51.5],
    ];
    render(
      html`<${ObservationsList}
        observations=${[{ ...TRACED_PATH, geometry: { type: 'Polygon', coordinates: [ring] } }]}
      />`,
    );

    expect(screen.getByText(/Traced boundary · \d+ m/)).toBeInTheDocument();
  });

  test('a point observation carries no traced line', () => {
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO]} />`);

    expect(screen.queryByText(/Traced/)).toBeNull();
  });
});

describe('ObservationsList — viewing a photo', () => {
  const savedUrls = [];
  beforeEach(() => {
    savedUrls.length = 0;
    // happy-dom's object-URL support is inert; the component's contract with
    // the browser is create-once, revoke-on-unmount, which is what we assert.
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:fake-${savedUrls.length}`;
      savedUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });

  const photoRecord = { id: 'obs-2', contentType: 'image/jpeg', blob: new Blob(['x']) };

  test('without loadPhoto the row keeps the plain indicator and offers no button', () => {
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} />`);

    expect(screen.getByText(/photo/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show photo/i })).toBeNull();
  });

  test('Show photo fetches the photo once and renders it as a thumbnail', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(screen.getByRole('button', { name: /show photo/i }));

    const img = await screen.findByRole('img', { name: /photo for this observation/i });
    expect(loadPhoto).toHaveBeenCalledWith('obs-2');
    expect(img).toHaveClass('observations-photo-thumb');
    expect(img).toHaveAttribute('src', savedUrls[0]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  test('a photo that cannot be found reads as an inline failure, not a broken image', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(undefined);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(screen.getByRole('button', { name: /show photo/i }));

    await waitFor(() => expect(screen.getByText(/photo could not be loaded/i)).toBeInTheDocument());
  });

  test('a read that rejects lands on the same inline failure', async () => {
    const loadPhoto = vi.fn().mockRejectedValue(new Error('gone'));
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(screen.getByRole('button', { name: /show photo/i }));

    await waitFor(() => expect(screen.getByText(/photo could not be loaded/i)).toBeInTheDocument());
  });

  test('tapping the thumbnail opens a full-screen view of the same object URL', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(screen.getByRole('button', { name: /show photo/i }));
    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));

    const dialog = screen.getByRole('dialog', { name: /photo/i });
    const full = dialog.querySelector('.photo-lightbox-image');
    expect(full).toHaveAttribute('src', savedUrls[0]);
    // One fetch, one URL — the lightbox reuses the thumbnail's decode.
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  test('Close shuts the full-screen view; the thumbnail stays', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(screen.getByRole('button', { name: /show photo/i }));
    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));
    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('img', { name: /photo for this observation/i })).toBeInTheDocument();
  });

  test('tapping the backdrop also closes the full-screen view', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(screen.getByRole('button', { name: /show photo/i }));
    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));
    fireEvent.click(screen.getByRole('dialog', { name: /photo/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('unmounting after a load revokes the object URL', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    const { unmount } = render(
      html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`,
    );

    fireEvent.click(screen.getByRole('button', { name: /show photo/i }));
    await screen.findByRole('img', { name: /photo for this observation/i });
    // Flush the url effect so its cleanup is registered before unmount —
    // Preact schedules effects asynchronously.
    await act(() => {});
    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(savedUrls[0]);
  });
});

describe('ObservationsList — voice-note lifecycle', () => {
  const savedUrls = [];
  beforeEach(() => {
    savedUrls.length = 0;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:audio-${savedUrls.length}`;
      savedUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });

  const OBS_WITH_AUDIO = {
    id: 'obs-3',
    fixAt: '2026-08-06T10:00:00.000Z',
    lat: 51.5,
    lon: -0.14,
    gpsAccuracyM: 8,
    headingDeg: null,
    note: '',
    photoId: null,
    audioId: 'obs-3',
  };

  test('unmounting after a voice note is loaded revokes its object URL', async () => {
    // The same pending-effect race SavedPhoto's test exposed: a [url]-keyed
    // revoke effect registered after the async load may never have run by
    // unmount, and a pending effect's cleanup never fires.
    const loadAudio = vi
      .fn()
      .mockResolvedValue({ id: 'obs-3', contentType: 'audio/mp4', blob: new Blob(['x']) });
    const { unmount, container } = render(
      html`<${ObservationsList} observations=${[OBS_WITH_AUDIO]} loadAudio=${loadAudio} />`,
    );

    fireEvent.click(screen.getByRole('button', { name: /voice note/i }));
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull());
    await act(() => {});
    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(savedUrls[0]);
  });
});

describe('ObservationsList — editing a note', () => {
  test('offers no edit affordance without onEditNote — history stays read-only', () => {
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO, OBS_WITH_PHOTO]} />`);

    expect(screen.queryByRole('button', { name: /edit note/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add note/i })).toBeNull();
  });

  test('Edit note opens the row note in a field, and Save note hands the text back', async () => {
    const onEditNote = vi.fn().mockResolvedValue(undefined);
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO]} onEditNote=${onEditNote} />`);

    fireEvent.click(screen.getByRole('button', { name: /edit note/i }));
    const field = screen.getByLabelText(/note/i);
    expect(field).toHaveValue(OBS_NO_PHOTO.note);

    fireEvent.input(field, { target: { value: 'hinge broken' } });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() => expect(onEditNote).toHaveBeenCalledWith('obs-1', 'hinge broken'));
    // The editor closes; the (parent-refreshed) read view returns.
    await waitFor(() => expect(screen.queryByRole('button', { name: /save note/i })).toBeNull());
  });

  test('a row with no note offers Add note instead', () => {
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} onEditNote=${() => {}} />`);

    expect(screen.getByRole('button', { name: /add note/i })).toBeInTheDocument();
  });

  test('Cancel closes the editor without handing anything back', () => {
    const onEditNote = vi.fn();
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO]} onEditNote=${onEditNote} />`);

    fireEvent.click(screen.getByRole('button', { name: /edit note/i }));
    fireEvent.input(screen.getByLabelText(/note/i), { target: { value: 'discarded change' } });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onEditNote).not.toHaveBeenCalled();
    expect(screen.getByText(OBS_NO_PHOTO.note)).toBeInTheDocument();
    expect(screen.queryByLabelText(/note/i)).toBeNull();
  });

  test('a failed save shows the error inline and keeps the editor open for retry', async () => {
    const onEditNote = vi.fn().mockRejectedValue(new Error('write failed'));
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO]} onEditNote=${onEditNote} />`);

    fireEvent.click(screen.getByRole('button', { name: /edit note/i }));
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/write failed/));
    expect(screen.getByRole('button', { name: /save note/i })).toBeInTheDocument();
  });
});
