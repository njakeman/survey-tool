import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/preact';
import { html } from 'htm/preact';
import { ChevronGlyph } from './chevronGlyph.js';

describe('ChevronGlyph', () => {
  test('points the way it is asked, decoratively', () => {
    const { container } = render(html`<${ChevronGlyph} direction="next" />`);
    expect(container.querySelector('polyline').getAttribute('points')).toBe('2,1 8,8 2,15');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    const prev = render(html`<${ChevronGlyph} direction="prev" />`);
    expect(prev.container.querySelector('polyline').getAttribute('points')).toBe('8,1 2,8 8,15');
  });
});
