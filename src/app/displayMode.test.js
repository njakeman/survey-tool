import { describe, expect, test } from 'vitest';
import { applyDisplayMode } from './displayMode.js';

// A minimal document fake: the module only touches the root element's
// data-mode attribute and the two theme-color metas.
function fakeDoc() {
  const attributes = new Map();
  const meta = (media, content) => {
    const attrs = new Map([
      ['name', 'theme-color'],
      ['media', media],
      ['content', content],
    ]);
    return {
      getAttribute: (name) => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, value),
    };
  };
  const metas = [
    meta('(prefers-color-scheme: light)', '#c2611f'),
    meta('(prefers-color-scheme: dark)', '#16171c'),
  ];
  return {
    documentElement: {
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
      getAttribute: (name) => attributes.get(name) ?? null,
    },
    querySelectorAll: (selector) => (selector === 'meta[name="theme-color"]' ? metas : []),
    metas,
  };
}

describe('applyDisplayMode', () => {
  test('night sets data-mode and takes the status bar to night paper', () => {
    const doc = fakeDoc();

    applyDisplayMode('night', doc);

    expect(doc.documentElement.getAttribute('data-mode')).toBe('night');
    // Both metas: the status bar must not light up whichever OS scheme is on.
    expect(doc.metas[0].getAttribute('content')).toBe('#0b0604');
    expect(doc.metas[1].getAttribute('content')).toBe('#0b0604');
  });

  test('auto removes the attribute and restores the per-scheme pair', () => {
    const doc = fakeDoc();
    applyDisplayMode('night', doc);

    applyDisplayMode('auto', doc);

    expect(doc.documentElement.getAttribute('data-mode')).toBeNull();
    expect(doc.metas[0].getAttribute('content')).toBe('#c2611f');
    expect(doc.metas[1].getAttribute('content')).toBe('#16171c');
  });

  test('an unknown stored value behaves as auto, never as night', () => {
    // Night can only ever be a deliberate act — a corrupt setting must not
    // drop anyone into red.
    const doc = fakeDoc();

    applyDisplayMode('sepia', doc);

    expect(doc.documentElement.getAttribute('data-mode')).toBeNull();
  });

  test('forced light pins the attribute and both metas to the light pair', () => {
    // The browser picks between the metas by OS scheme, so a forced position
    // must write the same colour to both — otherwise forced Light on an
    // OS-dark phone gets a dark status bar over a paper screen.
    const doc = fakeDoc();

    applyDisplayMode('light', doc);

    expect(doc.documentElement.getAttribute('data-mode')).toBe('light');
    expect(doc.metas[0].getAttribute('content')).toBe('#c2611f');
    expect(doc.metas[1].getAttribute('content')).toBe('#c2611f');
  });

  test('forced dark pins the attribute and both metas to dark paper', () => {
    const doc = fakeDoc();

    applyDisplayMode('dark', doc);

    expect(doc.documentElement.getAttribute('data-mode')).toBe('dark');
    expect(doc.metas[0].getAttribute('content')).toBe('#16171c');
    expect(doc.metas[1].getAttribute('content')).toBe('#16171c');
  });

  test('auto clears a forced scheme, not just night', () => {
    const doc = fakeDoc();
    applyDisplayMode('dark', doc);

    applyDisplayMode('auto', doc);

    expect(doc.documentElement.getAttribute('data-mode')).toBeNull();
    expect(doc.metas[0].getAttribute('content')).toBe('#c2611f');
    expect(doc.metas[1].getAttribute('content')).toBe('#16171c');
  });
});
