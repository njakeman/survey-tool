import { basename, extname } from 'node:path';
import { open } from 'node:fs/promises';
import { PMTiles, TileType } from 'pmtiles';

// Reading basemap archives well enough to publish a manifest entry. Node-only
// (it takes file handles), which is why it lives apart from the app's
// ArrayBufferSource — and why it exists at all: that source holds the whole
// archive in memory, which is fine for one downloaded region on a phone and
// wasteful for a build step scanning several hundred-megabyte files.

// A pmtiles `Source` over an open file, reading only the requested window.
// Same two-method contract as src/map/pmtilesSource.js.
export class FileHandleSource {
  constructor(handle, key) {
    this.handle = handle;
    this.key = key;
  }

  getKey() {
    return this.key;
  }

  async getBytes(offset, length) {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await this.handle.read(buffer, 0, length, offset);
    // Clamp like a slice would: a read past the end returns what exists.
    return { data: buffer.buffer.slice(0, bytesRead) };
  }
}

export function regionNameFromFilename(filename) {
  return basename(filename, extname(filename))
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function describeArchive(path, urlPrefix = 'basemaps') {
  const handle = await open(path);
  try {
    const { size } = await handle.stat();
    const archive = new PMTiles(new FileHandleSource(handle, path));
    const header = await archive.getHeader();

    if (header.tileType !== TileType.Mvt) {
      throw new Error(`${path}: not a vector (MVT) archive — MapLibre cannot render it`);
    }

    const id = basename(path, extname(path));
    return {
      id,
      name: regionNameFromFilename(path),
      url: `${urlPrefix}/${basename(path)}`,
      sizeBytes: size,
      bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
      minZoom: header.minZoom,
      maxZoom: header.maxZoom,
    };
  } finally {
    await handle.close();
  }
}
