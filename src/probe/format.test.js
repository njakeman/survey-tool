import { describe, expect, test } from 'vitest';
import { formatBytes, formatDuration, describeRecording } from './format.js';

describe('formatBytes', () => {
  test('formats bytes under 1024 as bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  test('formats kilobytes to one decimal place', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  test('formats megabytes to one decimal place', () => {
    expect(formatBytes(12_300_000)).toBe('11.7 MB');
  });

  test('formats gigabytes to one decimal place', () => {
    expect(formatBytes(61_200_000_000)).toBe('57.0 GB');
  });

  test('formats zero as 0 B', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  test('formats an unknown (undefined) size as a dash', () => {
    expect(formatBytes(undefined)).toBe('—');
  });
});

describe('formatDuration', () => {
  test('formats sub-second durations in milliseconds', () => {
    expect(formatDuration(842)).toBe('842 ms');
  });

  test('formats durations of a second or more in seconds to two decimal places', () => {
    expect(formatDuration(1834)).toBe('1.83 s');
  });
});

describe('describeRecording', () => {
  test('reports the type, the bytes, the duration and the projected rate', () => {
    // The per-minute figure is the number the voice-note decision actually
    // rests on — three seconds of test audio means nothing on its own.
    expect(describeRecording({ mimeType: 'audio/mp4', bytes: 71_000, ms: 3000 })).toBe(
      'audio/mp4 · 69.3 KB in 3.00 s ≈ 1.4 MB/min',
    );
  });

  test('projects from the real duration, not an assumed one', () => {
    // Twice as long for the same bytes is half the rate.
    expect(describeRecording({ mimeType: 'audio/mp4', bytes: 71_000, ms: 6000 })).toContain(
      '0.7 MB/min',
    );
  });

  test('says so when the recording came back empty', () => {
    // The specific reported iOS failure: getUserMedia resolves, MediaRecorder
    // runs, and nothing comes out. That is a completely different problem from
    // a denial and must not read as a small file.
    expect(describeRecording({ mimeType: 'audio/mp4', bytes: 0, ms: 3000 })).toMatch(/no audio/i);
  });

  test('survives a zero duration rather than dividing by it', () => {
    expect(describeRecording({ mimeType: 'audio/mp4', bytes: 1000, ms: 0 })).not.toMatch(
      /Infinity|NaN/,
    );
  });
});
