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

  test('an observation edited after its export reads Changed since export, not Exported', () => {
    // The export on someone's laptop no longer matches this record — a third
    // badge state (design pass 4), never a silent "Exported" lie.
    render(
      html`<${ObservationsList}
        observations=${[{ ...OBS_NO_PHOTO, exported: true, changed: true }]}
      />`,
    );

    const [row] = screen.getAllByRole('listitem');
    expect(within(row).getByText(/changed since export/i)).toBeInTheDocument();
    expect(within(row).queryByText(/^Exported$/)).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: /photo/i })).toBeNull();
  });

  test('Show photo fetches the photo once and renders it as a thumbnail', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));

    const img = await screen.findByRole('img', { name: /photo for this observation/i });
    expect(loadPhoto).toHaveBeenCalledWith('obs-2');
    expect(img).toHaveClass('observations-photo-thumb');
    expect(img).toHaveAttribute('src', savedUrls[0]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  test('a photo that cannot be found reads as an inline failure, not a broken image', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(undefined);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));

    await waitFor(() => expect(screen.getByText(/photo could not be loaded/i)).toBeInTheDocument());
  });

  test('a read that rejects lands on the same inline failure', async () => {
    const loadPhoto = vi.fn().mockRejectedValue(new Error('gone'));
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));

    await waitFor(() => expect(screen.getByText(/photo could not be loaded/i)).toBeInTheDocument());
  });

  test('tapping the thumbnail opens a full-screen view of the same object URL', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));
    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));

    const dialog = screen.getByRole('dialog', { name: /photo/i });
    const full = dialog.querySelector('.photo-lightbox-image');
    expect(full).toHaveAttribute('src', savedUrls[0]);
    // One fetch, one URL — the lightbox reuses the thumbnail's decode.
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    // Portalled to the body (design pass 4 §7c): a row-owned fixed overlay
    // is one ancestor filter away from laying out inside its own <li>.
    expect(dialog.closest('li')).toBeNull();
    expect(document.body.contains(dialog)).toBe(true);
  });

  test('the full view captions the record — time and grid reference', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(
      html`<${ObservationsList}
        observations=${[OBS_WITH_PHOTO]}
        loadPhoto=${loadPhoto}
        gridRef=${() => 'TQ 30619 06075'}
      />`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));
    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));

    const dialog = screen.getByRole('dialog', { name: /photo/i });
    expect(dialog.querySelector('.photo-lightbox-caption')).toHaveTextContent('TQ 30619 06075');
  });

  test('Close shuts the full-screen view; the thumbnail stays', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));
    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));
    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('img', { name: /photo for this observation/i })).toBeInTheDocument();
  });

  test('tapping the backdrop also closes the full-screen view', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));
    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));
    fireEvent.click(screen.getByRole('dialog', { name: /photo/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('unmounting after a load revokes the object URL', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    const { unmount } = render(
      html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));
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
    await waitFor(() => expect(container.querySelector('.voice-transport')).not.toBeNull());
    await act(() => {});
    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(savedUrls[0]);
  });
});

