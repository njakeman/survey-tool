import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { html } from 'htm/preact';
import { StationList } from './StationList.js';

// The 8d vocabulary: every state is a shape plus a word, never colour
// alone, and the chips carry natural case in the DOM (CSS uppercases).

const stations = [
  { id: 'ref-1', index: 0, name: 'Culvert head', state: 'done', lat: 51.5, lon: -0.14 },
  { id: 'ref-2', index: 1, name: 'West stile', state: 'todo', lat: 51.5002, lon: -0.14 },
  { id: 'ref-3', index: 2, name: 'Pond outfall', state: 'skipped', lat: 51.501, lon: -0.14 },
  {
    id: 'ref-4',
    index: 3,
    name: 'Lower gate',
    state: 'noAccess',
    reason: 'padlocked',
    lat: 51.502,
    lon: -0.14,
  },
];

describe('StationList', () => {
  test('every station renders its name, a state chip in words, and a shape glyph', () => {
    render(html`<${StationList} stations=${stations} />`);

    expect(screen.getByText('Culvert head')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('To do')).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.getByText('No access')).toBeInTheDocument();
    for (const variant of ['done', 'todo', 'skipped', 'noaccess']) {
      expect(document.querySelector(`.station-glyph-${variant}`)).toBeInTheDocument();
    }
  });

  test('the current station reads Current and shows the walk to it', () => {
    render(
      html`<${StationList}
        stations=${stations}
        currentId="ref-2"
        position=${{ lat: 51.5, lon: -0.14 }}
      />`,
    );

    expect(screen.getByText('Current')).toBeInTheDocument();
    // ~22 m due north of the fix.
    expect(screen.getByText(/22 m N/)).toBeInTheDocument();
    expect(document.querySelector('.station-glyph-current')).toBeInTheDocument();
  });

  test('rows are tappable only when onSelect is given — Review stays read-only', () => {
    const { rerender } = render(html`<${StationList} stations=${stations} />`);
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    const onSelect = vi.fn();
    rerender(html`<${StationList} stations=${stations} onSelect=${onSelect} />`);
    fireEvent.click(screen.getByRole('button', { name: /west stile/i }));

    expect(onSelect).toHaveBeenCalledWith('ref-2');
  });

  test('a no-access reason travels with its row', () => {
    render(html`<${StationList} stations=${stations} />`);

    expect(screen.getByText(/padlocked/)).toBeInTheDocument();
  });
});
