// Pure aspect-ratio math for the photo downscale pipeline (plan: 1600px long
// edge). Kept separate from the actual canvas/encode work (photo/encode.js,
// browser-only) so this arithmetic is node-testable with zero DOM.

export const MAX_LONG_EDGE = 1600;

export function computeTargetDimensions({ width, height, maxLongEdge = MAX_LONG_EDGE }) {
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`computeTargetDimensions: invalid width (${width})`);
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error(`computeTargetDimensions: invalid height (${height})`);
  }

  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) {
    return { width, height };
  }

  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