describe('ObservationsList — retake, delete and add photo (design pass 4 §7e)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:fake-0');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });

  const photoRecord = { id: 'obs-2', contentType: 'image/jpeg', blob: new Blob(['x']) };
  const FILE = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });

  async function openFullView(extraProps = {}) {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(
      html`<${ObservationsList}
        observations=${[OBS_WITH_PHOTO]}
        loadPhoto=${loadPhoto}
        onSetPhoto=${extraProps.onSetPhoto}
        onDeletePhoto=${extraProps.onDeletePhoto}
      />`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));
    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));
    return screen.getByRole('dialog', { name: /photo/i });
  }

  test('without the callbacks the full view is read-only — no Retake, no Delete', async () => {
    // History passes neither; absence is the read-only flag, as with
    // onEditNote.
    const dialog = await openFullView();

    expect(within(dialog).queryByText(/retake/i)).toBeNull();
    expect(within(dialog).queryByText(/delete/i)).toBeNull();
  });

  test('Retake hands the picked file up and keeps the view open', async () => {
    const onSetPhoto = vi.fn().mockResolvedValue(undefined);
    const dialog = await openFullView({ onSetPhoto, onDeletePhoto: vi.fn() });

    const input = dialog.querySelector('input[capture="environment"]');
    fireEvent.change(input, { target: { files: [FILE] } });

    await waitFor(() => expect(onSetPhoto).toHaveBeenCalledWith('obs-2', FILE));
    // Retaking keeps the view open so the second attempt can be judged.
    expect(screen.getByRole('dialog', { name: /photo/i })).toBeInTheDocument();
  });

  test('Delete is two-step: the confirm replaces the action row, Keep it escapes', async () => {
    const onDeletePhoto = vi.fn();
    const dialog = await openFullView({ onSetPhoto: vi.fn(), onDeletePhoto });

    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    // The commit takes the row; Retake leaves while the confirm is up.
    expect(within(dialog).getByRole('button', { name: /delete photo/i })).toBeInTheDocument();
    expect(within(dialog).queryByText(/retake/i)).toBeNull();
    expect(onDeletePhoto).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: /keep it/i }));

    expect(within(dialog).queryByRole('button', { name: /delete photo/i })).toBeNull();
    expect(within(dialog).getByText(/retake/i)).toBeInTheDocument();
  });

  test('confirming Delete photo hands up and closes the view — nothing left to look at', async () => {
    const onDeletePhoto = vi.fn().mockResolvedValue(undefined);
    const dialog = await openFullView({ onSetPhoto: vi.fn(), onDeletePhoto });

    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /delete photo/i }));

    await waitFor(() => expect(onDeletePhoto).toHaveBeenCalledWith('obs-2'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('a row without a photo offers Add photo — only when onSetPhoto is provided', () => {
    const onSetPhoto = vi.fn();
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO]} onSetPhoto=${onSetPhoto} />`);

    const label = screen.getByText(/add photo/i).closest('label');
    const input = label.querySelector('input[capture="environment"]');
    fireEvent.change(input, { target: { files: [FILE] } });

    expect(onSetPhoto).toHaveBeenCalledWith('obs-1', FILE);
  });

  test('without onSetPhoto an empty photo slot stays empty — history stays read-only', () => {
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO]} />`);

    expect(screen.queryByText(/add photo/i)).toBeNull();
  });

  test('a freshly added photo shows its thumbnail without another tap', async () => {
    // Field report: Add photo used to land the strip back on a chip; the
    // component now survives the refresh and loads the new id itself.
    const loadPhoto = vi
      .fn()
      .mockResolvedValue({ id: 'photo-9', contentType: 'image/jpeg', blob: new Blob(['y']) });
    const onSetPhoto = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      html`<${ObservationsList}
        observations=${[OBS_NO_PHOTO]}
        loadPhoto=${loadPhoto}
        onSetPhoto=${onSetPhoto}
      />`,
    );

    const input = screen
      .getByText(/add photo/i)
      .closest('label')
      .querySelector('input');
    fireEvent.change(input, { target: { files: [FILE] } });
    await waitFor(() => expect(onSetPhoto).toHaveBeenCalledWith('obs-1', FILE));

    // The parent refresh delivers the repointed record.
    rerender(
      html`<${ObservationsList}
        observations=${[{ ...OBS_NO_PHOTO, photoId: 'photo-9' }]}
        loadPhoto=${loadPhoto}
        onSetPhoto=${onSetPhoto}
      />`,
    );

    await screen.findByRole('img', { name: /photo for this observation/i });
    expect(loadPhoto).toHaveBeenCalledWith('photo-9');
  });

  test('the add input clears its value, so the same file can be picked twice', async () => {
    const onSetPhoto = vi.fn().mockResolvedValue(undefined);
    render(
      html`<${ObservationsList}
        observations=${[OBS_NO_PHOTO]}
        loadPhoto=${vi.fn()}
        onSetPhoto=${onSetPhoto}
      />`,
    );

    const input = screen
      .getByText(/add photo/i)
      .closest('label')
      .querySelector('input');
    fireEvent.change(input, { target: { files: [FILE] } });

    await waitFor(() => expect(onSetPhoto).toHaveBeenCalledTimes(1));
    expect(input.value).toBe('');
  });

  test('while the added photo is being processed the label says so and disables', async () => {
    let resolveSet;
    const onSetPhoto = vi.fn(() => new Promise((resolve) => (resolveSet = resolve)));
    render(
      html`<${ObservationsList}
        observations=${[OBS_NO_PHOTO]}
        loadPhoto=${vi.fn()}
        onSetPhoto=${onSetPhoto}
      />`,
    );

    const input = screen
      .getByText(/add photo/i)
      .closest('label')
      .querySelector('input');
    fireEvent.change(input, { target: { files: [FILE] } });

    await screen.findByText(/adding…/i);
    expect(
      screen
        .getByText(/adding…/i)
        .closest('label')
        .querySelector('input'),
    ).toHaveProperty('disabled', true);
    await act(async () => {
      resolveSet();
    });
  });

  test('a repointed photoId (a retake) refetches and revokes the stale URL', async () => {
    const loadPhoto = vi
      .fn()
      .mockResolvedValueOnce(photoRecord)
      .mockResolvedValueOnce({ id: 'photo-2', contentType: 'image/jpeg', blob: new Blob(['y']) });
    const { rerender } = render(
      html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));
    await screen.findByRole('img', { name: /photo for this observation/i });
    await act(() => {});

    rerender(
      html`<${ObservationsList}
        observations=${[{ ...OBS_WITH_PHOTO, photoId: 'photo-2' }]}
        loadPhoto=${loadPhoto}
      />`,
    );

    await waitFor(() => expect(loadPhoto).toHaveBeenCalledWith('photo-2'));
  });
});

describe('ObservationsList — the voice chip (design pass 4 §7a/7b)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:audio-0');
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

  test('the chip reads the stored duration — the thing that decides play now or later', () => {
    render(
      html`<${ObservationsList}
        observations=${[{ ...OBS_WITH_AUDIO, audioDurationMs: 12_400 }]}
        loadAudio=${vi.fn()}
      />`,
    );

    expect(screen.getByRole('button', { name: /voice note.*0:12/i })).toBeInTheDocument();
  });

  test('a legacy note without a stored duration reads Voice note until tapped', () => {
    render(html`<${ObservationsList} observations=${[OBS_WITH_AUDIO]} loadAudio=${vi.fn()} />`);

    expect(screen.getByRole('button', { name: 'Voice note' })).toBeInTheDocument();
  });

  test('tapping the chip loads the note into the shared transport, with no delete control', async () => {
    // 7b: deleting a voice note off a saved observation is a different act
    // from abandoning one mid-compose, and is not offered on a scanned row.
    const loadAudio = vi
      .fn()
      .mockResolvedValue({ id: 'obs-3', contentType: 'audio/mp4', blob: new Blob(['x']) });
    const { container } = render(
      html`<${ObservationsList} observations=${[OBS_WITH_AUDIO]} loadAudio=${loadAudio} />`,
    );

    fireEvent.click(screen.getByRole('button', { name: /voice note/i }));

    await waitFor(() => expect(container.querySelector('.voice-transport')).not.toBeNull());
    expect(screen.queryByRole('button', { name: /delete voice note/i })).toBeNull();
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
