import { describe, expect, test } from 'vitest';
import { jpegSegmentMap, lensBand, parseCameraExif, readCameraExif } from './exif.js';

// A synthetic JPEG with a real APP1/EXIF segment, built byte by byte so the
// reader is tested against the format, not against a camera's habits. Shape:
// SOI, optional APP0 (JFIF), APP1 "Exif\0\0" + TIFF (IFD0 → Exif sub-IFD),
// then a fake SOS and EOI. Same idea as encode.browser.test.js's
// withExifOrientation6, generalised to both byte orders and two IFDs.

const TAG = {
  MAKE: 0x010f,
  MODEL: 0x0110,
  ORIENTATION: 0x0112,
  EXIF_IFD: 0x8769,
  FOCAL_LENGTH: 0x920a,
  FOCAL_35MM: 0xa405,
  LENS_MODEL: 0xa434,
};
const TYPE = { ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5 };

function buildTiff(entriesIfd0, entriesExif, { littleEndian = true } = {}) {
  // Layout: header (8) | IFD0 | Exif IFD | data area. Every entry is 12 bytes;
  // values over 4 bytes go to the data area and the entry carries an offset.
  const ifd0Count = entriesIfd0.length + (entriesExif.length ? 1 : 0);
  const ifd0Start = 8;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const exifStart = ifd0Start + ifd0Size;
  const exifSize = entriesExif.length ? 2 + entriesExif.length * 12 + 4 : 0;
  let dataCursor = exifStart + exifSize;
  const dataChunks = [];

  function encodeValue(entry) {
    if (entry.type === TYPE.ASCII) {
      const bytes = new TextEncoder().encode(entry.value + '\0');
      return { count: bytes.length, bytes };
    }
    if (entry.type === TYPE.SHORT) {
      const bytes = new Uint8Array(2);
      new DataView(bytes.buffer).setUint16(0, entry.value, littleEndian);
      return { count: 1, bytes };
    }
    if (entry.type === TYPE.LONG) {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setUint32(0, entry.value, littleEndian);
      return { count: 1, bytes };
    }
    // RATIONAL: numerator / denominator, two LONGs.
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, entry.value[0], littleEndian);
    view.setUint32(4, entry.value[1], littleEndian);
    return { count: 1, bytes };
  }

  function writeIfd(view, start, entries, extra) {
    const all = [...entries, ...extra];
    view.setUint16(start, all.length, littleEndian);
    all.forEach((entry, index) => {
      const at = start + 2 + index * 12;
      view.setUint16(at, entry.tag, littleEndian);
      view.setUint16(at + 2, entry.type, littleEndian);
      const { count, bytes } = encodeValue(entry);
      view.setUint32(at + 4, count, littleEndian);
      if (bytes.length <= 4) {
        new Uint8Array(view.buffer, at + 8, bytes.length).set(bytes);
      } else {
        view.setUint32(at + 8, dataCursor, littleEndian);
        dataChunks.push({ at: dataCursor, bytes });
        dataCursor += bytes.length + (bytes.length % 2);
      }
    });
    view.setUint32(start + 2 + all.length * 12, 0, littleEndian);
  }

  // Two passes: sizes first (data area length), then the real write.
  const probe = new DataView(new ArrayBuffer(4096));
  const savedCursor = dataCursor;
  writeIfd(
    probe,
    ifd0Start,
    entriesIfd0,
    entriesExif.length ? [{ tag: TAG.EXIF_IFD, type: TYPE.LONG, value: exifStart }] : [],
  );
  if (entriesExif.length) writeIfd(probe, exifStart, entriesExif, []);
  const total = dataCursor;
  dataCursor = savedCursor;
  dataChunks.length = 0;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, ifd0Start, littleEndian);
  writeIfd(
    view,
    ifd0Start,
    entriesIfd0,
    entriesExif.length ? [{ tag: TAG.EXIF_IFD, type: TYPE.LONG, value: exifStart }] : [],
  );
  if (entriesExif.length) writeIfd(view, exifStart, entriesExif, []);
  for (const chunk of dataChunks) bytes.set(chunk.bytes, chunk.at);
  return bytes;
}

function segment(marker, payload) {
  const out = new Uint8Array(4 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  new DataView(out.buffer).setUint16(2, payload.length + 2, false);
  out.set(payload, 4);
  return out;
}

function buildJpeg({
  ifd0 = [],
  exif = [],
  littleEndian = true,
  jfifFirst = false,
  noApp1 = false,
}) {
  const parts = [new Uint8Array([0xff, 0xd8])];
  if (jfifFirst) {
    parts.push(
      segment(0xe0, new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])),
    );
  }
  if (!noApp1) {
    const tiff = buildTiff(ifd0, exif, { littleEndian });
    const payload = new Uint8Array(6 + tiff.length);
    payload.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0);
    payload.set(tiff, 6);
    parts.push(segment(0xe1, payload));
  }
  // A fake SOS then EOI — the reader must stop at SOS, never scan image data.
  parts.push(segment(0xda, new Uint8Array([0x01, 0x01, 0x00, 0x3f, 0x00])));
  parts.push(new Uint8Array([0xff, 0xd9]));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

