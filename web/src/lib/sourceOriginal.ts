import type { SourceDocument } from "./library";

/** Immutable file identity, never bytes, URLs, tokens or a user's local path. */
export interface SourceOriginalFile {
  version: 1;
  sha256: string;
  byteSize: number;
  mimeType: string;
}
export const MAX_SOURCE_ORIGINAL_BYTES = 128 * 1024 * 1024;
export const ORIGINAL_MIME_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown", "text/csv", "application/json", "image/png", "image/jpeg", "image/webp", "image/gif"];
const MIME_ALIASES: Record<string, string> = { pdf: "application/pdf", docx: ORIGINAL_MIME_TYPES[1], txt: "text/plain", text: "text/plain", md: "text/markdown", markdown: "text/markdown", csv: "text/csv", json: "application/json" };

export function originalFileIdentity(document: Pick<SourceDocument, "checksum" | "fileType" | "sizeBytes">, file: Blob): SourceOriginalFile {
  const value: SourceOriginalFile = { version: 1, sha256: document.checksum?.replace(/^sha256:/, "") ?? "", byteSize: file.size, mimeType: MIME_ALIASES[document.fileType] ?? document.fileType };
  return readOriginalFile({ ...document, originalFile: value })!;
}

export function readOriginalFile(document: Pick<SourceDocument, "checksum" | "sizeBytes" | "originalFile">): SourceOriginalFile | undefined {
  const value = document.originalFile;
  if (value === undefined) return;
  if (!value || value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.sha256)
    || value.sha256 !== document.checksum?.replace(/^sha256:/, "") || !Number.isSafeInteger(value.byteSize)
    || value.byteSize !== document.sizeBytes || value.byteSize < 1 || value.byteSize > MAX_SOURCE_ORIGINAL_BYTES
    || !ORIGINAL_MIME_TYPES.includes(value.mimeType)) throw new Error("This original file has invalid identity, size or format. Supported originals must be at most 128 MB.");
  return value;
}
