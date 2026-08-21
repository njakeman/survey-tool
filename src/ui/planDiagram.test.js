import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/preact';
import { html } from 'htm/preact';
import {
  planDiagramView,
  PlanDiagram,
  PLAN_SIZE,
  PLAN_CENTRE,
  PLAN_OUTER_R,
} from './planDiagram.js';

// ~0.000899° of latitude is 100 m; these stations sit at easy bearings.
const position = { lat: 51.5, lon: -0.14 };
const north25 = { id: 'ref-1', state: 'todo', lat: 51.5 + 0.000899 / 4, lon: -0.14 };
const east50 = {
  id: 'ref-2',
  state: 'done',
  lat: 51.5,
  lon: -0.14 + 0.000899 / 2 / Math.cos((51.5 * Math.PI) / 180),
};

describe('planDiagramView', () => {
  test('projects stations onto the disc, north up', () => {
    const view = planDiagramView([north25, east50], 'ref-1', position);

    const north = view.points.find((p) => p.id === 'ref-1');
    // 25 m north on a 50 m disc: half the outer radius, straight up.
    expect(north.x).toBeCloseTo(PLAN_CENTRE, 0);
    expect(north.y).toBeCloseTo(PLAN_CENTRE - PLAN_OUTER_R / 2, 0);

    const east = view.points.find((p) => p.id === 'ref-2');
    expect(east.x).toBeCloseTo(PLAN_CENTRE + PLAN_OUTER_R, 0);
    expect(east.y).toBeCloseTo(PLAN_CENTRE, 0);
  });

  test('the disc is 50 m by default and grows in tidy steps to hold the farthest station', () => {
    const near = planDiagramView([north25], null, position);
    expect(near.outerM).toBe(50);
    expect(near.caption).toBe('50 m');

    const far = {
      id: 'ref-9',
      state: 'todo',
      lat: 51.5 + 0.000899 * 3.2, // ~320 m north
      lon: -0.14,
    };
    const wide = planDiagramView([north25, far], null, position);
    expect(wide.outerM).toBe(500);
    expect(wide.caption).toBe('500 m');
  });

  test('carries each station state, current outranking it, and the current bearing', () => {
    const view = planDiagramView([north25, east50], 'ref-2', position);

    expect(view.points.find((p) => p.id === 'ref-1').kind).toBe('todo');
    expect(view.points.find((p) => p.id === 'ref-2').kind).toBe('current');
    expect(view.currentBearingDeg).toBeCloseTo(90, 0);
  });

  test('without a fix there is no diagram — never a guess', () => {
    expect(planDiagramView([north25], null, null)).toBeNull();
    expect(planDiagramView([], null, position)).toBeNull();
  });
});

describe('PlanDiagram', () => {
  test('renders the rings, the you-dot and one shape per station', () => {
    render(
      html`<${PlanDiagram} stations=${[north25, east50]} currentId="ref-1" position=${position} />`,
    );

    const svg = document.querySelector('svg.plan-diagram');
    expect(svg).toBeInTheDocument();
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${PLAN_SIZE} ${PLAN_SIZE}`);
    expect(svg.querySelectorAll('.plan-diagram-ring')).toHaveLength(2);
    expect(svg.querySelector('.plan-diagram-you')).toBeTruthy();
    expect(svg.querySelectorAll('.plan-diagram-station')).toHaveLength(2);
    expect(svg.querySelector('.plan-diagram-current')).toBeTruthy();
    expect(svg.textContent).toContain('50 m');
  });

  test('renders nothing without a fix', () => {
    const { container } = render(
      html`<${PlanDiagram} stations=${[north25]} currentId=${null} position=${null} />`,
    );

    expect(container.querySelector('svg')).toBeNull();
  });
});