const IPHONE_ULTRAWIDE = {
  ifd0: [
    { tag: TAG.MAKE, type: TYPE.ASCII, value: 'Apple' },
    { tag: TAG.MODEL, type: TYPE.ASCII, value: 'iPhone 15 Pro' },
    { tag: TAG.ORIENTATION, type: TYPE.SHORT, value: 6 },
  ],
  exif: [
    { tag: TAG.FOCAL_LENGTH, type: TYPE.RATIONAL, value: [2220, 1000] },
    { tag: TAG.FOCAL_35MM, type: TYPE.SHORT, value: 13 },
    {
      tag: TAG.LENS_MODEL,
      type: TYPE.ASCII,
      value: 'iPhone 15 Pro back triple camera 2.22mm f/2.2',
    },
  ],
};

describe('parseCameraExif', () => {
  test('reads make, model, focal length, 35 mm equivalent and lens model (little-endian)', () => {
    const result = parseCameraExif(buildJpeg(IPHONE_ULTRAWIDE));

    expect(result).toEqual({
      make: 'Apple',
      model: 'iPhone 15 Pro',
      focalLengthMm: 2.22,
      focalLength35mm: 13,
      lensModel: 'iPhone 15 Pro back triple camera 2.22mm f/2.2',
      exifBlock: true,
    });
  });

  test('a WebKit camera-UI re-encode: an Exif block with only orientation is "block, no tags"', () => {
    // The live finding (2026-09-04): image.jpg, APP1 of 140 bytes holding
    // orientation/resolution and nothing about the camera. The block parsed;
    // the lens is simply not there — and the probe must say exactly that.
    const result = parseCameraExif(
      buildJpeg({ ifd0: [{ tag: TAG.ORIENTATION, type: TYPE.SHORT, value: 6 }], exif: [] }),
    );

    expect(result.exifBlock).toBe(true);
    expect(result.focalLength35mm).toBeNull();
    expect(result.lensModel).toBeNull();
  });

  test('reads the same tags in big-endian (Motorola) byte order', () => {
    const result = parseCameraExif(buildJpeg({ ...IPHONE_ULTRAWIDE, littleEndian: false }));

    expect(result.focalLength35mm).toBe(13);
    expect(result.focalLengthMm).toBe(2.22);
    expect(result.lensModel).toContain('2.22mm');
    expect(result.make).toBe('Apple');
  });

  test('finds APP1 behind a JFIF APP0 segment', () => {
    const result = parseCameraExif(buildJpeg({ ...IPHONE_ULTRAWIDE, jfifFirst: true }));

    expect(result.focalLength35mm).toBe(13);
  });

  test('a short inline value and a long offset value both read correctly', () => {
    // Make ("Sony", 5 bytes with the NUL) is over the 4-byte inline limit;
    // a 3-byte model ("A1\0") fits inline.
    const result = parseCameraExif(
      buildJpeg({
        ifd0: [
          { tag: TAG.MAKE, type: TYPE.ASCII, value: 'Sony' },
          { tag: TAG.MODEL, type: TYPE.ASCII, value: 'A1' },
        ],
        exif: [{ tag: TAG.FOCAL_35MM, type: TYPE.SHORT, value: 85 }],
      }),
    );

    expect(result.make).toBe('Sony');
    expect(result.model).toBe('A1');
    expect(result.focalLength35mm).toBe(85);
  });

  test('every field is null when a tag is absent', () => {
    const result = parseCameraExif(
      buildJpeg({ ifd0: [{ tag: TAG.MAKE, type: TYPE.ASCII, value: 'Apple' }], exif: [] }),
    );

    expect(result).toEqual({
      make: 'Apple',
      model: null,
      focalLengthMm: null,
      focalLength35mm: null,
      lensModel: null,
      exifBlock: true,
    });
  });

  test('no APP1 at all — the canvas-re-encoded case — is all null, not an error', () => {
    expect(parseCameraExif(buildJpeg({ noApp1: true }))).toEqual({
      make: null,
      model: null,
      focalLengthMm: null,
      focalLength35mm: null,
      lensModel: null,
      exifBlock: false,
    });
  });

  test('a truncated or non-JPEG buffer is all null, never a throw', () => {
    const whole = new Uint8Array(buildJpeg(IPHONE_ULTRAWIDE));
    for (const length of [0, 1, 2, 5, 20, 40]) {
      expect(() => parseCameraExif(whole.slice(0, length).buffer)).not.toThrow();
      expect(parseCameraExif(whole.slice(0, length).buffer).focalLength35mm).toBeNull();
    }
    expect(
      parseCameraExif(new TextEncoder().encode('not a jpeg').buffer).focalLength35mm,
    ).toBeNull();
  });

  test('a zero denominator or a zero focal length is null, not Infinity or 0', () => {
    const result = parseCameraExif(
      buildJpeg({
        exif: [
          { tag: TAG.FOCAL_LENGTH, type: TYPE.RATIONAL, value: [24, 0] },
          { tag: TAG.FOCAL_35MM, type: TYPE.SHORT, value: 0 },
        ],
      }),
    );

    expect(result.focalLengthMm).toBeNull();
    expect(result.focalLength35mm).toBeNull();
  });
});

