import { describe, expect, test } from 'vitest';
import { downscaleImageBlob, JPEG_TYPE } from './encode.js';

// Real Canvas/Image decode+encode, chromium + webkit (vitest.config.js) —
// jsdom/happy-dom cannot do this, and WebKit is the engine that ships on
// iOS. computeTargetDimensions (photo/dimensions.js) is already proven by
// arithmetic in the node tier; these tests prove the plumbing around it.

function drawTestImage(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // A gradient, not a flat fill — flat colours can compress to near-zero
  // bytes regardless of quality, which would defeat the quality-comparison test.
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#ff0000');
  gradient.addColorStop(0.5, '#00ff00');
  gradient.addColorStop(1, '#0000ff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, JPEG_TYPE, 0.92));
}

function decodedDimensions(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    img
      .decode()
      .then(() => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      })
      .catch((error) => {
        URL.revokeObjectURL(url);
        reject(error);
      });
  });
}

// Hand-builds a JPEG with an EXIF orientation=6 tag ("rotate 90deg CW to
// display correctly") by inserting a minimal APP1/EXIF segment right after
// the SOI marker of an ordinary canvas-generated JPEG. Browsers apply EXIF
// orientation to <img> by default, so a landscape-stored image tagged
// orientation 6 should report portrait naturalWidth/Height.
async function withExifOrientation6(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const tiffBody = new Uint8Array([
    0x49,
    0x49, // byte order: little-endian ("II")
    0x2a,
    0x00, // TIFF magic number 42
    0x08,
    0x00,
    0x00,
    0x00, // offset to IFD0 = 8
    0x01,
    0x00, // IFD0 entry count = 1
    0x12,
    0x01, // tag 0x0112 = Orientation
    0x03,
    0x00, // type 3 = SHORT
    0x01,
    0x00,
    0x00,
    0x00, // count = 1
    0x06,
    0x00,
    0x00,
    0x00, // value = 6, padded to 4 bytes
    0x00,
    0x00,
    0x00,
    0x00, // next IFD offset = 0 (none)
  ]);
  const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const payload = new Uint8Array(exifHeader.length + tiffBody.length);
  payload.set(exifHeader, 0);
  payload.set(tiffBody, exifHeader.length);

  const app1Length = payload.length + 2; // +2 for the length field itself
  const app1 = new Uint8Array(4 + payload.length);
  app1.set([0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff], 0);
  app1.set(payload, 4);

  // bytes[0..2) is the original SOI marker (0xFFD8) — keep it, insert APP1,
  // then the rest of the original JPEG stream.
  const result = new Uint8Array(2 + app1.length + (bytes.length - 2));
  result.set(bytes.subarray(0, 2), 0);
  result.set(app1, 2);
  result.set(bytes.subarray(2), 2 + app1.length);

  return new Blob([result], { type: JPEG_TYPE });
}

describe('downscaleImageBlob', () => {
  test('downscales a large image to the max long edge and produces a smaller JPEG', async () => {
    const source = await drawTestImage(2400, 1200);
    const result = await downscaleImageBlob(source, { maxLongEdge: 1600 });

    expect(result.blob.type).toBe(JPEG_TYPE);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(800);
    expect(result.blob.size).toBeLessThan(source.size);
  });

  test('never upscales — a source already smaller than the max long edge comes back unchanged', async () => {
    const source = await drawTestImage(640, 480);
    const result = await downscaleImageBlob(source, { maxLongEdge: 1600 });

    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
  });

  test('the returned blob actually decodes back to the claimed dimensions', async () => {
    const source = await drawTestImage(2400, 1200);
    const result = await downscaleImageBlob(source, { maxLongEdge: 1600 });

    const decoded = await decodedDimensions(result.blob);
    expect(decoded).toEqual({ width: result.width, height: result.height });
  });

  test('respects EXIF orientation — a landscape-stored, orientation-6-tagged source decodes portrait', async () => {
    const landscapeSource = await drawTestImage(200, 100);
    const rotatedSource = await withExifOrientation6(landscapeSource);

    // Sanity check on the fixture itself before trusting the result below.
    const sourceDecoded = await decodedDimensions(rotatedSource);
    expect(sourceDecoded).toEqual({ width: 100, height: 200 });

    const result = await downscaleImageBlob(rotatedSource, { maxLongEdge: 1600 });

    expect(result.width).toBe(100);
    expect(result.height).toBe(200);
  });

  test('a lower quality setting produces a smaller blob than a higher one for the same source', async () => {
    const source = await drawTestImage(800, 600);

    const low = await downscaleImageBlob(source, { maxLongEdge: 1600, quality: 0.3 });
    const high = await downscaleImageBlob(source, { maxLongEdge: 1600, quality: 0.95 });

    expect(low.blob.size).toBeLessThan(high.blob.size);
  });

  test('rejects rather than hanging on an undecodable blob', async () => {
    const notAnImage = new Blob(['not an image'], { type: 'image/jpeg' });
    await expect(downscaleImageBlob(notAnImage, { maxLongEdge: 1600 })).rejects.toThrow();
  });
});
