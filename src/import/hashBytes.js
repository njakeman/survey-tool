// SHA-256 over raw bytes, as lowercase hex. Used to identify the exact
// reference file a revisit was started against. Note what this is not:
// zip bytes are not reproducible (client-zip writes mtimes into local
// headers), so two exports of identical data hash differently — this is
// identification of a picked file, never content-addressing. The
// reproducible artefact remains session.geojson's canonical bytes.

export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
