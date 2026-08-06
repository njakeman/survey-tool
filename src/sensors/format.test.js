import { describe, expect, test } from 'vitest';
import {
  formatLatLon,
  formatAccuracy,
  accuracyQuality,
  formatAltitude,
  compassPoint,
  formatHeading,
  formatAge,
} from './format.js';

describe('formatLatLon', () => {
  test('formats to 6 decimal places, comma-separated', () => {
    expect(formatLatLon(51.6354123456, -1.9287341234)).toBe('51.635412, -1.928734');
  });

  test('returns an em dash when lat is missing', () => {
    expect(formatLatLon(null, -1.9)).toBe('—');
    expect(formatLatLon(undefined, -1.9)).toBe('—');
  });

  test('returns an em dash when lon is missing', () => {
    expect(formatLatLon(51.6, null)).toBe('—');
  });
});

describe('formatAccuracy', () => {
  test('rounds to the nearest metre with a ± prefix', () => {
    expect(formatAccuracy(8.4)).toBe('±8 m');
  });

  test('returns an em dash when accuracy is missing', () => {
    expect(formatAccuracy(null)).toBe('—');
    expect(formatAccuracy(undefined)).toBe('—');
  });
});

describe('accuracyQuality', () => {
  test('unknown when accuracy is missing', () => {
    expect(accuracyQuality(null)).toBe('unknown');
    expect(accuracyQuality(undefined)).toBe('unknown');
  });

  test('good at and under 10 metres', () => {
    expect(accuracyQuality(10)).toBe('good');
    expect(accuracyQuality(5)).toBe('good');
  });

  test('fair between 10 and 30 metres, inclusive of 30', () => {
    expect(accuracyQuality(10.1)).toBe('fair');
    expect(accuracyQuality(30)).toBe('fair');
  });

  test('poor above 30 metres', () => {
    expect(accuracyQuality(30.1)).toBe('poor');
    expect(accuracyQuality(100)).toBe('poor');
  });
});

describe('formatAltitude', () => {
  test('returns an em dash when altitude is missing', () => {
    expect(formatAltitude(null, null)).toBe('—');
    expect(formatAltitude(undefined, 4)).toBe('—');
  });

  test('shows altitude alone when accuracy is missing', () => {
    expect(formatAltitude(132.4, null)).toBe('132 m');
  });

  test('shows altitude with its accuracy when both are present', () => {
    expect(formatAltitude(132.4, 4.2)).toBe('132 m ±4 m');
  });
});

describe('compassPoint', () => {
  test('returns null for a missing heading', () => {
    expect(compassPoint(null)).toBeNull();
    expect(compassPoint(undefined)).toBeNull();
  });

  test.each([
    [0, 'N'],
    [11.24, 'N'],
    [11.26, 'NNE'],
    [348.75, 'N'],
    [359.9, 'N'],
    [247, 'WSW'],
    [90, 'E'],
    [180, 'S'],
    [270, 'W'],
  ])('maps %s degrees to %s', (deg, point) => {
    expect(compassPoint(deg)).toBe(point);
  });
});

describe('formatHeading', () => {
  test('returns an em dash when heading is missing', () => {
    expect(formatHeading(null)).toBe('—');
  });

  test('formats degrees rounded plus the compass point', () => {
    expect(formatHeading(247)).toBe('247° WSW');
  });
});

describe('formatAge', () => {
  test('just now for anything under 3 seconds', () => {
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(2999)).toBe('just now');
  });

  test('treats negative age (clock skew) as just now', () => {
    expect(formatAge(-500)).toBe('just now');
  });

  test('seconds between 3 and 60 seconds', () => {
    expect(formatAge(3000)).toBe('3 s ago');
    expect(formatAge(12345)).toBe('12 s ago');
    expect(formatAge(59999)).toBe('59 s ago');
  });

  test('minutes from 60 seconds up', () => {
    expect(formatAge(60000)).toBe('1 min ago');
    expect(formatAge(180000)).toBe('3 min ago');
  });
});
