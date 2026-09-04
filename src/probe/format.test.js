import { describe, expect, test } from 'vitest';
import { formatBytes, formatDuration, describeRecording, describeCameraExif } from './format.js';

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

describe('describeCameraExif', () => {
  // The camera-EXIF probe row: does iOS Safari's camera input hand over the
  // lens tags? Read on the phone, so the line has to say which tags came
  // through and which did not — "nothing" and "no 35 mm figure" are
  // different findings.
  const file = { type: 'image/jpeg', size: 3_200_000 };

  test('names the file, the lens and the band when every tag is present', () => {
    const line = describeCameraExif({
      file,
      camera: {
        make: 'Apple',
        model: 'iPhone 15 Pro',
        focalLengthMm: 2.22,
        focalLength35mm: 13,
        lensModel: 'iPhone 15 Pro back triple camera 2.22mm f/2.2',
      },
    });

    expect(line).toBe(
      'image/jpeg · 3.1 MB · 13 mm eq. (ultra-wide) · 2.22 mm · iPhone 15 Pro back triple camera 2.22mm f/2.2 · Apple iPhone 15 Pro',
    );
  });

  test('says which of the lens tags is missing rather than dropping it silently', () => {
    const line = describeCameraExif({
      file,
      camera: {
        make: null,
        model: null,
        focalLengthMm: 2.22,
        focalLength35mm: null,
        lensModel: null,
      },
    });

    expect(line).toBe('image/jpeg · 3.1 MB · no 35 mm equivalent · 2.22 mm · no lens model');
  });

  test('an EXIF-free file says so in words', () => {
    const line = describeCameraExif({
      file: { type: 'image/heic', size: 1024 },
      camera: {
        make: null,
        model: null,
        focalLengthMm: null,
        focalLength35mm: null,
        lensModel: null,
      },
    });

    expect(line).toBe('image/heic · 1.0 KB · no camera EXIF found');
  });
});

describe('describeCameraExif — the file and its segments', () => {
  // Read on the phone, so the name (image.jpg = WebKit's own camera UI,
  // IMG_1234.jpeg = a library pick) and the segment map ride on the line.
  test('names the file and lists the segments when no EXIF was found', () => {
    const line = describeCameraExif({
      file: { name: 'image.jpg', type: 'image/jpeg', size: 2_400_000 },
      camera: {
        make: null,
        model: null,
        focalLengthMm: null,
        focalLength35mm: null,
        lensModel: null,
      },
      segments: {
        jpeg: true,
        segments: [
          { marker: 'DQT', length: 67 },
          { marker: 'SOF0', length: 17 },
          { marker: 'SOS', length: 12 },
        ],
        exifString: false,
      },
    });

    expect(line).toBe(
      'image.jpg · image/jpeg · 2.3 MB · no camera EXIF found · segments DQT 67, SOF0 17, SOS 12 · no "Exif" bytes in the first 256 KiB',
    );
  });

  test('an Exif block that parsed but held no camera tags says so — the WebKit re-encode', () => {
    // The live finding (2026-09-04): image.jpg with a 140-byte APP1 holding
    // orientation/resolution only. Not a reader miss — there was nothing
    // there — and the line must not claim otherwise.
    const line = describeCameraExif({
      file: { name: 'image.jpg', type: 'image/jpeg', size: 2_800_000 },
      camera: {
        make: null,
        model: null,
        focalLengthMm: null,
        focalLength35mm: null,
        lensModel: null,
        exifBlock: true,
      },
      segments: {
        jpeg: true,
        segments: [
          { marker: 'APP0', length: 16 },
          { marker: 'APP1', length: 140 },
          { marker: 'SOS', length: 12 },
        ],
        exifString: true,
      },
    });

    expect(line).toContain('segments APP0 16, APP1 140, SOS 12');
    expect(line).toContain('Exif block present, no camera tags');
    expect(line).not.toContain('reader missed');
  });

  test('"Exif" bytes with no parsed block is the one case that is a reader bug', () => {
    const line = describeCameraExif({
      file: { name: 'IMG_0007.jpeg', type: 'image/jpeg', size: 2_400_000 },
      camera: {
        make: null,
        model: null,
        focalLengthMm: null,
        focalLength35mm: null,
        lensModel: null,
        exifBlock: false,
      },
      segments: {
        jpeg: true,
        segments: [
          { marker: 'APP1', length: 4096 },
          { marker: 'SOS', length: 12 },
        ],
        exifString: true,
      },
    });

    expect(line).toContain(
      '"Exif" bytes PRESENT but no Exif block parsed — the reader missed them',
    );
  });

  test('a non-JPEG says so', () => {
    const line = describeCameraExif({
      file: { name: 'IMG_0007.heic', type: 'image/heic', size: 1024 },
      camera: {
        make: null,
        model: null,
        focalLengthMm: null,
        focalLength35mm: null,
        lensModel: null,
      },
      segments: { jpeg: false, segments: [], exifString: false },
    });

    expect(line).toBe('IMG_0007.heic · image/heic · 1.0 KB · no camera EXIF found · not a JPEG');
  });
});
