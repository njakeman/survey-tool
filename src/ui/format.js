// One human file size for the maps-and-layers view, shared by the region list
// and the feature-layer list. Decimal units, because that is how providers
// and manifests describe sizes.
//
// The unit steps down with the value on purpose: a real 403-byte layer
// rounded to "0 kB" reads as broken or empty, and a 400 kB region rounded to
// "0 MB" reads the same — the second was live in the region list until this
// function replaced its MB-only formatter.
// A voice note's length as m:ss — the recording timer, the chip label and
// the transport's elapsed/total all speak the same format.
export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatSize(bytes) {
  if (!bytes) return null;
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} kB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}
