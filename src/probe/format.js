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
