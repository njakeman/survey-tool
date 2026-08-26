import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { html } from 'htm/preact';
import { StationBlock } from './StationBlock.js';

const station = {
  id: 'ref-2',
  index: 3,
  name: 'West stile',
  state: 'todo',
  note: 'Stone stile, west boundary. Shot facing the oak, waist height.',
  lat: 51.5002, // ~22 m north of the fix
  lon: -0.14,
  headingDeg: 38,
  gpsAccuracyM: 4.1,
};

function renderBlock(overrides = {}) {
  const props = {
    station,
    stationCount: 12,
    stations: [station],
    currentId: 'ref-2',
    position: { lat: 51.5, lon: -0.14, accuracyM: 6 },
    referenceStartedAt: '2025-04-12T09:00:00.000Z',
    onChange: vi.fn(),
    onFrame: vi.fn(),
    onSkip: vi.fn(),
    onNoAccess: vi.fn(),
    ...overrides,
  };
  render(html`<${StationBlock} ...${props} />`);
  return props;
}

describe('StationBlock', () => {
  test('names the station, counts it, and gives the walking instruction', () => {
    renderBlock();

    // Natural case in the DOM; CSS uppercases the label.
    expect(screen.getByText('Station 4 of 12')).toBeInTheDocument();
    expect(screen.getByText('West stile')).toBeInTheDocument();
    expect(screen.getByText(/22 m/)).toBeInTheDocument();
    expect(screen.getByText('N', { selector: '.station-block-compass' })).toBeInTheDocument();
    expect(screen.getByText(/bearing 000° · ±6 m fix/)).toBeInTheDocument();
  });

  test('carries the reference note under its dated label — the identification device', () => {
    renderBlock();

    expect(screen.getByText('Note from 12 Apr 2025')).toBeInTheDocument();
    expect(screen.getByText(/Stone stile, west boundary/)).toBeInTheDocument();
  });

  test('a station with no note gets no note block rather than an empty one', () => {
    renderBlock({ station: { ...station, note: '' } });

    expect(screen.queryByText(/note from/i)).toBeNull();
  });

  test('Frame the photo is the accent action', () => {
    const { onFrame } = renderBlock();

    fireEvent.click(screen.getByRole('button', { name: /^frame the photo$/i }));

    expect(onFrame).toHaveBeenCalled();
  });

  test('a station with several reference photos says so on the button', () => {
    renderBlock({
      station: {
        ...station,
        photos: [
          { filename: 'a.jpg', entryName: 'photos/a.jpg' },
          { filename: 'b.jpg', entryName: 'photos/b.jpg' },
        ],
      },
    });

    expect(screen.getByRole('button', { name: /^frame the photos$/i })).toBeInTheDocument();
  });

  test('Change hands over to the chooser', () => {
    const { onChange } = renderBlock();

    fireEvent.click(screen.getByRole('button', { name: /change/i }));

    expect(onChange).toHaveBeenCalled();
  });

  test('Skip is cheap: no confirm, straight through', () => {
    const { onSkip } = renderBlock();

    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  test("Can't reach it asks first — a claim about the world that lands in the export", () => {
    const { onNoAccess } = renderBlock();

    fireEvent.click(screen.getByRole('button', { name: /can't reach it/i }));

    expect(onNoAccess).not.toHaveBeenCalled();
    expect(screen.getByText(/mark west stile as no access\?/i)).toBeInTheDocument();
    // The confirm replaces the actions — no second accent on the surface.
    expect(screen.queryByRole('button', { name: /frame the photo/i })).toBeNull();

    fireEvent.input(screen.getByLabelText(/reason/i), { target: { value: 'bull in field' } });
    fireEvent.click(screen.getByRole('button', { name: /mark no access/i }));

    expect(onNoAccess).toHaveBeenCalledWith('bull in field');
  });

  test('the reason is optional — committing without one records null', () => {
    const { onNoAccess } = renderBlock();

    fireEvent.click(screen.getByRole('button', { name: /can't reach it/i }));
    fireEvent.click(screen.getByRole('button', { name: /mark no access/i }));

    expect(onNoAccess).toHaveBeenCalledWith(null);
  });

  test('Cancel backs out of the confirm with nothing recorded', () => {
    const { onNoAccess } = renderBlock();

    fireEvent.click(screen.getByRole('button', { name: /can't reach it/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onNoAccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /frame the photo/i })).toBeInTheDocument();
  });

  test('waiting for a fix, the walk line says so instead of guessing', () => {
    renderBlock({ position: null });

    expect(screen.getByText(/waiting for gps fix/i)).toBeInTheDocument();
  });

  describe('the live arrow (design 8b revision, 2026-08-24)', () => {
    const position = { lat: 51.5, lon: -0.14, accuracyM: 6 };
    const props = {
      station,
      stationCount: 12,
      position,
      referenceStartedAt: '2025-04-12T09:00:00.000Z',
      onChange: vi.fn(),
      onFrame: vi.fn(),
      onSkip: vi.fn(),
      onNoAccess: vi.fn(),
    };
    const arrow = () => document.querySelector('.station-block-arrow');

    test('the plan diagram is gone — superseded, the map panel already shows the field', () => {
      renderBlock();

      expect(document.querySelector('.plan-diagram')).toBeNull();
    });

    test('with a heading, the arrow rotates screen-relative and the caption says live', () => {
      // Station due north (bearing 000); device facing east (090): on a
      // screen whose up is where the device points, north is 270° clockwise.
      render(html`<${StationBlock} ...${props} guidanceHeadingDeg=${90} />`);

      expect(arrow().style.transform).toBe('rotate(270deg)');
      expect(screen.getByText(/bearing 000° · ±6 m fix · live/)).toBeInTheDocument();
    });

    test('without any heading source, the arrow shows true bearing and never claims live', () => {
      render(html`<${StationBlock} ...${props} />`);

      expect(arrow().style.transform).toBe('rotate(0deg)');
      expect(screen.getByText(/bearing 000° · ±6 m fix/)).toBeInTheDocument();
      expect(screen.queryByText(/· live/)).toBeNull();
    });

    test('rotation accumulates across the wrap — 350° to 10° turns forward, never spins back', () => {
      const { rerender } = render(html`<${StationBlock} ...${props} guidanceHeadingDeg=${10} />`);
      expect(arrow().style.transform).toBe('rotate(350deg)');

      rerender(html`<${StationBlock} ...${props} guidanceHeadingDeg=${350} />`);
      expect(arrow().style.transform).toBe('rotate(370deg)');
    });
  });
});
