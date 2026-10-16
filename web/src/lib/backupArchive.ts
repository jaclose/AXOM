// Keep ZIP in the static dependency graph. Recovery must not fetch a new
// lazy chunk on the first export or restore after a deployment or network loss.
import JSZip from "jszip";
import { sha256Hex } from "./checksum";
import { readSourceOriginal, saveSourceOriginal } from "./decode/sources";
import type { SourceDocument } from "./library";
import {
  ATTACHMENT_EXPORT_KEY, MAX_QUESTION_ATTACHMENT_BYTES, blobToBase64,
  extractQuestionAttachmentPayloads, getQuestionAttachmentBlob, stageQuestionAttachmentPayloads,
  type QuestionImageAttachment, type QuestionAttachmentExportPayload, type AttachmentReadOptions,
  type StagedQuestionAttachmentRestore,
} from "./questionAttachments";

type References = ReadonlyArray<{ id: string; attachments?: readonly QuestionImageAttachment[] }>;
type MediaEntry = { file: string; metadata: Omit<QuestionAttachmentExportPayload, "base64"> };
type OriginalEntry = { file: string; documentId: string; sha256: string; byteSize: number; mimeType: string };
const MAX_ORIGINAL_BYTES = 128 * 1024 * 1024;
export function backupOriginalDocuments(documents: readonly SourceDocument[]): SourceDocument[] {
  return documents.filter(doc => /^[a-f0-9]{64}$/.test(doc.checksum?.replace(/^sha256:/, "") ?? "") && typeof doc.fileType === "string" && !doc.fileType.startsWith("axom-"));
}
const FORMAT = "axom-media-backup";
export const LARGE_MEDIA_BACKUP_BYTES = 128 * 1024 * 1024;

function mediaReferences(references: References) {
  return [...new Map(references.flatMap(q => (q.attachments ?? []).map(a => [a.blobKey, { ...a, questionId: q.id }] as const))).values()];
}
export function mediaBackupBytes(references: References): number {
  return mediaReferences(references).reduce((n, a) => n + a.byteSize, 0);
}

/** Binary images avoid the single-string limit of large base64 JSON backups. */
export async function createMediaBackupArchive(payload: Record<string, unknown>, references: References, documents: readonly SourceDocument[] = [], options: AttachmentReadOptions = {}) {
  const zip = new JSZip();
  const media: MediaEntry[] = [];
  const missingBlobKeys: string[] = [];
  for (const metadata of mediaReferences(references)) {
    try {
      const record = await getQuestionAttachmentBlob(metadata.blobKey, options);
      if (!record) throw new Error("Missing image");
      const bytes = new Uint8Array(await record.blob.arrayBuffer());
      const file = `media/${media.length}`;
      zip.file(file, bytes); media.push({ file, metadata });
    } catch { missingBlobKeys.push(metadata.blobKey); }
  }
  const originals: OriginalEntry[] = [];
  const missingOriginalIds: string[] = [];
  for (const document of backupOriginalDocuments(documents)) {
    try {
      const blob = await readSourceOriginal(document.id, document.checksum);
      if (!blob || blob.size > MAX_ORIGINAL_BYTES) throw new Error("Original unavailable or too large");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const file = `originals/${originals.length}`;
      zip.file(file, bytes);
      originals.push({ file, documentId: document.id, sha256: document.checksum!.replace(/^sha256:/, ""), byteSize: bytes.byteLength, mimeType: blob.type });
    } catch { missingOriginalIds.push(document.id); }
  }
  zip.file("workspace.json", JSON.stringify({ ...payload, _backupFormat: FORMAT, _backupVersion: 2, media, originals }));
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true });
  return { blob, attachmentCount: media.length, missingBlobKeys, originalCount: originals.length, missingOriginalIds };
}

export interface PortableBackupRead {
  rawText: string;
  restoreOriginals: (documents: readonly SourceDocument[]) => Promise<{ restored: number; skipped: number }>;
  restoreMedia: (references: References) => Promise<StagedQuestionAttachmentRestore>;
}

