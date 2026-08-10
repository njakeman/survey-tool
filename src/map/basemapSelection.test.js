import { describe, expect, test } from 'vitest';
import { coversPosition, chooseActive } from './basemapSelection.js';

const SOUTH = {
  id: 'south',
  name: 'South',
  bounds: [-1, 51, 0.5, 52],
  downloaded: true,
};
const NORTH = {
  id: 'north',
  name: 'North',
  bounds: [-2.5, 53, -1, 54],
  downloaded: true,
};
const NOT_DOWNLOADED = { id: 'wales', name: 'Wales', bounds: [-5, 51, -3, 53], downloaded: false };

const IN_SOUTH = { lat: 51.5, lon: -0.14 };
const IN_NORTH = { lat: 53.8, lon: -1.55 };
const IN_NEITHER = { lat: 57.5, lon: -4.2 };

describe('coversPosition', () => {
  test('true when the fix falls inside the region', () => {
    expect(coversPosition(SOUTH, IN_SOUTH)).toBe(true);
  });

  test('false when the fix is outside', () => {
    expect(coversPosition(SOUTH, IN_NORTH)).toBe(false);
  });

  test('false without a fix or without bounds, rather than guessing', () => {
    expect(coversPosition(SOUTH, null)).toBe(false);
    expect(coversPosition({ ...SOUTH, bounds: null }, IN_SOUTH)).toBe(false);
  });

  test('counts the boundary as covered', () => {
    expect(coversPosition(SOUTH, { lat: 51, lon: -1 })).toBe(true);
  });
});

describe('chooseActive', () => {
  test('uses the remembered selection when it is still on the device', () => {
    const { activeId } = chooseActive({
      regions: [SOUTH, NORTH],
      selectedId: 'north',
      position: null,
    });

    expect(activeId).toBe('north');
  });

  test('falls back to the only downloaded region when nothing is remembered', () => {
    const { activeId } = chooseActive({
      regions: [SOUTH, NOT_DOWNLOADED],
      selectedId: null,
      position: null,
    });

    expect(activeId).toBe('south');
  });

  test('prefers the region covering the fix when nothing is remembered', () => {
    const { activeId } = chooseActive({
      regions: [SOUTH, NORTH],
      selectedId: null,
      position: IN_NORTH,
    });

    expect(activeId).toBe('north');
  });

  test('ignores a remembered region that is no longer downloaded', () => {
    const { activeId } = chooseActive({
      regions: [SOUTH, { ...NORTH, downloaded: false }],
      selectedId: 'north',
      position: null,
    });

    expect(activeId).toBe('south');
  });

  test('active is null when nothing is downloaded at all', () => {
    const { activeId } = chooseActive({
      regions: [NOT_DOWNLOADED],
      selectedId: null,
      position: IN_SOUTH,
    });

    expect(activeId).toBeNull();
  });

  test('suggests the region covering the fix when a different one is active', () => {
    // The offer, never the switch: the surveyor confirms.
    const { activeId, suggestionId } = chooseActive({
      regions: [SOUTH, NORTH],
      selectedId: 'south',
      position: IN_NORTH,
    });

    expect(activeId).toBe('south');
    expect(suggestionId).toBe('north');
  });

  test('suggests nothing when the active region already covers the fix', () => {
    const { suggestionId } = chooseActive({
      regions: [SOUTH, NORTH],
      selectedId: 'south',
      position: IN_SOUTH,
    });

    expect(suggestionId).toBeNull();
  });

  test('suggests nothing without a fix', () => {
    const { suggestionId } = chooseActive({
      regions: [SOUTH, NORTH],
      selectedId: 'south',
      position: null,
    });

    expect(suggestionId).toBeNull();
  });

  test('never suggests a region that is not downloaded — it could not be shown offline', () => {
    const { suggestionId } = chooseActive({
      regions: [SOUTH, NOT_DOWNLOADED],
      selectedId: 'south',
      position: { lat: 52, lon: -4 },
    });

    expect(suggestionId).toBeNull();
  });

  test('suggests nothing when the fix is outside every downloaded region', () => {
    const { activeId, suggestionId } = chooseActive({
      regions: [SOUTH, NORTH],
      selectedId: 'south',
      position: IN_NEITHER,
    });

    expect(activeId).toBe('south');
    expect(suggestionId).toBeNull();
  });
});
