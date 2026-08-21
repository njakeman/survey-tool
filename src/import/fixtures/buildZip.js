// A minimal zip *writer* for tests only, existing to feed the reader known
// structures — including the shape that matters most: client-zip's streaming
// output, whose local headers carry zero sizes (flag bit 3, data descriptor)
// and only the central directory tells the truth. The browser tier
// round-trips real client-zip bytes; these fixtures let the node tier cover
// the format corners deterministically. Shared by zipReader, reference-zip
// and parse tests; never imported by app code.

import { deflateRawSync } from 'node:zlib';

const encoder = new TextEncoder();

export function bytesOf(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16(value) {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

function u32(value) {
  return new Uint8Array([
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ]);
}

export function buildZip(files, { method = 'store', dataDescriptor = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = encoder.encode(name);
    const raw = typeof data === 'string' ? encoder.encode(data) : data;
    const stored = method === 'deflate' ? new Uint8Array(deflateRawSync(raw)) : raw;
    const methodCode = method === 'deflate' ? 8 : 0;
    const flags = dataDescriptor ? 0x0008 : 0;
    // A streaming writer does not know the sizes when it emits the local
    // header, so it writes zeros and appends a data descriptor after the
    // data. The reader must never trust these fields.
    const localSizes = dataDescriptor
      ? { csize: 0, usize: 0 }
      : { csize: stored.length, usize: raw.length };

    const local = bytesOf([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(methodCode),
      u16(0),
      u16(0),
      u32(0),
      u32(localSizes.csize),
      u32(localSizes.usize),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      stored,
      ...(dataDescriptor ? [u32(0x08074b50), u32(0), u32(stored.length), u32(raw.length)] : []),
    ]);
    const central = bytesOf([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(flags),
      u16(methodCode),
      u16(0),
      u16(0),
      u32(0),
      u32(stored.length),
      u32(raw.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralBytes = bytesOf(centrals);
  const eocd = bytesOf([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);
  return bytesOf([...locals, centralBytes, eocd]).buffer;
}
