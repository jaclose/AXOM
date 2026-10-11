import { INPUT_MAX_FILES, resolveLibraryInputRoot, safeInputPath, type LibraryInputEntry } from "./inputRoot";

export interface IndexedZipEntry extends LibraryInputEntry { archivePath: string; crc32: number; }

/** Inspect the central directory before JSZip can collapse duplicate filenames.
 * ZIP64, split volumes and encrypted archives are deliberately routed to folder
 * import. No source bytes are decompressed during this preflight.
 */
export function indexLibraryZip(bytes: Uint8Array): IndexedZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const unsupported = () => new Error("This ZIP uses an unsupported layout. Extract it locally and choose its folder instead.");
  const requireRange = (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > bytes.length) throw unsupported();
  };
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { end = at; break; }
  }
  if (end < 0) throw unsupported();
  const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true), size = view.getUint32(end + 12, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)
      || view.getUint16(end + 8, true) !== count || count === 0xffff || start === 0xffffffff || size === 0xffffffff
      || start + size !== end || count > INPUT_MAX_FILES) throw unsupported();
  requireRange(start, size);
  const entries: IndexedZipEntry[] = [], seen = new Set<string>();
  const decode = new TextDecoder("utf-8", { fatal: true });
  let position = start;
  for (let index = 0; index < count; index++) {
    requireRange(position, 46);
    if (view.getUint32(position, true) !== 0x02014b50) throw unsupported();
    const flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true);
    const compressed = view.getUint32(position + 20, true), byteSize = view.getUint32(position + 24, true);
    const nameSize = view.getUint16(position + 28, true), extraSize = view.getUint16(position + 30, true), commentSize = view.getUint16(position + 32, true);
    const local = view.getUint32(position + 42, true), recordSize = 46 + nameSize + extraSize + commentSize;
    requireRange(position, recordSize);
    if ((flags & 1) || ![0, 8].includes(method) || [compressed, byteSize, local].includes(0xffffffff)
        || view.getUint16(position + 34, true) || position + recordSize > end) throw unsupported();
    let archivePath: string;
    try { archivePath = decode.decode(bytes.subarray(position + 46, position + 46 + nameSize)); }
    catch { throw unsupported(); }
    const directory = archivePath.endsWith("/"), path = safeInputPath(directory ? archivePath.slice(0, -1) : archivePath);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error("This ZIP has duplicate or case-conflicting filenames. Re-export it without duplicate paths.");
    seen.add(key);
    // Do not treat symlinks as source files, and do not follow local-header tricks.
    const unixType = (view.getUint32(position + 38, true) >>> 16) & 0xf000;
    if (unixType === 0xa000 || (unixType && unixType !== 0x8000 && unixType !== 0x4000)) throw unsupported();
    requireRange(local, 30);
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags
        || view.getUint16(local + 8, true) !== method || view.getUint16(local + 26, true) !== nameSize) throw unsupported();
    const dataStart = local + 30 + nameSize + view.getUint16(local + 28, true);
    requireRange(local + 30, nameSize);
    for (let n = 0; n < nameSize; n++) if (bytes[local + 30 + n] !== bytes[position + 46 + n]) throw unsupported();
    if (dataStart + compressed > start || dataStart < local || (directory && byteSize)) throw unsupported();
    if (!directory) entries.push({ path, archivePath, byteSize, crc32: view.getUint32(position + 16, true) });
    position += recordSize;
  }
  if (position !== end) throw unsupported();
  resolveLibraryInputRoot(entries); // Count, expanded-byte, path and root checks.
  return entries;
}