/** Read and validate a portable copy before any workspace state is adopted. */
export async function readPortableBackup(file: File): Promise<PortableBackupRead> {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    const rawText = await file.text();
    const payloads = extractQuestionAttachmentPayloads(JSON.parse(rawText));
    return { rawText, restoreMedia: refs => stageQuestionAttachmentPayloads(payloads, refs), restoreOriginals: async () => ({ restored: 0, skipped: 0 }) };
  }
  if (file.size > 2 * 1024 * 1024 * 1024) throw new Error("This backup exceeds the 2 GB archive limit.");
  const zip = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()));
  if (Object.keys(zip.files).length > 30000) throw new Error("Too many files in this backup.");
  let expanded = 0;
  for (const entry of Object.values(zip.files)) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    const limit = entry.name === "workspace.json" || /^originals\/\d+$/.test(entry.name) ? MAX_ORIGINAL_BYTES : MAX_QUESTION_ATTACHMENT_BYTES;
    if (size < 0 || size > limit) throw new Error("A backup file exceeds the safety limit.");
    expanded += size;
  }
  if (expanded > 2 * 1024 * 1024 * 1024) throw new Error("The expanded backup exceeds the safety limit.");
  const workspace = zip.file("workspace.json");
  if (!workspace) throw new Error("This ZIP is not an AXOM workspace backup. Prepared libraries are installed from the Course Library or QBank.");
  const rawText = await workspace.async("string");
  const manifest = JSON.parse(rawText) as { _backupFormat?: string; _backupVersion?: number; media?: MediaEntry[]; originals?: OriginalEntry[]; documents?: SourceDocument[]; deferredContent?: { documents?: SourceDocument[] } };
  if (manifest._backupFormat !== FORMAT || ![1, 2].includes(manifest._backupVersion ?? 0) || !Array.isArray(manifest.media)) throw new Error("Unsupported workspace backup format.");
  const media = manifest.media;
  for (const item of media) {
    if (!item || !/^media\/\d+$/.test(item.file) || !zip.file(item.file) || extractQuestionAttachmentPayloads({ [ATTACHMENT_EXPORT_KEY]: [{ ...item.metadata, base64: "AA==" }] }).length !== 1) throw new Error("The backup contains an invalid or missing image record.");
  }
  const originals = manifest._backupVersion === 2 ? manifest.originals : [];
  if (!Array.isArray(originals)) throw new Error("The backup has no original-file manifest.");
  const ids = new Set<string>(), files = new Set<string>();
  const documents = new Map([
    ...(Array.isArray(manifest.documents) ? manifest.documents : []),
    ...(Array.isArray(manifest.deferredContent?.documents) ? manifest.deferredContent.documents : []),
  ].map(doc => [doc?.id, doc]));
  // Check integrity before the caller offers to adopt any workspace records.
  for (const item of originals) {
    if (!item || typeof item.documentId !== "string" || ids.has(item.documentId) || files.has(item.file)
      || !/^originals\/\d+$/.test(item.file) || !zip.file(item.file) || !/^[a-f0-9]{64}$/.test(item.sha256)
      || !Number.isSafeInteger(item.byteSize) || item.byteSize < 0 || item.byteSize > MAX_ORIGINAL_BYTES
      || typeof item.mimeType !== "string" || item.mimeType.length > 255
      || documents.get(item.documentId)?.checksum?.replace(/^sha256:/, "") !== item.sha256) throw new Error("The backup contains an invalid or missing original-file record.");
    const bytes = await zip.file(item.file)!.async("uint8array");
    if (bytes.byteLength !== item.byteSize || await sha256Hex(bytes) !== item.sha256) throw new Error("An original file failed its backup integrity check. No workspace data has been changed.");
    ids.add(item.documentId); files.add(item.file);
  }
  return { rawText, restoreOriginals: async documents => {
    let restored = 0, skipped = 0;
    for (const item of originals) {
      const document = documents.find(doc => doc.id === item.documentId && doc.checksum?.replace(/^sha256:/, "") === item.sha256);
      if (!document || await readSourceOriginal(document.id, document.checksum)) { skipped++; continue; }
      const bytes = await zip.file(item.file)!.async("uint8array");
      await saveSourceOriginal(document, new Blob([bytes as BlobPart], { type: item.mimeType }));
      restored++;
    }
    return { restored, skipped };
  }, restoreMedia: async references => {
    const payloads: QuestionAttachmentExportPayload[] = [];
    for (const item of media) {
      const bytes = await zip.file(item.file)!.async("uint8array");
      if (bytes.length > MAX_QUESTION_ATTACHMENT_BYTES) throw new Error("A backup image exceeds the safety limit.");
      const base64 = await blobToBase64(new Blob([bytes as BlobPart]));
      payloads.push(...extractQuestionAttachmentPayloads({ [ATTACHMENT_EXPORT_KEY]: [{ ...item.metadata, base64 }] }));
    }
    return stageQuestionAttachmentPayloads(payloads, references);
  } };
}
