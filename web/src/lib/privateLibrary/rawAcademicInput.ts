// Ordinary academic files inside a ZIP or selected folder. Prepared AXOM
// packages use the existing nativeInput/installer path instead.
import JSZip from "jszip";
import { sha256 } from "../question-content/assets";
import { readZipEntry } from "./fileInput";
import { isPackagingMetadata, safeInputPath, validateLibraryInputEntries } from "./inputRoot";
import { indexLibraryZip } from "./zipIndex";

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_RAW_FILES = 500;
const SOURCE_EXTENSIONS = new Set(["pdf", "docx", "txt", "md", "markdown", "csv", "json"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export interface RawSelection {
  sources: File[];
  images: File[];
  skipped: { path: string; reason: string }[];
  duplicateCount: number;
}

export type SourceProgress = (processed: number, total: number, path: string) => void;

function kind(path: string): "source" | "image" | "unsupported" {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return SOURCE_EXTENSIONS.has(extension) ? "source" : IMAGE_EXTENSIONS.has(extension) ? "image" : "unsupported";
}
function mime(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return ({ pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", json: "application/json",
    txt: "text/plain", md: "text/markdown", markdown: "text/markdown", csv: "text/csv", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" } as Record<string, string>)[extension] ?? "application/octet-stream";
}
function leaf(path: string): string { return path.split("/").pop() ?? path; }
function isNativePackage(path: string): boolean {
  return ["catalog.json", "manifest.json"].includes(leaf(path).toLowerCase());
}

async function gather(entries: readonly { path: string; file: File }[], onProgress?: SourceProgress): Promise<RawSelection> {
  if (entries.length > MAX_RAW_FILES) throw new Error(`This selection has more than ${MAX_RAW_FILES} files. Split the import into smaller groups.`);
  validateLibraryInputEntries(entries.map(entry => ({ path: entry.path, byteSize: entry.file.size })));
  const bytes = entries.reduce((size, entry) => size + entry.file.size, 0);
  if (bytes > MAX_EXPANDED_BYTES) throw new Error("The selected sources exceed 256 MB. Import the largest documents separately.");
  if (entries.some(entry => isNativePackage(entry.path))) {
    throw new Error("This folder contains prepared-package metadata. Choose the AXOM package import, not raw source import.");
  }
  const sources: File[] = [], images: File[] = [], skipped: RawSelection["skipped"] = [], hashes = new Set<string>();
  let duplicateCount = 0, processed = 0;
  for (const { path, file } of entries) {
    onProgress?.(++processed, entries.length, path);
    if (isPackagingMetadata(path)) continue;
    const type = kind(path);
    if (type === "unsupported") { skipped.push({ path, reason: "Unsupported format; no question extraction attempted." }); continue; }
    if (type === "image") { images.push(new File([file], path, { type: mime(path) })); continue; }
    const checksum = await sha256(new Uint8Array(await file.arrayBuffer()));
    if (hashes.has(checksum)) {
      skipped.push({ path, reason: "Byte-identical duplicate source; original retained in this selection." });
      duplicateCount += 1;
      continue;
    }
    hashes.add(checksum);
    sources.push(new File([file], path, { type: mime(path) }));
  }
  if (!sources.length) throw new Error("No PDF, DOCX, TXT, Markdown, CSV, or JSON sources were found. Images can be attached after a question is parsed.");
  return { sources, images, skipped, duplicateCount };
}

/** Works on an ordinary folder selection; no catalog or manifest is required. */
export async function rawAcademicFolder(files: readonly File[], onProgress?: SourceProgress): Promise<RawSelection> {
  const entries = files.map(file => ({
    path: safeInputPath(file.webkitRelativePath ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name), file,
  }));
  return gather(entries, onProgress);
}

/** Stream each expanded ZIP entry with CRC and declared-length checks before
 * exposing any source. Rejected/partial archives return no queue to install.
 */
export async function rawAcademicZip(file: File, onProgress?: SourceProgress): Promise<RawSelection> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("The ZIP exceeds 256 MB. Extract it and select smaller folders.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = indexLibraryZip(bytes, { allowRaw: true }).filter(entry => !isPackagingMetadata(entry.path));
  if (entries.length > MAX_RAW_FILES) throw new Error(`The ZIP has more than ${MAX_RAW_FILES} source and asset files. Split it before import.`);
  if (entries.reduce((sum, entry) => sum + entry.byteSize, 0) > MAX_EXPANDED_BYTES) {
    throw new Error("The ZIP expands beyond 256 MB. Extract it and select smaller folders.");
  }
  if (entries.some(entry => isNativePackage(entry.path))) {
    throw new Error("This looks like a prepared AXOM package. Choose the prepared ZIP importer to preserve its structure.");
  }
  const zip = await JSZip.loadAsync(bytes);
  let expanded = 0, processed = 0;
  const files: { path: string; file: File }[] = [];
  for (const entry of entries) {
    onProgress?.(++processed, entries.length, entry.path);
    if (kind(entry.path) === "unsupported") {
      // No extraction or scanning of arbitrary executable content.
      files.push({ path: entry.path, file: new File([], entry.path) });
      continue;
    }
    const item = zip.file(entry.archivePath);
    if (!item || (item as typeof item & { unsafeOriginalName?: string }).unsafeOriginalName !== undefined
      && (item as typeof item & { unsafeOriginalName?: string }).unsafeOriginalName !== entry.archivePath) {
      throw new Error(`ZIP source ${entry.path} has an unsafe or changed path.`);
    }
    const content = await readZipEntry(item, entry.byteSize, entry.crc32, length => {
      expanded += length;
      if (expanded > MAX_EXPANDED_BYTES) throw new Error("The ZIP expanded beyond 256 MB. No content was imported.");
    });
    files.push({ path: entry.path, file: new File([content as BlobPart], entry.path, { type: mime(entry.path) }) });
  }
  return gather(files, onProgress);
}
