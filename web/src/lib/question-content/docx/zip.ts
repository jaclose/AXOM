// ===========================================================================
// Reads a ZIP archive, which is what a .docx file is. No library: the browser
// and Node both inflate with DecompressionStream, and the archive's central
// directory says where everything is. Works in a worker.
//
// Bounded on purpose. A file's declared size is checked before it is
// inflated and again while it is, so a crafted archive cannot fill memory.
// ===========================================================================

export class ZipError extends Error {
  constructor(
    readonly reason: "not-a-zip" | "unsupported" | "too-large" | "corrupt",
    message: string,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

export interface ZipEntry {
  name: string;
  size: number;
  compressedSize: number;
}

export interface ZipArchive {
  entries: readonly ZipEntry[];
  has(name: string): boolean;
  /** Undefined when the archive has no such file. */
  bytes(name: string): Promise<Uint8Array | undefined>;
  text(name: string): Promise<string | undefined>;
}

export interface ZipOptions {
  /** Largest single file that will be inflated. */
  maxEntryBytes?: number;
  /** Replaces DecompressionStream where a webview lacks "deflate-raw". */
  inflateRaw?: (data: Uint8Array, limit: number) => Promise<Uint8Array>;
}

const DEFAULT_MAX_ENTRY_BYTES = 96 * 1024 * 1024;
const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;

let crcTable: Uint32Array | undefined;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) crc = crcTable[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateWithStream(data: Uint8Array, limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new ZipError("unsupported", "This browser cannot open compressed files. Update the browser, or open the file in the AXOM desktop app.");
  }
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new ZipError("too-large", "A file inside the document is larger than the document says it is.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

interface DirectoryRecord extends ZipEntry {
  method: number;
  crc: number;
  offset: number;
}

export async function openZip(input: ArrayBuffer | Uint8Array, options: ZipOptions = {}): Promise<ZipArchive> {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
  const inflate = options.inflateRaw ?? inflateWithStream;

  // The directory's end record sits at the very end, before an optional comment.
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 22 - 0xffff); at -= 1) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new ZipError("not-a-zip", "This is not a Word document: it is not a ZIP archive.");
  const count = view.getUint16(end + 10, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw new ZipError("unsupported", "The document is in a ZIP64 archive, which AXOM does not read.");

  const records = new Map<string, DirectoryRecord>();
  const decoder = new TextDecoder("utf-8");
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > data.length || view.getUint32(at, true) !== DIRECTORY_ENTRY) throw new ZipError("corrupt", "The document's file list is damaged.");
    const flags = view.getUint16(at + 8, true);
    const nameLength = view.getUint16(at + 28, true);
    const name = decoder.decode(data.subarray(at + 46, at + 46 + nameLength));
    if (flags & 1) throw new ZipError("unsupported", "The document is password protected.");
    records.set(name, {
      name,
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }

  const bytes = async (name: string): Promise<Uint8Array | undefined> => {
    const record = records.get(name);
    if (!record) return undefined;
    if (record.size > maxEntryBytes) throw new ZipError("too-large", `${name} is too large to open.`);
    if (record.offset + 30 > data.length || view.getUint32(record.offset, true) !== LOCAL_ENTRY) throw new ZipError("corrupt", `${name} is damaged.`);
    const start = record.offset + 30 + view.getUint16(record.offset + 26, true) + view.getUint16(record.offset + 28, true);
    const packed = data.subarray(start, start + record.compressedSize);
    if (packed.length !== record.compressedSize) throw new ZipError("corrupt", `${name} is cut short.`);
    let out: Uint8Array;
    if (record.method === 0) out = packed.slice();
    else if (record.method === 8) out = await inflate(packed, record.size);
    else throw new ZipError("unsupported", `${name} is packed in a way AXOM does not read.`);
    if (out.length !== record.size || crc32(out) !== record.crc) throw new ZipError("corrupt", `${name} is damaged.`);
    return out;
  };

  return {
    entries: [...records.values()].map(({ name, size, compressedSize }) => ({ name, size, compressedSize })),
    has: (name) => records.has(name),
    bytes,
    text: async (name) => {
      const found = await bytes(name);
      return found ? new TextDecoder("utf-8").decode(found) : undefined;
    },
  };
}
