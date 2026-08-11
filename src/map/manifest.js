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

const RASTER_TILE_TYPES = new Set([TileType.Png, TileType.Jpeg, TileType.Webp, TileType.Avif]);

// Web Mercator tile coordinates for a longitude/latitude, so a real tile can
// be located and measured. The archive's corner tile is usually absent — a
// regional extract holds only the tiles covering its own bounds.
function tileCoordinates(lon, lat, zoom) {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n))),
    y: Math.min(
      n - 1,
      Math.max(
        0,
        Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n),
      ),
    ),
  };
}

// Neither PNG nor JPEG records "tile size" as such; it's just the image's own
// width. Nothing in the PMTiles header carries it, and MapLibre needs it —
// assuming 512 when tiles are 256 renders imagery at half scale.
function imageWidth(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: width is the first field of IHDR, always at byte 16.
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return view.getUint32(16);
  }

  // JPEG: walk the marker segments to a start-of-frame, which carries the
  // dimensions. C4/C8/CC are Huffman/arithmetic tables, not frames.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return view.getUint16(offset + 7);
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }

  return null;
}

async function detectTileSize(archive, header) {
  try {
    const { x, y } = tileCoordinates(header.centerLon, header.centerLat, header.minZoom);
    const tile = await archive.getZxy(header.minZoom, x, y);
    if (!tile) return null;
    return imageWidth(new Uint8Array(tile.data));
  } catch {
    return null;
  }
}

export async function describeArchive(path, urlPrefix = 'basemaps') {
  const handle = await open(path);
  try {
    const { size } = await handle.stat();
    const archive = new PMTiles(new FileHandleSource(handle, path));
    const header = await archive.getHeader();

    const isRaster = RASTER_TILE_TYPES.has(header.tileType);
    if (header.tileType !== TileType.Mvt && !isRaster) {
      throw new Error(`${path}: unrecognised tile type ${header.tileType} — cannot render it`);
    }

    return {
      id: basename(path, extname(path)),
      name: regionNameFromFilename(path),
      url: `${urlPrefix}/${basename(path)}`,
      sizeBytes: size,
      bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
      minZoom: header.minZoom,
      maxZoom: header.maxZoom,
      tileType: isRaster ? 'raster' : 'vector',
      // Vector tiles have no pixel size; raster falls back to 256, by far the
      // most common, when no tile can be read to measure.
      tileSize: isRaster ? ((await detectTileSize(archive, header)) ?? 256) : null,
    };
  } finally {
    await handle.close();
  }
}
