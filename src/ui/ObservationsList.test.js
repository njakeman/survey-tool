import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/preact';
import { html } from 'htm/preact';
import { ObservationsList } from './ObservationsList.js';
import { MAX_PHOTOS } from '../photo/dimensions.js';

const OBS_NO_PHOTO = {
  id: 'obs-1',
  recordedAt: '2026-08-06T10:00:00.000Z',
  fixAt: '2026-08-06T09:59:55.000Z',
  lat: 51.5,
  lon: -0.14,
  gpsAccuracyM: 8.2,
  headingDeg: 247,
  note: 'gate post, leaning quite badly to the north-east side',
  photos: [],
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
  photos: [{ id: 'obs-2', referencePhoto: null }],
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
    photos: [],
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
    photos: [],
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
    photos: [],
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
    // happy-dom defines IntersectionObserver but never fires it, so a thumb
    // left to the real one would stay pending for ever. These rows are about
    // what happens once the bytes arrive: take the no-observer path, where
    // the strip fetches every thumb at once.
    vi.stubGlobal('IntersectionObserver', undefined);
  });
  afterEach(() => {
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
    vi.unstubAllGlobals();
  });

  const photoRecord = { id: 'obs-2', contentType: 'image/jpeg', blob: new Blob(['x']) };

  test('without loadPhoto the row keeps the plain indicator and offers no button', () => {
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} />`);

    expect(screen.getByText(/photo/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /photo/i })).toBeNull();
  });

  test('a visible thumb fetches the photo once and renders it', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    const img = await screen.findByRole('img', { name: /photo for this observation/i });
    expect(loadPhoto).toHaveBeenCalledWith('obs-2');
    expect(loadPhoto).toHaveBeenCalledTimes(1);
    expect(img).toHaveClass('observations-photo-thumb');
    expect(img).toHaveAttribute('src', savedUrls[0]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  test('a photo that cannot be found reads as an inline failure, not a broken image', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(undefined);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    await waitFor(() => expect(screen.getByText(/photo could not be loaded/i)).toBeInTheDocument());
  });

  test('a read that rejects lands on the same inline failure', async () => {
    const loadPhoto = vi.fn().mockRejectedValue(new Error('gone'));
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    await waitFor(() => expect(screen.getByText(/photo could not be loaded/i)).toBeInTheDocument());
  });

  test('tapping the thumbnail opens a full-screen view of the same object URL', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

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

    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));

    const dialog = screen.getByRole('dialog', { name: /photo/i });
    expect(dialog.querySelector('.photo-lightbox-caption')).toHaveTextContent('TQ 30619 06075');
  });

  test('Close shuts the full-screen view; the thumbnail stays', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));
    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('img', { name: /photo for this observation/i })).toBeInTheDocument();
  });

  test('tapping the backdrop also closes the full-screen view', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    render(html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`);

    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));
    fireEvent.click(screen.getByRole('dialog', { name: /photo/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('unmounting after a load revokes the object URL', async () => {
    const loadPhoto = vi.fn().mockResolvedValue(photoRecord);
    const { unmount } = render(
      html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`,
    );

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
    photos: [],
    audioId: 'obs-3',
  };

  test('unmounting after a voice note is loaded revokes its object URL', async () => {
    // The same pending-effect race SavedPhotos' test exposed: a [url]-keyed
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
    // The no-observer path: every thumb fetches at once, so these rows are
    // about the writers, not about when the bytes arrive.
    vi.stubGlobal('IntersectionObserver', undefined);
  });
  afterEach(() => {
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
    vi.unstubAllGlobals();
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

    await waitFor(() => expect(onSetPhoto).toHaveBeenCalledWith('obs-2', 'obs-2', FILE));
    // Retaking keeps the view open so the second attempt can be judged.
    expect(screen.getByRole('dialog', { name: /photo/i })).toBeInTheDocument();
  });

  test('a rejecting onSetPhoto on retake resets busy and does not throw out of the handler', async () => {
    // The parent (CapturePage) surfaces the failure on its own error line;
    // this handler's job is just to not leave the row stuck on "Retaking…"
    // and to not turn the rejection into an unhandled one.
    const onSetPhoto = vi.fn().mockRejectedValue(new Error('no room on the device'));
    const dialog = await openFullView({ onSetPhoto, onDeletePhoto: vi.fn() });

    const input = dialog.querySelector('input[capture="environment"]');
    fireEvent.change(input, { target: { files: [FILE] } });

    await waitFor(() => expect(onSetPhoto).toHaveBeenCalledWith('obs-2', 'obs-2', FILE));
    await waitFor(() => expect(within(dialog).getByText(/^retake$/i)).toBeInTheDocument());
    expect(input).not.toBeDisabled();
  });

  test('the view survives the repointed id and shows the retaken photo in place', async () => {
    // The parent refresh swaps a fresh photo id into photos[], so the shown
    // photo is momentarily one with no bytes yet. Closing the view there
    // would take the surveyor back to the strip mid-judgement.
    const loadPhoto = vi.fn(async (id) => ({
      id,
      contentType: 'image/jpeg',
      blob: new Blob([id]),
    }));
    const onSetPhoto = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      html`<${ObservationsList}
        observations=${[OBS_WITH_PHOTO]}
        loadPhoto=${loadPhoto}
        onSetPhoto=${onSetPhoto}
        onDeletePhoto=${vi.fn()}
      />`,
    );
    fireEvent.click(await screen.findByRole('img', { name: /photo for this observation/i }));
    const input = screen
      .getByRole('dialog', { name: /photo/i })
      .querySelector('input[capture="environment"]');
    fireEvent.change(input, { target: { files: [FILE] } });
    await waitFor(() => expect(onSetPhoto).toHaveBeenCalledWith('obs-2', 'obs-2', FILE));

    rerender(
      html`<${ObservationsList}
        observations=${[{ ...OBS_WITH_PHOTO, photos: [{ id: 'photo-2', referencePhoto: null }] }]}
        loadPhoto=${loadPhoto}
        onSetPhoto=${onSetPhoto}
        onDeletePhoto=${vi.fn()}
      />`,
    );

    expect(screen.getByRole('dialog', { name: /photo/i })).toBeInTheDocument();
    await waitFor(() => expect(loadPhoto).toHaveBeenCalledWith('photo-2'));
    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: /photo/i }).querySelector('img.photo-lightbox-image'),
      ).not.toBeNull(),
    );
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

    await waitFor(() => expect(onDeletePhoto).toHaveBeenCalledWith('obs-2', 'obs-2'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('a row without a photo offers Add photo — only when onSetPhoto is provided', () => {
    const onSetPhoto = vi.fn();
    render(html`<${ObservationsList} observations=${[OBS_NO_PHOTO]} onSetPhoto=${onSetPhoto} />`);

    const label = screen.getByText(/add photo/i).closest('label');
    const input = label.querySelector('input[capture="environment"]');
    fireEvent.change(input, { target: { files: [FILE] } });

    expect(onSetPhoto).toHaveBeenCalledWith('obs-1', null, FILE);
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
    await waitFor(() => expect(onSetPhoto).toHaveBeenCalledWith('obs-1', null, FILE));

    // The parent refresh delivers the repointed record.
    rerender(
      html`<${ObservationsList}
        observations=${[{ ...OBS_NO_PHOTO, photos: [{ id: 'photo-9', referencePhoto: null }] }]}
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

  test('a repointed photos[0].id (a retake) refetches and revokes the stale URL', async () => {
    const loadPhoto = vi
      .fn()
      .mockResolvedValueOnce(photoRecord)
      .mockResolvedValueOnce({ id: 'photo-2', contentType: 'image/jpeg', blob: new Blob(['y']) });
    const { rerender } = render(
      html`<${ObservationsList} observations=${[OBS_WITH_PHOTO]} loadPhoto=${loadPhoto} />`,
    );
    await screen.findByRole('img', { name: /photo for this observation/i });
    await act(() => {});

    rerender(
      html`<${ObservationsList}
        observations=${[{ ...OBS_WITH_PHOTO, photos: [{ id: 'photo-2', referencePhoto: null }] }]}
        loadPhoto=${loadPhoto}
      />`,
    );

    await waitFor(() => expect(loadPhoto).toHaveBeenCalledWith('photo-2'));
  });
});

describe('ObservationsList — the saved photo strip', () => {
  const savedUrls = [];
  beforeEach(() => {
    savedUrls.length = 0;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:strip-${savedUrls.length}`;
      savedUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
    vi.unstubAllGlobals();
  });

  // happy-dom ships an IntersectionObserver that never fires, so a test that
  // relies on the default would hang on the pending box. Every test here
  // states which path it is exercising: no observer at all (fetch every
  // thumb at once) or this fake, whose callbacks the test fires by hand.
  const observed = [];
  class FakeIO {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.disconnected = false;
    }
    observe(element) {
      observed.push({ callback: this.callback, element, options: this.options, observer: this });
    }
    unobserve() {}
    disconnect() {
      this.disconnected = true;
    }
  }

  function useFakeObserver() {
    observed.length = 0;
    vi.stubGlobal('IntersectionObserver', FakeIO);
  }

  function useNoObserver() {
    vi.stubGlobal('IntersectionObserver', undefined);
  }

  async function scrollIntoView(entry) {
    await act(async () => {
      entry.callback([{ isIntersecting: true, target: entry.element }], entry.observer);
    });
  }

  function withPhotos(ids) {
    return { ...OBS_WITH_PHOTO, photos: ids.map((id) => ({ id, referencePhoto: null })) };
  }

  const record = (id) => ({ id, contentType: 'image/jpeg', blob: new Blob([id]) });

  test('every photo gets its own thumb, keyed and numbered in its alt text', async () => {
    useNoObserver();
    const loadPhoto = vi.fn(async (id) => record(id));
    const { container } = render(
      html`<${ObservationsList}
        observations=${[withPhotos(['p-1', 'p-2', 'p-3'])]}
        loadPhoto=${loadPhoto}
      />`,
    );

    await waitFor(() =>
      expect(container.querySelectorAll('img.observations-photo-thumb')).toHaveLength(3),
    );
    expect(screen.getByAltText('Photo for this observation (1 of 3)')).toBeInTheDocument();
    expect(screen.getByAltText('Photo for this observation (2 of 3)')).toBeInTheDocument();
    expect(screen.getByAltText('Photo for this observation (3 of 3)')).toBeInTheDocument();
    expect(container.querySelectorAll('li.attachment-strip-photo')).toHaveLength(3);
    expect(container.querySelector('.attachment-strip-photos')).toHaveClass(
      'attachment-strip-multi',
    );
    expect(loadPhoto.mock.calls.map(([id]) => id)).toEqual(['p-1', 'p-2', 'p-3']);
  });

  test('a single photo keeps the unnumbered alt — one of one is not worth saying', async () => {
    useNoObserver();
    const loadPhoto = vi.fn(async (id) => record(id));
    const { container } = render(
      html`<${ObservationsList} observations=${[withPhotos(['p-1'])]} loadPhoto=${loadPhoto} />`,
    );

    expect(await screen.findByAltText('Photo for this observation')).toBeInTheDocument();
    expect(container.querySelector('.attachment-strip-photos')).not.toHaveClass(
      'attachment-strip-multi',
    );
  });

  test('a thumb below the fold holds a dashed pending box and fetches nothing', () => {
    // Viewport-lazy, not tap-lazy: a session can hold dozens of ~200 KB
    // JPEGs and an installed iOS PWA has little memory headroom for decoding
    // rows nobody is looking at.
    useFakeObserver();
    const loadPhoto = vi.fn(async (id) => record(id));
    const { container } = render(
      html`<${ObservationsList}
        observations=${[withPhotos(['p-1', 'p-2'])]}
        loadPhoto=${loadPhoto}
      />`,
    );

    expect(loadPhoto).not.toHaveBeenCalled();
    const pending = container.querySelectorAll('.observations-photo-thumb-pending');
    expect(pending).toHaveLength(2);
    expect(pending[0]).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('img')).toBeNull();
    expect(observed).toHaveLength(2);
    expect(observed[0].options).toMatchObject({ rootMargin: '200px' });
  });

  test('scrolling one thumb into view fetches that photo alone', async () => {
    useFakeObserver();
    const loadPhoto = vi.fn(async (id) => record(id));
    render(
      html`<${ObservationsList}
        observations=${[withPhotos(['p-1', 'p-2'])]}
        loadPhoto=${loadPhoto}
      />`,
    );

    await scrollIntoView(observed[1]);

    await waitFor(() => expect(loadPhoto).toHaveBeenCalledWith('p-2'));
    expect(loadPhoto).toHaveBeenCalledTimes(1);
    // Once its bytes are in, the thumb stops watching the viewport.
    expect(observed[1].observer.disconnected).toBe(true);
  });

  test('unmounting revokes every object URL the strip made', async () => {
    useNoObserver();
    const loadPhoto = vi.fn(async (id) => record(id));
    const { unmount, container } = render(
      html`<${ObservationsList}
        observations=${[withPhotos(['p-1', 'p-2', 'p-3'])]}
        loadPhoto=${loadPhoto}
      />`,
    );

    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(3));
    await act(() => {});
    unmount();

    expect(savedUrls).toHaveLength(3);
    for (const url of savedUrls) expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  test('a retake repoints one id: only the new photo is fetched, the stale URL revoked', async () => {
    useNoObserver();
    const loadPhoto = vi.fn(async (id) => record(id));
    const { rerender, container } = render(
      html`<${ObservationsList}
        observations=${[withPhotos(['p-1', 'p-2', 'p-3'])]}
        loadPhoto=${loadPhoto}
      />`,
    );
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(3));
    await act(() => {});

    rerender(
      html`<${ObservationsList}
        observations=${[withPhotos(['p-1', 'photo-x', 'p-3'])]}
        loadPhoto=${loadPhoto}
      />`,
    );

    await waitFor(() => expect(loadPhoto).toHaveBeenCalledWith('photo-x'));
    expect(loadPhoto.mock.calls.map(([id]) => id)).toEqual(['p-1', 'p-2', 'p-3', 'photo-x']);
    // Exactly one URL is dropped — the replaced photo's; its siblings keep
    // the decode they already have.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  test('a read landing after its id was replaced revokes rather than keeps its URL', async () => {
    // The reconcile effect has already run by the time these bytes arrive,
    // so nothing else would ever revoke this one.
    useNoObserver();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const loadPhoto = vi.fn(async (id) => {
      if (id === 'p-1') await gate;
      return record(id);
    });
    const { rerender } = render(
      html`<${ObservationsList} observations=${[withPhotos(['p-1'])]} loadPhoto=${loadPhoto} />`,
    );

    // The retake lands while p-1's read is still in flight.
    rerender(
      html`<${ObservationsList}
        observations=${[withPhotos(['photo-x'])]}
        loadPhoto=${loadPhoto}
      />`,
    );
    await waitFor(() => expect(loadPhoto).toHaveBeenCalledWith('photo-x'));
    await act(async () => {
      release();
    });

    const kept = (await screen.findByRole('img')).getAttribute('src');
    const stale = savedUrls.filter((url) => url !== kept);
    expect(stale).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(stale[0]);
  });

  test('one unreadable record fails in its own slot; its siblings still render', async () => {
    useNoObserver();
    const loadPhoto = vi.fn(async (id) => (id === 'p-2' ? undefined : record(id)));
    const { container } = render(
      html`<${ObservationsList}
        observations=${[withPhotos(['p-1', 'p-2', 'p-3'])]}
        loadPhoto=${loadPhoto}
      />`,
    );

    await waitFor(() => expect(screen.getByText(/photo could not be loaded/i)).toBeInTheDocument());
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
  });

  test('without loadPhoto the strip states the count rather than offering thumbs', () => {
    render(html`<${ObservationsList} observations=${[withPhotos(['p-1', 'p-2'])]} />`);

    expect(screen.getByText(/2 photos/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  test('a read landing after the row unmounts revokes its URL and touches no state', async () => {
    // The unmount cleanup has already run over an empty map by the time these
    // bytes arrive — without the mounted guard the URL would be stranded, and
    // the write would land on a component that no longer exists.
    useNoObserver();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const loadPhoto = vi.fn(async (id) => {
      await gate;
      return record(id);
    });
    const { unmount, container } = render(
      html`<${ObservationsList} observations=${[withPhotos(['p-1'])]} loadPhoto=${loadPhoto} />`,
    );

    await waitFor(() => expect(loadPhoto).toHaveBeenCalledWith('p-1'));
    await act(() => {});
    unmount();
    await act(async () => {
      release();
    });

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(savedUrls[0]);
    expect(container.innerHTML).toBe('');
  });

  test('unmounting disconnects a thumb that is still watching the viewport', () => {
    // A row scrolled off the session list must not leave observers behind on
    // detached nodes — the list re-renders on every save.
    useFakeObserver();
    const loadPhoto = vi.fn(async (id) => record(id));
    const { unmount } = render(
      html`<${ObservationsList}
        observations=${[withPhotos(['p-1', 'p-2'])]}
        loadPhoto=${loadPhoto}
      />`,
    );

    expect(observed).toHaveLength(2);
    expect(observed.some((entry) => entry.observer.disconnected)).toBe(false);

    unmount();

    expect(observed.every((entry) => entry.observer.disconnected)).toBe(true);
  });
});

describe('ObservationsList — the photo view pages through the photos', () => {
  const savedUrls = [];
  beforeEach(() => {
    savedUrls.length = 0;
    // One URL per photo id, so a test can say which photo the stage shows.
    URL.createObjectURL = vi.fn((blob) => {
      const url = `blob:${blob.photoId}`;
      savedUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn();
    // The no-observer path: every thumb fetches at once, so a numbered thumb
    // is there to tap. Paging itself is what these rows are about.
    vi.stubGlobal('IntersectionObserver', undefined);
  });
  afterEach(() => {
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
    vi.unstubAllGlobals();
  });

  const record = (id) => ({ id, contentType: 'image/jpeg', blob: { photoId: id } });
  const FILE = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
  const withPhotos = (ids) => ({
    ...OBS_WITH_PHOTO,
    photos: ids.map((id) => ({ id, referencePhoto: null })),
  });

  function renderRow(ids, props = {}) {
    const loadPhoto = props.loadPhoto ?? vi.fn(async (id) => record(id));
    const row = (nextIds) =>
      html`<${ObservationsList}
        observations=${[withPhotos(nextIds)]}
        loadPhoto=${loadPhoto}
        onSetPhoto=${props.onSetPhoto}
        onDeletePhoto=${props.onDeletePhoto}
      />`;
    const view = render(row(ids));
    return { ...view, loadPhoto, refresh: (nextIds) => view.rerender(row(nextIds)) };
  }

  const altFor = (ids, index) =>
    ids.length === 1
      ? 'Photo for this observation'
      : `Photo for this observation (${index + 1} of ${ids.length})`;

  async function openPager(ids, index, props) {
    const view = renderRow(ids, props);
    fireEvent.click(await screen.findByAltText(altFor(ids, index)));
    return view;
  }

  const dialog = () => screen.getByRole('dialog', { name: /photo/i });
  const shownSrc = () =>
    dialog().querySelector('img.photo-lightbox-image')?.getAttribute('src') ?? null;
  const caption = () => dialog().querySelector('.photo-lightbox-caption').textContent;

  // happy-dom's own IntersectionObserver never fires; the one test here that
  // cares which photos were fetched installs this and calls it by hand.
  const observedHere = [];
  class FakeObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.disconnected = false;
    }
    observe(element) {
      observedHere.push({
        callback: this.callback,
        element,
        options: this.options,
        observer: this,
      });
    }
    unobserve() {}
    disconnect() {
      this.disconnected = true;
    }
  }

  test('the caption says which photo of how many, but only when there is more than one', async () => {
    await openPager(['p-1', 'p-2', 'p-3'], 1);

    expect(caption()).toMatch(/2 of 3/);
    expect(shownSrc()).toBe('blob:p-2');
  });

  test('a lone photo is not captioned 1 of 1', async () => {
    await openPager(['p-1'], 0);

    expect(caption()).not.toMatch(/of/i);
    expect(screen.queryByRole('button', { name: /next photo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /previous photo/i })).toBeNull();
  });

  test('Next and Previous walk the strip, disabled at each end', async () => {
    await openPager(['p-1', 'p-2', 'p-3'], 0);

    const next = () => screen.getByRole('button', { name: /next photo/i });
    const prev = () => screen.getByRole('button', { name: /previous photo/i });
    expect(prev()).toBeDisabled();
    expect(next()).toBeEnabled();

    fireEvent.click(next());
    expect(shownSrc()).toBe('blob:p-2');
    expect(prev()).toBeEnabled();

    fireEvent.click(next());
    expect(shownSrc()).toBe('blob:p-3');
    expect(caption()).toMatch(/3 of 3/);
    expect(next()).toBeDisabled();

    fireEvent.click(prev());
    expect(shownSrc()).toBe('blob:p-2');
  });

  function swipe(dx, dy) {
    const stage = dialog().querySelector('.photo-lightbox-stage');
    fireEvent.pointerDown(stage, { clientX: 200, clientY: 300 });
    fireEvent.pointerUp(stage, { clientX: 200 + dx, clientY: 300 + dy });
  }

  test('swiping the stage left shows the next photo, right the previous', async () => {
    await openPager(['p-1', 'p-2', 'p-3'], 1);

    swipe(-60, 10);
    expect(shownSrc()).toBe('blob:p-3');

    swipe(80, -5);
    expect(shownSrc()).toBe('blob:p-2');
  });

  test('a short drag or a mostly-vertical one is not a swipe', async () => {
    await openPager(['p-1', 'p-2', 'p-3'], 1);

    swipe(-20, 0); // under the 40px threshold — a tap that slid
    expect(shownSrc()).toBe('blob:p-2');

    swipe(-50, -80); // a scroll, not a page turn
    expect(shownSrc()).toBe('blob:p-2');
  });

  test('a swipe at the last photo stays there rather than wrapping round', async () => {
    await openPager(['p-1', 'p-2'], 1);

    swipe(-90, 0);
    expect(shownSrc()).toBe('blob:p-2');
  });

  test('a swipe that ends over the backdrop pages without closing the view', async () => {
    // The finger keeps the stage's pointer stream (implicit capture) but the
    // synthetic click lands on the nearest common ancestor — the backdrop.
    // Turning a page must not also dismiss the photo.
    await openPager(['p-1', 'p-2', 'p-3'], 0);

    swipe(-70, 5);
    fireEvent.click(dialog());

    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(shownSrc()).toBe('blob:p-2');
  });

  test('a backdrop tap after a swipe that stayed on the photo still closes', async () => {
    // The suppression lasts one gesture, not until the next backdrop tap.
    await openPager(['p-1', 'p-2'], 0);

    swipe(-70, 5);
    fireEvent.pointerDown(dialog(), { clientX: 10, clientY: 10 });
    fireEvent.click(dialog());

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a pointerup with no pointerdown before it does nothing', async () => {
    // A finger that came down outside the stage and lifted over it: there is
    // no start to measure from, so there is no gesture.
    await openPager(['p-1', 'p-2'], 0);

    fireEvent.pointerUp(dialog().querySelector('.photo-lightbox-stage'), {
      clientX: 0,
      clientY: 300,
    });

    expect(shownSrc()).toBe('blob:p-1');
  });

  test('a cancelled pointer is not a swipe', async () => {
    // The system took the gesture (a call, the app switcher, an edge swipe);
    // whatever lifts afterwards is not a page turn.
    await openPager(['p-1', 'p-2'], 0);
    const stage = dialog().querySelector('.photo-lightbox-stage');

    fireEvent.pointerDown(stage, { clientX: 200, clientY: 300 });
    fireEvent.pointerCancel(stage, { clientX: 200, clientY: 300 });
    fireEvent.pointerUp(stage, { clientX: 120, clientY: 300 });

    expect(shownSrc()).toBe('blob:p-1');
  });

  test('opening a photo fetches its neighbours, not the whole strip', async () => {
    // The next tap must not wait on a read: the two adjacent photos are
    // fetched with the one being looked at, and no more.
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    observedHere.length = 0;
    const loadPhoto = vi.fn(async (id) => record(id));
    render(
      html`<${ObservationsList}
        observations=${[withPhotos(['p-1', 'p-2', 'p-3', 'p-4', 'p-5'])]}
        loadPhoto=${loadPhoto}
      />`,
    );
    await act(async () => {
      const entry = observedHere[2];
      entry.callback([{ isIntersecting: true, target: entry.element }], entry.observer);
    });

    fireEvent.click(await screen.findByAltText('Photo for this observation (3 of 5)'));

    await waitFor(() => expect(loadPhoto).toHaveBeenCalledWith('p-4'));
    expect(loadPhoto.mock.calls.map(([id]) => id).sort()).toEqual(['p-2', 'p-3', 'p-4']);
  });

  test('a photo whose bytes have not landed shows a stand-in, not a blank stage', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const loadPhoto = vi.fn(async (id) => {
      if (id !== 'p-1') await gate;
      return record(id);
    });
    await openPager(['p-1', 'p-2'], 0, { loadPhoto });

    fireEvent.click(screen.getByRole('button', { name: /next photo/i }));

    const standIn = dialog().querySelector('.photo-lightbox-loading');
    expect(standIn).not.toBeNull();
    expect(standIn).toHaveAttribute('aria-busy', 'true');
    expect(dialog().querySelector('img.photo-lightbox-image')).toBeNull();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(shownSrc()).toBe('blob:p-2'));
  });

  test('a photo that cannot be read says so in the stage rather than showing an empty box', async () => {
    const loadPhoto = vi.fn(async (id) => (id === 'p-2' ? undefined : record(id)));
    await openPager(['p-1', 'p-2'], 0, { loadPhoto });

    fireEvent.click(screen.getByRole('button', { name: /next photo/i }));

    await waitFor(() =>
      expect(within(dialog()).getByText(/photo could not be loaded/i)).toBeInTheDocument(),
    );
    expect(within(dialog()).getByText(/photo could not be loaded/i)).not.toHaveAttribute(
      'aria-busy',
    );
  });

  test('Retake rewrites the photo being looked at and the view stays on that slot', async () => {
    const onSetPhoto = vi.fn().mockResolvedValue(undefined);
    const { refresh } = await openPager(['p-1', 'p-2', 'p-3'], 1, {
      onSetPhoto,
      onDeletePhoto: vi.fn(),
    });

    fireEvent.change(dialog().querySelector('label.photo-lightbox-retake input'), {
      target: { files: [FILE] },
    });
    await waitFor(() => expect(onSetPhoto).toHaveBeenCalledWith('obs-2', 'p-2', FILE));

    refresh(['p-1', 'photo-x', 'p-3']);

    expect(caption()).toMatch(/2 of 3/);
    await waitFor(() => expect(shownSrc()).toBe('blob:photo-x'));
  });

  test('Delete moves the view to the next photo rather than dropping to the strip', async () => {
    const onDeletePhoto = vi.fn().mockResolvedValue(undefined);
    const { refresh } = await openPager(['p-1', 'p-2', 'p-3'], 1, {
      onSetPhoto: vi.fn(),
      onDeletePhoto,
    });

    fireEvent.click(within(dialog()).getByRole('button', { name: /^delete$/i }));
    fireEvent.click(within(dialog()).getByRole('button', { name: /delete photo/i }));
    await waitFor(() => expect(onDeletePhoto).toHaveBeenCalledWith('obs-2', 'p-2'));

    refresh(['p-1', 'p-3']);

    expect(shownSrc()).toBe('blob:p-3');
    expect(caption()).toMatch(/2 of 2/);
    // The confirm belongs to the photo it was raised on, not to the view.
    expect(within(dialog()).queryByRole('button', { name: /delete photo/i })).toBeNull();
  });

  test('deleting the last photo falls back to the one before it', async () => {
    const onDeletePhoto = vi.fn().mockResolvedValue(undefined);
    const { refresh } = await openPager(['p-1', 'p-2'], 1, {
      onSetPhoto: vi.fn(),
      onDeletePhoto,
    });

    fireEvent.click(within(dialog()).getByRole('button', { name: /^delete$/i }));
    fireEvent.click(within(dialog()).getByRole('button', { name: /delete photo/i }));
    await waitFor(() => expect(onDeletePhoto).toHaveBeenCalledWith('obs-2', 'p-2'));

    refresh(['p-1']);

    expect(shownSrc()).toBe('blob:p-1');
    expect(caption()).not.toMatch(/of/i);
  });

  test('deleting the only photo closes the view and the row offers Add photo again', async () => {
    const onDeletePhoto = vi.fn().mockResolvedValue(undefined);
    const { refresh } = await openPager(['p-1'], 0, { onSetPhoto: vi.fn(), onDeletePhoto });

    fireEvent.click(within(dialog()).getByRole('button', { name: /^delete$/i }));
    fireEvent.click(within(dialog()).getByRole('button', { name: /delete photo/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    refresh([]);

    expect(screen.getByText(/add photo/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('Add in the photo view lands on the photo just taken', async () => {
    const onSetPhoto = vi.fn().mockResolvedValue(undefined);
    const { refresh } = await openPager(['p-1', 'p-2'], 0, { onSetPhoto, onDeletePhoto: vi.fn() });

    fireEvent.change(dialog().querySelector('label.photo-lightbox-add input'), {
      target: { files: [FILE] },
    });
    await waitFor(() => expect(onSetPhoto).toHaveBeenCalledWith('obs-2', null, FILE));

    refresh(['p-1', 'p-2', 'photo-new']);

    expect(caption()).toMatch(/3 of 3/);
    await waitFor(() => expect(shownSrc()).toBe('blob:photo-new'));
  });

  test('closing the view while an added photo is still landing does not reopen it', async () => {
    // The refresh arrives after the view has gone: it must not throw a
    // full-screen photo back over the session list the surveyor moved on to.
    let resolveSet;
    const onSetPhoto = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSet = resolve;
        }),
    );
    const { refresh } = await openPager(['p-1', 'p-2'], 0, { onSetPhoto, onDeletePhoto: vi.fn() });

    fireEvent.change(dialog().querySelector('label.photo-lightbox-add input'), {
      target: { files: [FILE] },
    });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      resolveSet();
    });
    refresh(['p-1', 'p-2', 'photo-new']);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a view closed and reopened during an add stays on the photo reopened', async () => {
    // Closing spends the add-then-show intent. Coming back to a different
    // photo before the write lands must not then jump to the appended one.
    let resolveSet;
    const onSetPhoto = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSet = resolve;
        }),
    );
    const { refresh } = await openPager(['p-1', 'p-2', 'p-3'], 0, {
      onSetPhoto,
      onDeletePhoto: vi.fn(),
    });

    fireEvent.change(dialog().querySelector('label.photo-lightbox-add input'), {
      target: { files: [FILE] },
    });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    fireEvent.click(screen.getByAltText('Photo for this observation (2 of 3)'));
    expect(shownSrc()).toBe('blob:p-2');

    await act(async () => {
      resolveSet();
    });
    refresh(['p-1', 'p-2', 'p-3', 'p-4']);

    expect(shownSrc()).toBe('blob:p-2');
    expect(caption()).toMatch(/2 of 4/);
  });

  test('a view closed by a delete is not reopened by an add still in flight', async () => {
    // The other way out of the view: Delete stays live while an add is being
    // written, and closing that way must be as final as tapping Close.
    let resolveSet;
    const onSetPhoto = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSet = resolve;
        }),
    );
    const { refresh } = await openPager(['p-1'], 0, {
      onSetPhoto,
      onDeletePhoto: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.change(dialog().querySelector('label.photo-lightbox-add input'), {
      target: { files: [FILE] },
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: /^delete$/i }));
    fireEvent.click(within(dialog()).getByRole('button', { name: /delete photo/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The add's own refresh lands first, before the delete's.
    await act(async () => {
      resolveSet();
    });
    refresh(['p-1', 'p-2']);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('an add that fails leaves no intent behind for a later refresh to act on', async () => {
    const onSetPhoto = vi.fn().mockRejectedValue(new Error('no room on the device'));
    const { refresh } = await openPager(['p-1', 'p-2'], 0, {
      onSetPhoto,
      onDeletePhoto: vi.fn(),
    });

    fireEvent.change(dialog().querySelector('label.photo-lightbox-add input'), {
      target: { files: [FILE] },
    });
    await waitFor(() => expect(onSetPhoto).toHaveBeenCalled());

    // Some other write appends a photo later — the failed add must not make
    // the view jump to it.
    refresh(['p-1', 'p-2', 'p-3']);

    expect(shownSrc()).toBe('blob:p-1');
    expect(caption()).toMatch(/1 of 3/);
  });

  test('at the photo cap the view offers no Add', async () => {
    const ids = Array.from({ length: MAX_PHOTOS }, (_, index) => `p-${index + 1}`);
    await openPager(ids, 0, { onSetPhoto: vi.fn(), onDeletePhoto: vi.fn() });

    expect(dialog().querySelector('label.photo-lightbox-add')).toBeNull();
    // Retake is unaffected — replacing a photo does not add one.
    expect(dialog().querySelector('label.photo-lightbox-retake')).not.toBeNull();
  });

  test('one below the cap still offers Add', async () => {
    const ids = Array.from({ length: MAX_PHOTOS - 1 }, (_, index) => `p-${index + 1}`);
    await openPager(ids, 0, { onSetPhoto: vi.fn(), onDeletePhoto: vi.fn() });

    expect(dialog().querySelector('label.photo-lightbox-add')).not.toBeNull();
  });

  test('a read-only row still pages, and offers neither Retake nor Add', async () => {
    await openPager(['p-1', 'p-2'], 0);

    expect(dialog().querySelector('.photo-lightbox-actions')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /next photo/i }));
    expect(shownSrc()).toBe('blob:p-2');
  });

  test('the view keeps its photo when an earlier one leaves the record', async () => {
    // Keyed by photo id, not by index: a refresh that drops p-1 must not slide
    // the surveyor onto a different photo.
    const { refresh } = await openPager(['p-1', 'p-2', 'p-3'], 2);

    refresh(['p-2', 'p-3']);

    expect(shownSrc()).toBe('blob:p-3');
    expect(caption()).toMatch(/2 of 2/);
  });
});

// Task 7: the history page passes loadPhoto alone — no onSetPhoto,
// no onDeletePhoto (SessionHistoryPage.js needs no change for this; the
// component's existing absence-is-the-flag rule already covers it). These
// tests pin that a read-only row still gets the full strip-and-pager
// experience, just none of the write actions.
describe('ObservationsList — the history view pages photos read-only (task 7)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn((blob) => `blob:${blob.photoId}`);
    URL.revokeObjectURL = vi.fn();
    // History renders every thumb at once — paging is what this block is
    // about, not when bytes arrive.
    vi.stubGlobal('IntersectionObserver', undefined);
  });
  afterEach(() => {
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
    vi.unstubAllGlobals();
  });

  const record = (id) => ({ id, contentType: 'image/jpeg', blob: { photoId: id } });
  const historyObservation = {
    ...OBS_WITH_PHOTO,
    photos: ['h-1', 'h-2', 'h-3'].map((id) => ({ id, referencePhoto: null })),
  };

  test('with loadPhoto alone, three photos: the strip, the lightbox and its nav all work — no Retake/Add/Delete', async () => {
    const loadPhoto = vi.fn(async (id) => record(id));
    render(
      html`<${ObservationsList} observations=${[historyObservation]} loadPhoto=${loadPhoto} />`,
    );

    const thumbs = await screen.findAllByRole('img', { name: /photo for this observation/i });
    expect(thumbs).toHaveLength(3);

    fireEvent.click(thumbs[1]);
    const dialog = screen.getByRole('dialog', { name: /photo/i });
    const caption = () => dialog.querySelector('.photo-lightbox-caption').textContent;
    const shownSrc = () => dialog.querySelector('img.photo-lightbox-image')?.getAttribute('src');
    expect(caption()).toMatch(/2 of 3/);
    expect(shownSrc()).toBe('blob:h-2');

    fireEvent.click(within(dialog).getByRole('button', { name: /next photo/i }));
    await waitFor(() => expect(shownSrc()).toBe('blob:h-3'));
    fireEvent.click(within(dialog).getByRole('button', { name: /previous photo/i }));
    await waitFor(() => expect(shownSrc()).toBe('blob:h-2'));

    // No writers were passed, so none of the write actions are offered.
    expect(within(dialog).queryByText(/retake/i)).toBeNull();
    expect(within(dialog).queryByText(/^add$/i)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /^delete$/i })).toBeNull();
    expect(dialog.querySelector('.photo-lightbox-actions')).toBeNull();
  });

  test('an observation with no photos and no onSetPhoto offers no Add photo link', () => {
    render(html`<${ObservationsList} observations=${[{ ...OBS_NO_PHOTO, photos: [] }]} />`);

    expect(screen.queryByText(/add photo/i)).toBeNull();
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
    photos: [],
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
