import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { html } from 'htm/preact';
import { RevisitSetup } from './RevisitSetup.js';

const loaded = {
  buffer: new ArrayBuffer(4),
  stations: [
    {
      id: 'ref-1',
      note: 'Culvert head. Shot upstream.',
      lat: 51.5002,
      lon: -0.14,
    },
    {
      id: 'ref-2',
      note: 'West stile, west boundary.',
      lat: 51.503,
      lon: -0.14,
    },
  ],
  reference: {
    filename: 'long-barrow-2025-04-12.zip',
    hash: 'a'.repeat(64),
    sessionId: 'ref-sess-1',
    sessionName: 'Long Barrow south',
    startedAt: '2025-04-12T09:00:00.000Z',
    stationCount: 2,
    photoCount: 1,
  },
};

describe('RevisitSetup', () => {
  test('offers to load a reference export until one is loaded', () => {
    render(html`<${RevisitSetup} loaded=${null} onPickFile=${vi.fn()} />`);

    expect(screen.getByText(/load reference export/i)).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', '.zip,application/zip');
  });

  test('picking a file hands it over', () => {
    const onPickFile = vi.fn();
    render(html`<${RevisitSetup} loaded=${null} onPickFile=${onPickFile} />`);

    const file = new File(['PK'], 'ref.zip', { type: 'application/zip' });
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [file] },
    });

    expect(onPickFile).toHaveBeenCalledWith(file);
  });

  test('a loaded reference shows its identity, counts and date, marked read only', () => {
    render(html`<${RevisitSetup} loaded=${loaded} onPickFile=${vi.fn()} />`);

    expect(screen.getByText('long-barrow-2025-04-12.zip')).toBeInTheDocument();
    // Natural case in the DOM; CSS uppercases the chip.
    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.getByText(/2 stations · 1 photo · 12 Apr 2025/)).toBeInTheDocument();
    expect(screen.getByText(/replace file/i)).toBeInTheDocument();
  });

  test('a failed load shows the named reason and keeps offering the picker', () => {
    render(html`<${RevisitSetup}
      loaded=${null}
      error="Could not load reference: the export has no observations to revisit"
      onPickFile=${vi.fn()}
    />`);

    expect(screen.getByRole('alert')).toHaveTextContent(/no observations to revisit/);
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  test('nearest stations list by distance with a compass point — the am-I-in-the-right-place check', () => {
    render(html`<${RevisitSetup}
      loaded=${loaded}
      position=${{ lat: 51.5, lon: -0.14 }}
      onPickFile=${vi.fn()}
    />`);

    expect(screen.getByText('Nearest stations')).toBeInTheDocument();
    const rows = [...document.querySelectorAll('.revisit-setup-nearest-row')];
    expect(rows.length).toBe(2);
    // ref-1 is ~22 m away, ref-2 ~330 m — nearest first.
    expect(rows[0].textContent).toMatch(/Culvert head/);
    expect(rows[0].textContent).toMatch(/22 m/);
    expect(rows[0].textContent).toMatch(/N/);
    expect(rows[1].textContent).toMatch(/West stile/);
  });

  test('no fix yet means no nearest list — never a guess', () => {
    render(html`<${RevisitSetup} loaded=${loaded} onPickFile=${vi.fn()} />`);

    expect(screen.queryByText('Nearest stations')).toBeNull();
  });

  test('Review stations unfolds the full station list, read only', () => {
    render(html`<${RevisitSetup} loaded=${loaded} onPickFile=${vi.fn()} />`);

    expect(screen.queryByText('To do')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /review stations/i }));

    expect(screen.getAllByText('To do').length).toBe(2);
    expect(screen.queryAllByRole('button', { name: /culvert head/i })).toHaveLength(0);
  });
});
