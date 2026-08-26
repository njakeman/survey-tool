import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { html } from 'htm/preact';
import { FramingScreen } from './FramingScreen.js';

const station = {
  id: 'ref-2',
  index: 3,
  name: 'West stile',
  state: 'todo',
  note: 'Stone stile, west boundary.',
  lat: 51.5002,
  lon: -0.14,
  headingDeg: 38,
  gpsAccuracyM: 4.1,
  photos: [{ filename: 'ref-2.jpg', entryName: 'photos/ref-2.jpg' }],
};

function renderScreen(overrides = {}) {
  const props = {
    station,
    stationCount: 12,
    position: { lat: 51.5, lon: -0.14, accuracyM: 6 },
    referenceStartedAt: '2025-04-12T09:00:00.000Z',
    readPhoto: vi.fn().mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff])),
    onPhoto: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const { unmount } = render(html`<${FramingScreen} ...${props} />`);
  return { ...props, unmount };
}

describe('FramingScreen', () => {
  test('is a full-screen step naming the station, with a way back', () => {
    const { onClose } = renderScreen();

    const dialog = screen.getByRole('dialog', { name: /frame the photo/i });
    expect(dialog).toHaveTextContent('West stile');
    expect(dialog).toHaveTextContent('4 of 12');

    fireEvent.click(screen.getByRole('button', { name: /back to capture/i }));
    expect(onClose).toHaveBeenCalled();
  });

  test('loads the reference photo lazily, exactly once, with its bearing caption', async () => {
    const { readPhoto } = renderScreen();

    await waitFor(() => expect(document.querySelector('.framing-screen-photo')).not.toBeNull());
    expect(readPhoto).toHaveBeenCalledTimes(1);
    expect(readPhoto).toHaveBeenCalledWith('photos/ref-2.jpg');
    // Reference label carries the date; the caption the capture facts.
    expect(screen.getByText('Reference · 12 Apr 2025')).toBeInTheDocument();
    expect(screen.getByText('038° · ±4 m')).toBeInTheDocument();
  });

  test('a caption fact the reference never stored is omitted, not zeroed', async () => {
    renderScreen({ station: { ...station, headingDeg: null } });

    await waitFor(() => expect(document.querySelector('.framing-screen-photo')).not.toBeNull());
    expect(screen.getByText('±4 m')).toBeInTheDocument();
    expect(screen.queryByText(/°/)).toBeNull();
  });

  test('a station with no reference photo says so and asks nothing of the zip', () => {
    const { readPhoto } = renderScreen({
      station: { ...station, photos: [] },
    });

    expect(screen.getByText(/no reference photo for this station/i)).toBeInTheDocument();
    expect(readPhoto).not.toHaveBeenCalled();
  });

  test('an unreadable photo degrades to a named line; the shutter still works', async () => {
    renderScreen({ readPhoto: vi.fn().mockRejectedValue(new Error('corrupt entry')) });

    await screen.findByText(/could not read the reference photo/i);
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  test('Take photo hands the picked file over — the native camera path', () => {
    const { onPhoto } = renderScreen();

    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'environment');

    const file = new File([new Uint8Array([1])], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(onPhoto).toHaveBeenCalledWith(file, 'ref-2.jpg');
  });

  test('one reference photo: no pager, the label reads as before', async () => {
    renderScreen();

    await waitFor(() => expect(document.querySelector('.framing-screen-photo')).not.toBeNull());
    expect(screen.queryByRole('button', { name: /previous reference/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /next reference/i })).toBeNull();
    expect(screen.getByText('Reference · 12 Apr 2025')).toBeInTheDocument();
  });

  test('the live walk line reads from the fix — the number to check while framing', () => {
    renderScreen();

    // ~22 m due north.
    expect(screen.getByText(/22 m N/)).toBeInTheDocument();
  });

  test('never gates: the sentence is on screen, verbatim', () => {
    renderScreen();

    expect(
      screen.getByText('Close enough is your call. The app measures, it does not gate.'),
    ).toBeInTheDocument();
  });

  describe('with several reference photos', () => {
    const three = {
      ...station,
      photos: [
        { filename: 'ref-2a.jpg', entryName: 'photos/ref-2a.jpg' },
        { filename: 'ref-2b.jpg', entryName: 'photos/ref-2b.jpg' },
        { filename: 'ref-2c.jpg', entryName: 'photos/ref-2c.jpg' },
      ],
    };
    const label = () => document.querySelector('.framing-screen-label').textContent;
    const prev = () => screen.getByRole('button', { name: /previous reference/i });
    const next = () => screen.getByRole('button', { name: /next reference/i });
    const shown = async () => {
      await waitFor(() => expect(document.querySelector('.framing-screen-photo')).not.toBeNull());
      return document.querySelector('.framing-screen-photo');
    };
    const swipe = (dx, dy = 0) => {
      const stage = document.querySelector('.framing-screen-stage');
      fireEvent.pointerDown(stage, { clientX: 200, clientY: 300 });
      fireEvent.pointerUp(stage, { clientX: 200 + dx, clientY: 300 + dy });
    };

    test('opens on the first, numbered, with arrows disabled at the ends', async () => {
      const { readPhoto } = renderScreen({ station: three });

      await shown();
      expect(label()).toBe('Reference 1 of 3 · 12 Apr 2025');
      expect(readPhoto).toHaveBeenCalledWith('photos/ref-2a.jpg');
      expect(prev()).toBeDisabled();
      expect(next()).not.toBeDisabled();

      fireEvent.click(next());
      expect(label()).toBe('Reference 2 of 3 · 12 Apr 2025');
      await waitFor(() => expect(readPhoto).toHaveBeenCalledWith('photos/ref-2b.jpg'));

      fireEvent.click(next());
      expect(label()).toBe('Reference 3 of 3 · 12 Apr 2025');
      expect(next()).toBeDisabled();
      fireEvent.click(prev());
      expect(label()).toBe('Reference 2 of 3 · 12 Apr 2025');
    });

    test('a horizontal swipe pages; a short or vertical one does not', async () => {
      renderScreen({ station: three });
      await shown();

      swipe(-60);
      expect(label()).toMatch(/^Reference 2 of 3/);
      swipe(20);
      expect(label()).toMatch(/^Reference 2 of 3/);
      swipe(-50, 80);
      expect(label()).toMatch(/^Reference 2 of 3/);
      swipe(60);
      expect(label()).toMatch(/^Reference 1 of 3/);
      swipe(60);
      expect(label()).toMatch(/^Reference 1 of 3/);
    });

    test('opens on the first reference not yet re-framed, ticking the done ones', async () => {
      renderScreen({ station: three, framed: new Set(['ref-2a.jpg']) });

      await shown();
      expect(label()).toMatch(/^Reference 2 of 3/);
      expect(screen.queryByText(/done/)).toBeNull();
      fireEvent.click(prev());
      await waitFor(() => expect(screen.getByText('038° · ±4 m · done')).toBeInTheDocument());
    });

    test('a shot names the shown reference and advances to the next unframed', async () => {
      const { onPhoto } = renderScreen({ station: three, framed: new Set(['ref-2b.jpg']) });
      await shown();
      expect(label()).toMatch(/^Reference 1 of 3/);

      const input = document.querySelector('input[type="file"]');
      const file = new File([new Uint8Array([1])], 'photo.jpg', { type: 'image/jpeg' });
      fireEvent.change(input, { target: { files: [file] } });

      expect(onPhoto).toHaveBeenCalledWith(file, 'ref-2a.jpg');
      // 2 is already done — skipped.
      expect(label()).toMatch(/^Reference 3 of 3/);

      fireEvent.change(input, { target: { files: [file] } });
      expect(onPhoto).toHaveBeenLastCalledWith(file, 'ref-2c.jpg');
      // Nothing left to advance to (the screen remembers its own shots
      // before the parent reports them back): stay where the surveyor is.
      expect(label()).toMatch(/^Reference 3 of 3/);
      await waitFor(() => expect(screen.getByText('038° · ±4 m · done')).toBeInTheDocument());
    });

    test('a shot on a later reference wraps round to an earlier unframed one', async () => {
      renderScreen({ station: three });
      await shown();
      fireEvent.click(next());
      fireEvent.click(next());

      const file = new File([new Uint8Array([1])], 'photo.jpg', { type: 'image/jpeg' });
      fireEvent.change(document.querySelector('input[type="file"]'), {
        target: { files: [file] },
      });
      expect(label()).toMatch(/^Reference 1 of 3/);
    });

    test('at the cap the shutter is dead and says why', () => {
      renderScreen({ station: three, atCap: true });

      expect(document.querySelector('input[type="file"]')).toBeDisabled();
      expect(screen.getByText('10 photos — the most one record holds')).toBeInTheDocument();
    });

    test('paging back is instant and every URL is revoked on unmount', async () => {
      const created = [];
      const revoked = [];
      const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        const url = `blob:ref-${created.length}`;
        created.push(url);
        return url;
      });
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
        revoked.push(url);
      });
      try {
        const { readPhoto, unmount } = renderScreen({ station: three });

        await shown();
        fireEvent.click(next());
        await waitFor(() => expect(readPhoto).toHaveBeenCalledWith('photos/ref-2b.jpg'));
        await shown();
        const calls = readPhoto.mock.calls.length;
        fireEvent.click(prev());
        await shown();
        // Nothing re-read: the entry was cached.
        expect(readPhoto.mock.calls.length).toBe(calls);

        await waitFor(() => expect(created.length).toBeGreaterThanOrEqual(2));
        unmount();
        expect(revoked.sort()).toEqual([...created].sort());
      } finally {
        createSpy.mockRestore();
        revokeSpy.mockRestore();
      }
    });

    test('one unreadable entry leaves the others readable', async () => {
      const readPhoto = vi.fn(async (entryName) => {
        if (entryName.endsWith('2b.jpg')) throw new Error('corrupt entry');
        return new Uint8Array([0xff, 0xd8, 0xff]);
      });
      renderScreen({ station: three, readPhoto });
      await shown();

      fireEvent.click(next());
      await screen.findByText(/could not read the reference photo/i);
      fireEvent.click(next());
      await shown();
      expect(screen.queryByText(/could not read/i)).toBeNull();
    });
  });
});
