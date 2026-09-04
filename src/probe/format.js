import { lensBand } from '../photo/exif.js';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const decimals = exponent === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${UNITS[exponent]}`;
}

export function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// What a test recording actually cost, and what a minute of it would.
//
// The projection is the point. Three seconds of audio says nothing about
// whether voice notes are affordable; "1.4 MB/min" against a photo's ~300 KB
// is the comparison the decision rests on, and it has to come from measured
// bytes on the real device rather than from a bitrate the encoder may have
// ignored.
export function describeRecording({ mimeType, bytes, ms }) {
  // getUserMedia resolving and MediaRecorder running and *nothing coming out*
  // is a specific reported iOS failure, and a completely different problem
  // from a denial. It must not read as a very small file.
  if (!bytes) return `${mimeType} · no audio captured (0 bytes)`;

  const size = `${formatBytes(bytes)} in ${formatDuration(ms)}`;
  if (!ms) return `${mimeType} · ${size}`;

  const mbPerMinute = (bytes / 1024 / 1024 / (ms / 1000)) * 60;
  return `${mimeType} · ${size} ≈ ${mbPerMinute.toFixed(1)} MB/min`;
}

// The camera-EXIF probe row, in one line the phone can show. "Nothing" and
// "no 35 mm figure but a physical focal length" are different findings —
// the lens feature can fall back on the second, not the first — so each
// missing tag is named rather than dropped. `size` and `type` come from
// the File the camera input handed over: they say whether iOS gave a JPEG
// or an HEIC, which decides where the tags could even be.
export function describeCameraExif({ file, camera }) {
  const parts = [file.type || 'unknown type', formatBytes(file.size)];
  const { focalLengthMm, focalLength35mm, lensModel, make, model } = camera;
  if (focalLengthMm == null && focalLength35mm == null && !lensModel && !make && !model) {
    parts.push('no camera EXIF found');
    return parts.join(' · ');
  }
  parts.push(
    focalLength35mm != null
      ? `${focalLength35mm} mm eq. (${lensBand(focalLength35mm)})`
      : 'no 35 mm equivalent',
  );
  if (focalLengthMm != null) parts.push(`${focalLengthMm} mm`);
  parts.push(lensModel ?? 'no lens model');
  if (make || model) parts.push([make, model].filter(Boolean).join(' '));
  return parts.join(' · ');
}
