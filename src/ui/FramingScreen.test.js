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
  photoFilename: 'ref-2.jpg',
  photoEntryName: 'photos/ref-2.jpg',
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
  render(html`<${FramingScreen} ...${props} />`);
  return props;
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
      station: { ...station, photoFilename: null, photoEntryName: null },
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

    expect(onPhoto).toHaveBeenCalledWith(file);
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
});
