// Reads a zip archive from an ArrayBuffer: `readZip(buffer)` → [{ name,
// data: Uint8Array }]. Pure-ish (DecompressionStream is in every target:
// iOS Safari 16.4+, Node 18+), so the whole reader is node-testable and
// needs no dependency — client-zip, which writes the exports, cannot read.
//
// Entries are located through the central directory at the end of the file,
// not the local headers. That is not an optimisation: client-zip streams its
// output, so its local headers carry zero sizes with the real ones in a data
// descriptor *after* the data — only the central directory knows how long
// anything is. The local header still has to be visited per entry, because
// its extra-field length can differ from the central copy and the data
// starts after it.

const EOCD_SIG = 0x06054b50; // end of central directory
const CENTRAL_SIG = 0x02014b50; // central directory file header
const LOCAL_SIG = 0x04034b50; // local file header
const STORE = 0;
const DEFLATE = 8;

// The EOCD is the last record but not necessarily the last bytes — a zip
// comment of up to 65535 bytes may follow it, so scan backwards.
function findEndOfCentralDirectory(view) {
  const earliest = Math.max(0, view.byteLength - 22 - 65535);
  for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIG) return offset;
  }
  return -1;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The listing half: central-directory walk → [{ name, method, dataStart,
// compressedSize }], no data decoded. Exists so a reference zip's photos can
// be read one at a time (readZipEntry below) instead of inflating the whole
// archive — 41 frames must never go into memory together. Error messages
// keep the readZip: prefix; the pair is one reader, split, and the failures
// are the same failures.
export function listZipEntries(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  if (view.byteLength < 22) throw new Error('readZip: not a zip file — too small');
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) {
    throw new Error('readZip: not a zip file — no end-of-central-directory record');
  }

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CENTRAL_SIG) {
      throw new Error('readZip: corrupt central directory');
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    // Directory entries carry no data worth returning.
    if (name.endsWith('/')) continue;

    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new Error(`readZip: corrupt local header for ${name}`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > view.byteLength) {
      throw new Error(`readZip: entry ${name} runs past the end of the file`);
    }

    entries.push({ name, method, dataStart, compressedSize });
  }

  return entries;
}

// The decoding half: one listed entry → its bytes. The buffer must be the
// same archive the entry was listed from.
export async function readZipEntry(buffer, entry) {
  const bytes = new Uint8Array(buffer);
  const { name, method, dataStart, compressedSize } = entry;

  if (method === STORE) {
    // slice, not subarray: the returned entry must not pin the whole
    // archive buffer in memory through a view over it.
    return bytes.slice(dataStart, dataStart + compressedSize);
  }
  if (method === DEFLATE) {
    return inflateRaw(bytes.subarray(dataStart, dataStart + compressedSize));
  }
  throw new Error(`readZip: unsupported compression method ${method} for ${name}`);
}

export async function readZip(buffer) {
  const entries = [];
  for (const entry of listZipEntries(buffer)) {
    entries.push({ name: entry.name, data: await readZipEntry(buffer, entry) });
  }
  return entries;
}
