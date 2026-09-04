import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { html } from 'htm/preact';
import { StationWalk } from './StationWalk.js';

// The walking instruction on its own: arrow, distance, compass point. Shared
// by the station block and the maximised map's readout, so it is tested once
// here and the two hosts only assert that they render it.
describe('StationWalk', () => {
  const position = { lat: 51.5, lon: -0.14, accuracyM: 6 };
  // ~22 m due north.
  const station = { id: 's1', name: 'Gate post', lat: 51.5002, lon: -0.14 };
  const arrow = () => document.querySelector('.station-block-arrow');

  test('reads distance and compass point at arm-length size', () => {
    render(html`<${StationWalk} position=${position} station=${station} />`);

    expect(screen.getByText('22 m', { selector: '.station-block-distance' })).toBeInTheDocument();
    expect(screen.getByText('N', { selector: '.station-block-compass' })).toBeInTheDocument();
  });

  test('with a heading, the arrow rotates screen-relative', () => {
    // Station due north; device facing east: north is 270° clockwise on a
    // screen whose up is where the device points.
    render(
      html`<${StationWalk} position=${position} station=${station} guidanceHeadingDeg=${90} />`,
    );

    expect(arrow().style.transform).toBe('rotate(270deg)');
  });

  test('without a heading source, the arrow stands at true bearing', () => {
    render(html`<${StationWalk} position=${position} station=${station} />`);

    expect(arrow().style.transform).toBe('rotate(0deg)');
  });

  test('rotation accumulates across the wrap — 350° to 10° turns forward, never spins back', () => {
    const { rerender } = render(
      html`<${StationWalk} position=${position} station=${station} guidanceHeadingDeg=${10} />`,
    );
    expect(arrow().style.transform).toBe('rotate(350deg)');

    rerender(
      html`<${StationWalk} position=${position} station=${station} guidanceHeadingDeg=${350} />`,
    );
    expect(arrow().style.transform).toBe('rotate(370deg)');
  });

  test('renders nothing without a fix to measure from', () => {
    const { container } = render(html`<${StationWalk} position=${null} station=${station} />`);

    expect(container.innerHTML).toBe('');
  });
});
