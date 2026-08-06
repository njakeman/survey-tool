// Real decode -> canvas draw -> JPEG encode. Browser-only: jsdom/happy-dom
// cannot decode an image or implement canvas.toBlob, so this file must never
// be imported from node- or happy-dom-tier code — only from main.js. All the
// "how big should it be" arithmetic lives in dimensions.js; this file is
// plumbing only.

import { computeTargetDimensions, MAX_LONG_EDGE } from './dimensions.js';

export const JPEG_QUALITY = 0.8;
export const JPEG_TYPE = 'image/jpeg';

// HTMLImageElement, not createImageBitmap: browsers apply EXIF orientation
// to <img> by default, so naturalWidth/Height and the drawImage result are
// already orientation-corrected. iPhone rear-camera JPEGs are routinely
// EXIF orientation 6; createImageBitmap without imageOrientation:'from-image'
// would produce sideways photos and swapped target dimensions.
function defaultDecode(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  return img
    .decode()
    .then(() => ({
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    }))
    .catch(() => {
      URL.revokeObjectURL(url);
      throw new Error('downscaleImageBlob: failed to decode image');
    });
}

function defaultCreateCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function downscaleImageBlob(
  blob,
  {
    maxLongEdge = MAX_LONG_EDGE,
    quality = JPEG_QUALITY,
    decode = defaultDecode,
    createCanvas = defaultCreateCanvas,
  } = {},
) {
  const { source, width, height, release } = await decode(blob);
  try {
    const target = computeTargetDimensions({ width, height, maxLongEdge });
    const canvas = createCanvas(target.width, target.height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, target.width, target.height);

    const outBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error('downscaleImageBlob: canvas encoding failed'));
        },
        JPEG_TYPE,
        quality,
      );
    });

    return { blob: outBlob, width: target.width, height: target.height };
  } finally {
    release();
  }
}
