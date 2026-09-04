// The camera facts a captured photo carries, read from the ORIGINAL file.
// photo/encode.js redraws every photo through a canvas and canvas.toBlob
// emits a fresh JPEG with no metadata at all, so the only moment the lens
// is knowable is before the downscale — main.js reads it there and the
// structured result rides the observation's photos[] entry instead of the
// bytes. Pure over an ArrayBuffer (node-testable, like dimensions.js); the
// Blob-reading wrapper below is the one async seam.
//
// Never throws: a malformed or metadata-free file is "nothing found", the
// same degradation rule as the compass. A photo with no lens is still a
// photo.

const SOI = 0xd8;
const APP1 = 0xe1;
const SOS = 0xda;
const EOI = 0xd9;

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_EXIF_IFD = 0x8769;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_FOCAL_35MM = 0xa405;
const TAG_LENS_MODEL = 0xa434;

const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

// APP1 sits directly after SOI (or after a JFIF APP0) on every phone JPEG;
// the head of the file is all the reader ever needs, and a 3–8 MB capture
// need not be copied into memory to find it.
const HEAD_BYTES = 256 * 1024;

const EMPTY = Object.freeze({
  make: null,
  model: null,
  focalLengthMm: null,
  focalLength35mm: null,
  lensModel: null,
});

// 35 mm-equivalent focal length → the lens a phone surveyor would name.
// Deliberately mm plus a word rather than a ×-number: 1× is 24 mm on some
// phones and 26 mm on others, so a ratio would mislead across devices,
// while the mm figure is universal and the band answers "which lens".
export function lensBand(focalLength35mm) {
  if (!Number.isFinite(focalLength35mm) || focalLength35mm <= 0) return null;
  if (focalLength35mm < 20) return 'ultra-wide';
  if (focalLength35mm <= 35) return 'wide';
  if (focalLength35mm <= 60) return 'standard';
  return 'telephoto';
}

// Find the TIFF block inside the first APP1 "Exif" segment, walking JPEG
// segments from SOI and stopping at SOS — image data is never scanned.
function findTiff(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return null;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === SOS || marker === EOI) return null;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) return null;
    const payloadStart = at + 4;
    const payloadEnd = at + 2 + length;
    if (marker === APP1 && payloadEnd <= bytes.length) {
      const isExif =
        bytes[payloadStart] === 0x45 && // E
        bytes[payloadStart + 1] === 0x78 && // x
        bytes[payloadStart + 2] === 0x69 && // i
        bytes[payloadStart + 3] === 0x66 && // f
        bytes[payloadStart + 4] === 0 &&
        bytes[payloadStart + 5] === 0;
      if (isExif) return { start: payloadStart + 6, end: payloadEnd };
    }
    at = payloadEnd;
  }
  return null;
}

function readAscii(bytes, start, count) {
  let end = start + count;
  while (end > start && bytes[end - 1] === 0) end -= 1;
  const text = new TextDecoder('latin1').decode(bytes.subarray(start, end)).trim();
  return text.length > 0 ? text : null;
}

// Reads one IFD's entries into a Map of tag → decoded value. Every access is
// bounds-checked against the TIFF block; an entry that points outside it is
// skipped, not trusted.
function readIfd(view, bytes, tiffStart, tiffEnd, ifdOffset, littleEndian) {
  const values = new Map();
  const ifdStart = tiffStart + ifdOffset;
  if (ifdStart + 2 > tiffEnd) return values;
  const count = view.getUint16(ifdStart, littleEndian);
  for (let index = 0; index < count; index += 1) {
    const at = ifdStart + 2 + index * 12;
    if (at + 12 > tiffEnd) break;
    const tag = view.getUint16(at, littleEndian);
    const type = view.getUint16(at + 2, littleEndian);
    const n = view.getUint32(at + 4, littleEndian);
    const size =
      type === TYPE_ASCII
        ? n
        : type === TYPE_SHORT
          ? 2 * n
          : type === TYPE_LONG
            ? 4 * n
            : type === TYPE_RATIONAL
              ? 8 * n
              : 0;
    if (size === 0) continue;
    const valueAt = size <= 4 ? at + 8 : tiffStart + view.getUint32(at + 8, littleEndian);
    if (valueAt < tiffStart || valueAt + size > tiffEnd) continue;
    if (type === TYPE_ASCII) {
      values.set(tag, readAscii(bytes, valueAt, n));
    } else if (type === TYPE_SHORT) {
      values.set(tag, view.getUint16(valueAt, littleEndian));
    } else if (type === TYPE_LONG) {
      values.set(tag, view.getUint32(valueAt, littleEndian));
    } else if (type === TYPE_RATIONAL) {
      const numerator = view.getUint32(valueAt, littleEndian);
      const denominator = view.getUint32(valueAt + 4, littleEndian);
      values.set(tag, denominator === 0 ? null : numerator / denominator);
    }
  }
  return values;
}

function positiveOrNull(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseCameraExif(arrayBuffer) {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    const tiff = findTiff(bytes);
    if (!tiff || tiff.end - tiff.start < 8) return { ...EMPTY };
    const view = new DataView(arrayBuffer);
    const order = view.getUint16(tiff.start, false);
    const littleEndian = order === 0x4949;
    if (!littleEndian && order !== 0x4d4d) return { ...EMPTY };
    if (view.getUint16(tiff.start + 2, littleEndian) !== 42) return { ...EMPTY };
    const ifd0Offset = view.getUint32(tiff.start + 4, littleEndian);
    const ifd0 = readIfd(view, bytes, tiff.start, tiff.end, ifd0Offset, littleEndian);
    const exifOffset = ifd0.get(TAG_EXIF_IFD);
    const exif = Number.isFinite(exifOffset)
      ? readIfd(view, bytes, tiff.start, tiff.end, exifOffset, littleEndian)
      : new Map();
    const focalLengthMm = positiveOrNull(exif.get(TAG_FOCAL_LENGTH));
    return {
      make: ifd0.get(TAG_MAKE) ?? null,
      model: ifd0.get(TAG_MODEL) ?? null,
      // Rounded to two decimals: 2.2200000000000002 is a float artefact, not
      // a lens fact, and it would ride into the export.
      focalLengthMm: focalLengthMm === null ? null : Math.round(focalLengthMm * 100) / 100,
      focalLength35mm: positiveOrNull(exif.get(TAG_FOCAL_35MM)),
      lensModel: exif.get(TAG_LENS_MODEL) ?? null,
    };
  } catch {
    return { ...EMPTY };
  }
}

// The async seam: the head of a Blob/File, then the pure parser. A read
// failure is nulls, not a rejection — this runs alongside the downscale on
// every shot and must never be the reason a photo is lost.
export async function readCameraExif(blob) {
  try {
    const head = await blob.slice(0, HEAD_BYTES).arrayBuffer();
    return parseCameraExif(head);
  } catch {
    return { ...EMPTY };
  }
}
