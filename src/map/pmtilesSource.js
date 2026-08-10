// A pmtiles `Source` over an in-memory ArrayBuffer — the bridge between the
// IndexedDB-stored archive (storage/basemapStore.js) and the pmtiles reader.
// The library's own sources read Files or fetch URLs with Range requests;
// ours slices the buffer. Structurally satisfies the Source interface
// (getBytes + getKey) from pmtiles' index.d.ts. slice() copies, matching
// FileSource semantics (and its end-clamping), so callers can never mutate
// or detach the archive out from under the reader.
//
// Pure JS, no browser deps — node-testable, and the real PMTiles reader runs
// over it in basemapArchive.test.js (Node 20 has DecompressionStream).

export class ArrayBufferSource {
  constructor(arrayBuffer, key = 'basemap') {
    this.arrayBuffer = arrayBuffer;
    this.key = key;
  }

  getKey() {
    return this.key;
  }

  async getBytes(offset, length) {
    return { data: this.arrayBuffer.slice(offset, offset + length) };
  }
}
