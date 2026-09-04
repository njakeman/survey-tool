import { describe, expect, test } from 'vitest';
import {
  BEAM_MIN_DEG,
  BEAM_MAX_DEG,
  LOCATOR_SVG,
  accumulateRotation,
  beamPath,
  locatorView,
} from './locator.js';

describe('accumulateRotation', () => {
  test('the first reading is taken as-is', () => {
    expect(accumulateRotation(null, 90)).toBe(90);
  });

  test('359° to 1° turns 2° forward, not 358° back', () => {
    expect(accumulateRotation(359, 1)).toBe(361);
  });

  test('1° to 359° turns 2° back, not 358° forward', () => {
    expect(accumulateRotation(1, 359)).toBe(-1);
  });

  test('keeps accumulating across full turns', () => {
    // Three quarter-turns past a wrap: the cumulative angle keeps growing so
    // a CSS transition never spins the long way round.
    let angle = accumulateRotation(null, 350);
    angle = accumulateRotation(angle, 80);
    expect(angle).toBe(440);
    angle = accumulateRotation(angle, 170);
    expect(angle).toBe(530);
  });

  test('a same-heading tick is a no-op', () => {
    expect(accumulateRotation(720, 0)).toBe(720);
  });
});

describe('locatorView', () => {
  test('no compass means no beam at all — the honest representation of not knowing', () => {
    expect(locatorView({ heading: null, stale: false }).beam).toBeNull();
  });

  test('a trusted heading gets the narrow beam at full strength', () => {
    const view = locatorView({
      heading: { headingDeg: 142, headingAccuracyDeg: 10 },
      stale: false,
    });

    expect(view.beam.rotationDeg).toBe(142);
    expect(view.beam.arcDeg).toBe(BEAM_MIN_DEG);
    expect(view.beam.opacity).toBe(1);
  });

  test('the beam opens and fades as the compass degrades — its width is the uncertainty', () => {
    // A magnetometer next to a Land Rover door is wrong by a lot, and a
    // narrow confident beam would be a lie told at exactly the moment it
    // costs someone a walk in the wrong direction.
    const good = locatorView({ heading: { headingDeg: 0, headingAccuracyDeg: 15 }, stale: false });
    const mid = locatorView({ heading: { headingDeg: 0, headingAccuracyDeg: 37.5 }, stale: false });
    const bad = locatorView({ heading: { headingDeg: 0, headingAccuracyDeg: 60 }, stale: false });

    expect(good.beam.arcDeg).toBe(BEAM_MIN_DEG);
    expect(bad.beam.arcDeg).toBe(BEAM_MAX_DEG);
    expect(mid.beam.arcDeg).toBeGreaterThan(good.beam.arcDeg);
    expect(mid.beam.arcDeg).toBeLessThan(bad.beam.arcDeg);
    expect(bad.beam.opacity).toBeLessThan(mid.beam.opacity);
    expect(mid.beam.opacity).toBeLessThan(good.beam.opacity);
  });

  test('an unknown accuracy shows the widest, faintest beam, never a confident one', () => {
    // The absolute+alpha fallback reports no accuracy figure at all.
    const view = locatorView({
      heading: { headingDeg: 90, headingAccuracyDeg: null },
      stale: false,
    });

    expect(view.beam.arcDeg).toBe(BEAM_MAX_DEG);
    expect(view.beam.opacity).toBeLessThan(1);
    // Faintest still has to be legible in sunlight: the floor is half, not
    // a third (field report 2026-09-04).
    expect(view.beam.opacity).toBeCloseTo(0.5);
  });

  test('staleness travels with the view', () => {
    expect(locatorView({ heading: null, stale: true }).stale).toBe(true);
    expect(locatorView({ heading: null, stale: false }).stale).toBe(false);
  });
});

describe('beamPath', () => {
  test('a 60° wedge matches the design file geometry', () => {
    // locator.svg ships M80,80 L49,26.3 A62,62 0 0,1 111,26.3 Z — ±31 in x,
    // 26.3 in y, at radius 62 about the 80,80 centre.
    const d = beamPath(60);

    expect(d).toMatch(/^M80,80 L49,26\.3\d* A62,62 0 0,1 111,26\.3\d* Z$/);
  });

  test('a 120° wedge spreads to the diagonals', () => {
    const d = beamPath(120);
    // sin(60°)·62 ≈ 53.7, cos(60°)·62 = 31.
    expect(d).toContain('L26.3');
    expect(d).toContain('49');
  });
});

describe('LOCATOR_SVG', () => {
  test('draws casing before strokes, carries the state hooks, and leaves accuracy to the ring layer', () => {
    // Every paper stroke sits on a 6px ink casing drawn first — what makes
    // the mark hold on pale vector and dark aerial alike, same trick as the
    // trace-line casings. The accuracy circle is NOT here: it stays the
    // existing circle layer, where metres-to-pixels already works.
    expect(LOCATOR_SVG.indexOf('locator-casing')).toBeLessThan(
      LOCATOR_SVG.indexOf('locator-stroke'),
    );
    for (const id of ['locator-beam', 'locator-beam-path', 'locator-fix']) {
      expect(LOCATOR_SVG).toContain(`id="${id}"`);
    }
    expect(LOCATOR_SVG).not.toContain('locator-accuracy');
    // No N label: the map never rotates, so the top of the screen already is
    // north — the four ticks carry the station reading.
    expect(LOCATOR_SVG).not.toMatch(/>N</);
  });

  test('the beam carries its own casing and stroke, inside the rotating group', () => {
    // Field report 2026-09-04: a soft gradient fill vanishes in sunlight, an
    // edge survives. So the wedge gets the ring's own treatment — a dark
    // casing then a pale stroke — and both must rotate with the fill, which
    // means living inside #locator-beam, not the static casing/stroke groups.
    const group = LOCATOR_SVG.indexOf('id="locator-beam"');
    const casing = LOCATOR_SVG.indexOf('locator-beam-casing');
    const stroke = LOCATOR_SVG.indexOf('locator-beam-stroke');
    const staticCasing = LOCATOR_SVG.indexOf('class="locator-casing"');
    expect(group).toBeGreaterThan(-1);
    expect(casing).toBeGreaterThan(group);
    expect(stroke).toBeGreaterThan(casing);
    expect(staticCasing).toBeGreaterThan(stroke);
  });

  test('the beam fill never fades to nothing at the rim', () => {
    // The rim is where the outline sits; zero fill behind it reads as a
    // hollow wedge, not a beam.
    const stops = [...LOCATOR_SVG.matchAll(/stop-opacity="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(stops).toHaveLength(2);
    expect(stops[1]).toBeGreaterThan(0.2);
    expect(stops[0]).toBeGreaterThan(stops[1]);
  });
});