describe('readCameraExif', () => {
  test('reads a Blob, slicing only the head of a large file', async () => {
    const head = new Uint8Array(buildJpeg(IPHONE_ULTRAWIDE));
    // A megabyte of "image data" after the segments: the reader must not
    // need it, and must not choke on it.
    const blob = new Blob([head, new Uint8Array(1_000_000)], { type: 'image/jpeg' });

    const result = await readCameraExif(blob);

    expect(result.focalLength35mm).toBe(13);
    expect(result.lensModel).toContain('2.22mm');
  });

  test('a blob that fails to read yields nulls rather than rejecting', async () => {
    const broken = { slice: () => ({ arrayBuffer: () => Promise.reject(new Error('gone')) }) };

    await expect(readCameraExif(broken)).resolves.toEqual({
      make: null,
      model: null,
      focalLengthMm: null,
      focalLength35mm: null,
      lensModel: null,
      exifBlock: false,
    });
  });
});

describe('lensBand', () => {
  test('bands a 35 mm-equivalent focal length by the lens a phone surveyor would name', () => {
    expect(lensBand(13)).toBe('ultra-wide');
    expect(lensBand(19)).toBe('ultra-wide');
    expect(lensBand(20)).toBe('wide');
    expect(lensBand(24)).toBe('wide');
    expect(lensBand(26)).toBe('wide');
    expect(lensBand(35)).toBe('wide');
    expect(lensBand(36)).toBe('standard');
    expect(lensBand(48)).toBe('standard');
    expect(lensBand(60)).toBe('standard');
    expect(lensBand(61)).toBe('telephoto');
    expect(lensBand(77)).toBe('telephoto');
    expect(lensBand(120)).toBe('telephoto');
  });

  test('null, zero and nonsense are null', () => {
    expect(lensBand(null)).toBeNull();
    expect(lensBand(undefined)).toBeNull();
    expect(lensBand(0)).toBeNull();
    expect(lensBand(NaN)).toBeNull();
  });
});

describe('jpegSegmentMap', () => {
  // The diagnostic behind the probe row: which segments a file actually has,
  // so "no EXIF found" can be told apart from "EXIF present but the reader
  // missed it" on the phone, where there is no other way to look inside.
  test('lists the markers in order with their lengths, and whether "Exif" occurs at all', () => {
    const map = jpegSegmentMap(buildJpeg({ ...IPHONE_ULTRAWIDE, jfifFirst: true }));

    expect(map.segments.map((s) => s.marker)).toEqual(['APP0', 'APP1', 'SOS']);
    expect(map.segments[0].length).toBe(16);
    expect(map.segments[1].length).toBeGreaterThan(40);
    expect(map.exifString).toBe(true);
  });

  test('a stripped file shows no APP segments and no Exif string', () => {
    const map = jpegSegmentMap(buildJpeg({ noApp1: true }));

    expect(map.segments.map((s) => s.marker)).toEqual(['SOS']);
    expect(map.exifString).toBe(false);
  });

  test('a non-JPEG is an empty map, not a throw', () => {
    expect(jpegSegmentMap(new TextEncoder().encode('nope').buffer)).toEqual({
      jpeg: false,
      segments: [],
      exifString: false,
    });
  });

  test('unknown markers are named by their hex code', () => {
    const bytes = new Uint8Array(buildJpeg({ noApp1: true }));
    // Splice an APP13 (Photoshop IRB) segment after SOI.
    const app13 = new Uint8Array([0xff, 0xed, 0x00, 0x04, 0x00, 0x00]);
    const spliced = new Uint8Array(bytes.length + app13.length);
    spliced.set(bytes.subarray(0, 2), 0);
    spliced.set(app13, 2);
    spliced.set(bytes.subarray(2), 2 + app13.length);

    const map = jpegSegmentMap(spliced.buffer);

    expect(map.segments.map((s) => s.marker)).toEqual(['APP13', 'SOS']);
  });
});
