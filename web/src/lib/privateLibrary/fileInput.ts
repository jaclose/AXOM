import type { JSZipObject } from "jszip";
import { INPUT_LIMITS, INPUT_MAX_TOTAL_BYTES, resolveLibraryInputRoot, safeInputPath, type LibraryInputEntry, type LibraryInputLimits } from "./inputRoot";
import { resolveLibraryReader } from "./nativeInput";
import { indexLibraryZip } from "./zipIndex";

type Reader = (path: string) => Promise<Uint8Array>;
/** JSZip exposes this documented API at runtime, but omits it from JSZipObject. */
interface ByteStream {
  on(event: "data", callback: (chunk: Uint8Array) => void): ByteStream;
  on(event: "error", callback: (error: unknown) => void): ByteStream;
  on(event: "end", callback: () => void): ByteStream;
  pause(): void;
  resume(): void;
}
type StreamingZipObject = JSZipObject & {
  internalStream?: (type: "uint8array") => ByteStream;
};
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let next = value;
  for (let bit = 0; bit < 8; bit++) next = next & 1 ? 0xedb88320 ^ (next >>> 1) : next >>> 1;
  return next >>> 0;
});

/** Bound actual expansion, not just the archive's untrusted size claim. */
export function readZipEntry(item: JSZipObject, expected: number, crc: number, consume: (length: number) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const streaming = item as StreamingZipObject;
    if (typeof streaming.internalStream !== "function") {
      reject(new Error("This ZIP reader cannot stream safely. Extract the collection and choose its folder."));
      return;
    }
    const stream = streaming.internalStream("uint8array"), chunks: Uint8Array[] = [];
    let length = 0, checksum = 0xffffffff, settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; stream.pause(); chunks.length = 0; reject(error);
    };
    stream.on("data", chunk => {
      if (settled) return;
      try {
        length += chunk.length;
        if (length > expected) throw new Error("A ZIP entry expands beyond its declared size. No collection was installed.");
        consume(chunk.length);
        for (const byte of chunk) checksum = crcTable[(checksum ^ byte) & 255] ^ (checksum >>> 8);
        chunks.push(chunk);
      } catch (error) { fail(error); }
    }).on("error", fail).on("end", () => {
      if (settled) return;
      if (length !== expected || ((checksum ^ 0xffffffff) >>> 0) !== crc) { fail(new Error("A ZIP entry failed its integrity check. Re-export the collection.")); return; }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      settled = true; chunks.length = 0; resolve(bytes);
    });
    stream.resume();
  });
}

/** ZIPs may contain one wrapped catalog or native question packages without a catalog. */
export async function zipLibraryReader(file: File): Promise<Reader> {
  if (file.size > 1024 * 1024 * 1024) throw new Error("For a collection larger than 1 GB, extract it locally and choose its folder. Files are read one at a time.");
  const bytes = new Uint8Array(await file.arrayBuffer()), entries = indexLibraryZip(bytes);
  const { default: JSZip } = await import("jszip");
  // Do not enable checkCRC32 here: that eagerly inflates every entry before our limit.
  const zip = await JSZip.loadAsync(bytes), byPath = new Map(entries.map(entry => [entry.path, entry]));
  let expanded = 0;
  const read: Reader = async path => {
    const entry = byPath.get(safeInputPath(path));
    const item = entry && zip.file(entry.archivePath);
    if (!entry || !item) throw new Error("This ZIP is missing a named collection file. Re-export the complete collection.");
    const originalName = (item as JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? item.name;
    if (originalName !== entry.archivePath) throw new Error("The ZIP changes the name of a collection file. Extract it locally and review the folder.");
    return readZipEntry(item, entry.byteSize, entry.crc32, length => {
      expanded += length;
      if (expanded > INPUT_MAX_TOTAL_BYTES) throw new Error("The ZIP expansion limit was reached. Split the collection into smaller imports.");
    });
  };
  return resolveLibraryReader(entries, read);
}

/** Keep the existing synchronous API; resolution starts only on the first read.
 * Files are read one at a time when requested, never all at once. */
export function folderLibraryReader(files: readonly File[], limits: LibraryInputLimits = INPUT_LIMITS): Reader {
  const byPath = new Map<string, File>(), entries: LibraryInputEntry[] = [];
  for (const file of files) {
    const relative = file.webkitRelativePath;
    const path = safeInputPath(relative ? relative.split("/").slice(1).join("/") : file.name);
    entries.push({ path, byteSize: file.size });
    if (byPath.has(path)) throw new Error("The selected folder contains duplicate filenames.");
    byPath.set(path, file);
  }
  resolveLibraryInputRoot(entries, limits);
  const read: Reader = async path => {
    const file = byPath.get(safeInputPath(path));
    if (!file) throw new Error("A collection file is missing from the selected folder. Choose the complete collection.");
    return new Uint8Array(await file.arrayBuffer());
  };
  let resolved: Promise<Reader> | undefined;
  return async path => {
    resolved ??= resolveLibraryReader(entries, read, limits);
    return (await resolved)(path);
  };
}
