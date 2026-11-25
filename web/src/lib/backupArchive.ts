// Keep ZIP in the static dependency graph. Recovery must not fetch a new
// lazy chunk on the first export or restore after a deployment or network loss.
import JSZip from "jszip";
import { sha256Hex } from "./checksum";
import { readSourceOriginal, saveSourceOriginal } from "./decode/sources";
import type { SourceDocument } from "./library";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent } from "./questionAttachmentScope";
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
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 30000;
type ArchiveBudget = { maxEntries: number; maxBytes: number; maxWorkspaceBytes: number };
class BackupArchiveLimitError extends Error {}
function assertEntrySize(size: number, limit: number) {
  if (!Number.isSafeInteger(size) || size < 0 || size > limit) throw new BackupArchiveLimitError("A backup file exceeds the safety limit.");
}
function assertArchiveBudget(entries: number, bytes: number, budget: ArchiveBudget) {
  if (entries > budget.maxEntries) throw new BackupArchiveLimitError("Too many files in this backup.");
  if (bytes > budget.maxBytes) throw new BackupArchiveLimitError("This backup exceeds the archive safety limit.");
}
// Optional tighter export caps never raise the reader's format limits.
function exportBudget(requested: Partial<ArchiveBudget>): ArchiveBudget {
  const bounded = (value: number | undefined, maximum: number) => {
    if (value === undefined) return maximum;
    if (!Number.isSafeInteger(value) || value <= 0) throw new BackupArchiveLimitError("Invalid backup safety limit.");
    return Math.min(value, maximum);
  };
  return { maxEntries: bounded(requested.maxEntries, MAX_ARCHIVE_ENTRIES), maxBytes: bounded(requested.maxBytes, MAX_ARCHIVE_BYTES), maxWorkspaceBytes: bounded(requested.maxWorkspaceBytes, MAX_ORIGINAL_BYTES) };
}
export function backupOriginalDocuments(documents: readonly SourceDocument[]): SourceDocument[] {
  return documents.filter(doc => /^[a-f0-9]{64}$/.test(doc.checksum?.replace(/^sha256:/, "") ?? "") && typeof doc.fileType === "string" && !doc.fileType.startsWith("axom-"));
}
// Format 2 has one original entry per document ID. Preserve workspace metadata,
// but never emit competing editions or a binary without its manifest identity.
function uniqueBackupOriginals(documents: readonly SourceDocument[], payload: Record<string, unknown>): SourceDocument[] {
  const originals = new Map<string, SourceDocument>();
  const checksum = (doc: SourceDocument) => typeof doc.checksum === "string" ? doc.checksum.replace(/^sha256:/, "") : undefined;
  for (const doc of backupOriginalDocuments(documents)) {
    const existing = originals.get(doc.id);
    if (existing && checksum(existing) !== checksum(doc)) throw new Error("Conflicting original-file identities in the backup. Resolve the document conflict before exporting.");
    originals.set(doc.id, doc);
  }
  const deferred = payload.deferredContent as { documents?: SourceDocument[] } | undefined;
  const manifestDocuments = [
    ...(Array.isArray(payload.documents) ? payload.documents as SourceDocument[] : []),
    ...(Array.isArray(deferred?.documents) ? deferred.documents : []),
  ];
  const matched = new Set<string>();
  for (const doc of [...documents, ...manifestDocuments]) {
    const original = originals.get(doc?.id);
    if (original && checksum(original) !== checksum(doc)) throw new Error("Conflicting original-file identities in the backup. Resolve the document conflict before exporting.");
  }
  for (const doc of manifestDocuments) if (originals.has(doc?.id)) matched.add(doc.id);
  if (matched.size !== originals.size) throw new Error("An original-file identity is missing from the backup workspace.");
  return [...originals.values()];
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
export async function createMediaBackupArchive(payload: Record<string, unknown>, references: References, documents: readonly SourceDocument[] = [], options: AttachmentReadOptions = {}, requestedBudget: Partial<ArchiveBudget> = {}) {
  const budget = exportBudget(requestedBudget);
  const scope = options.scope ?? getQuestionAttachmentScope();
  options = { ...options, scope };
  const originalDocuments = uniqueBackupOriginals(documents, payload);
  const zip = new JSZip();
  const media: MediaEntry[] = [];
  const missingBlobKeys: string[] = [];
  let expanded = 0;
  let binaryEntries = 0;
  // Reserve the workspace entry before allocating another binary.
  const checkBinary = (size: number, limit: number) => {
    assertEntrySize(size, limit);
    assertArchiveBudget(binaryEntries + 2, expanded + size, budget);
  };
  for (const metadata of mediaReferences(references)) {
    try {
      const record = await getQuestionAttachmentBlob(metadata.blobKey, options);
      if (!record) throw new Error("Missing image");
      checkBinary(record.blob.size, MAX_QUESTION_ATTACHMENT_BYTES);
      const bytes = new Uint8Array(await record.blob.arrayBuffer());
      checkBinary(bytes.byteLength, MAX_QUESTION_ATTACHMENT_BYTES);
      const file = `media/${media.length}`;
      zip.file(file, bytes, { createFolders: false }); media.push({ file, metadata });
      expanded += bytes.byteLength; binaryEntries++;
    } catch (error) {
      if (error instanceof BackupArchiveLimitError) throw error;
      missingBlobKeys.push(metadata.blobKey);
    }
  }
  const originals: OriginalEntry[] = [];
  const missingOriginalIds: string[] = [];
  for (const document of originalDocuments) {
    try {
      const blob = await readSourceOriginal(document.id, document.checksum, options);
      if (!blob || blob.size > MAX_ORIGINAL_BYTES) throw new Error("Original unavailable or too large");
      checkBinary(blob.size, MAX_ORIGINAL_BYTES);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      checkBinary(bytes.byteLength, MAX_ORIGINAL_BYTES);
      if (bytes.byteLength !== blob.size || blob.type.length > 255 || await sha256Hex(bytes) !== document.checksum!.replace(/^sha256:/, "")) throw new Error("Original failed backup integrity check");
      const file = `originals/${originals.length}`;
      zip.file(file, bytes, { createFolders: false });
      originals.push({ file, documentId: document.id, sha256: document.checksum!.replace(/^sha256:/, ""), byteSize: bytes.byteLength, mimeType: blob.type });
      expanded += bytes.byteLength; binaryEntries++;
    } catch (error) {
      if (error instanceof BackupArchiveLimitError) throw error;
      missingOriginalIds.push(document.id);
    }
  }
  const workspaceJson = JSON.stringify({ ...payload, _backupFormat: FORMAT, _backupVersion: 2, media, originals });
  const workspaceBytes = new Blob([workspaceJson]).size;
  assertEntrySize(workspaceBytes, budget.maxWorkspaceBytes);
  assertArchiveBudget(binaryEntries + 1, expanded + workspaceBytes, budget);
  zip.file("workspace.json", workspaceJson);
  // Check actual entries, including any directories, and final ZIP overhead.
  const entryCount = Object.keys(zip.files).length;
  assertArchiveBudget(entryCount, expanded + workspaceBytes, budget);
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true });
  assertArchiveBudget(entryCount, blob.size, budget);
  if (!isQuestionAttachmentScopeCurrent(scope)) throw new Error("The account changed during export. Start a new export from the current workspace.");
  return { blob, attachmentCount: media.length, missingBlobKeys, originalCount: originals.length, missingOriginalIds };
}

export interface PortableBackupRead {
  rawText: string;
  restoreOriginals: (documents: readonly SourceDocument[]) => Promise<{ restored: number; skipped: number }>;
  restoreMedia: (references: References) => Promise<StagedQuestionAttachmentRestore>;
}

/** Read and validate a portable copy before any workspace state is adopted. */
export async function readPortableBackup(file: File): Promise<PortableBackupRead> {
  // Bind deferred archive extraction and staging to the original generation.
  // Returning to the same account cannot resume an abandoned attempt.
  const scope = getQuestionAttachmentScope();
  const assertRestoreScope = () => {
    if (!isQuestionAttachmentScopeCurrent(scope)) throw new Error("The account changed during recovery. Choose the backup again in the intended account.");
  };
  if (!file.name.toLowerCase().endsWith(".zip")) {
    const rawText = await file.text();
    assertRestoreScope();
    const payloads = extractQuestionAttachmentPayloads(JSON.parse(rawText));
    return { rawText, restoreMedia: async refs => {
      assertRestoreScope();
      return stageQuestionAttachmentPayloads(payloads, refs, scope);
    }, restoreOriginals: async () => {
      assertRestoreScope();
      return { restored: 0, skipped: 0 };
    } };
  }
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("This backup exceeds the 2 GB archive limit.");
  const archiveBytes = await file.arrayBuffer();
  assertRestoreScope();
  const zip = await JSZip.loadAsync(new Uint8Array(archiveBytes));
  assertRestoreScope();
  if (Object.keys(zip.files).length > MAX_ARCHIVE_ENTRIES) throw new Error("Too many files in this backup.");
  let expanded = 0;
  for (const entry of Object.values(zip.files)) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    const limit = entry.name === "workspace.json" || /^originals\/\d+$/.test(entry.name) ? MAX_ORIGINAL_BYTES : MAX_QUESTION_ATTACHMENT_BYTES;
    assertEntrySize(size, limit);
    expanded += size;
  }
  if (expanded > MAX_ARCHIVE_BYTES) throw new Error("The expanded backup exceeds the safety limit.");
  const workspace = zip.file("workspace.json");
  if (!workspace) throw new Error("This ZIP is not an AXOM workspace backup. Prepared libraries are installed from the Course Library or QBank.");
  const rawText = await workspace.async("string");
  assertRestoreScope();
  const manifest = JSON.parse(rawText) as { _backupFormat?: string; _backupVersion?: number; media?: MediaEntry[]; originals?: OriginalEntry[]; documents?: SourceDocument[]; deferredContent?: { documents?: SourceDocument[] } };
  if (manifest._backupFormat !== FORMAT || ![1, 2].includes(manifest._backupVersion ?? 0) || !Array.isArray(manifest.media)) throw new Error("Unsupported workspace backup format.");
  const media = manifest.media;
  for (const item of media) {
    if (!item || !/^media\/\d+$/.test(item.file) || !zip.file(item.file) || extractQuestionAttachmentPayloads({ [ATTACHMENT_EXPORT_KEY]: [{ ...item.metadata, base64: "AA==" }] }).length !== 1) throw new Error("The backup contains an invalid or missing image record.");
  }
  const originals = manifest._backupVersion === 2 ? manifest.originals : [];
  if (!Array.isArray(originals)) throw new Error("The backup has no original-file manifest.");
  const ids = new Set<string>(), files = new Set<string>();
  // Every active or deferred claimant must identify the same bytes. A later
  // document must not hide a conflicting or missing checksum on an earlier one.
  const documentChecksums = new Map<string, string | null>();
  for (const doc of [
    ...(Array.isArray(manifest.documents) ? manifest.documents : []),
    ...(Array.isArray(manifest.deferredContent?.documents) ? manifest.deferredContent.documents : []),
  ]) {
    if (typeof doc?.id !== "string" || !doc.id) continue;
    const checksum = typeof doc.checksum === "string" ? doc.checksum.replace(/^sha256:/, "") : null;
    if (documentChecksums.has(doc.id) && documentChecksums.get(doc.id) !== checksum) {
      documentChecksums.set(doc.id, null);
    } else {
      documentChecksums.set(doc.id, checksum);
    }
  }
  // Check integrity before the caller offers to adopt any workspace records.
  for (const item of originals) {
    if (!item || typeof item.documentId !== "string" || !item.documentId || ids.has(item.documentId) || files.has(item.file)
      || !/^originals\/\d+$/.test(item.file) || !zip.file(item.file) || !/^[a-f0-9]{64}$/.test(item.sha256)
      || !Number.isSafeInteger(item.byteSize) || item.byteSize < 0 || item.byteSize > MAX_ORIGINAL_BYTES
      || typeof item.mimeType !== "string" || item.mimeType.length > 255
      || documentChecksums.get(item.documentId) !== item.sha256) throw new Error("The backup contains an invalid or missing original-file record.");
    const bytes = await zip.file(item.file)!.async("uint8array");
    assertRestoreScope();
    if (bytes.byteLength !== item.byteSize || await sha256Hex(bytes) !== item.sha256) throw new Error("An original file failed its backup integrity check. No workspace data has been changed.");
    assertRestoreScope();
    ids.add(item.documentId); files.add(item.file);
  }
  assertRestoreScope();
  return { rawText, restoreOriginals: async documents => {
    assertRestoreScope();
    let restored = 0, skipped = 0;
    for (const item of originals) {
      const document = documents.find(doc => doc.id === item.documentId && doc.checksum?.replace(/^sha256:/, "") === item.sha256);
      if (!document) { skipped++; continue; }
      const existing = await readSourceOriginal(document.id, document.checksum, { scope });
      assertRestoreScope();
      if (existing) { skipped++; continue; }
      const bytes = await zip.file(item.file)!.async("uint8array");
      assertRestoreScope();
      await saveSourceOriginal(document, new Blob([bytes as BlobPart], { type: item.mimeType }), { scope });
      assertRestoreScope();
      restored++;
    }
    return { restored, skipped };
  }, restoreMedia: async references => {
    assertRestoreScope();
    const payloads: QuestionAttachmentExportPayload[] = [];
    for (const item of media) {
      const bytes = await zip.file(item.file)!.async("uint8array");
      assertRestoreScope();
      if (bytes.length > MAX_QUESTION_ATTACHMENT_BYTES) throw new Error("A backup image exceeds the safety limit.");
      const base64 = await blobToBase64(new Blob([bytes as BlobPart]));
      assertRestoreScope();
      payloads.push(...extractQuestionAttachmentPayloads({ [ATTACHMENT_EXPORT_KEY]: [{ ...item.metadata, base64 }] }));
    }
    return stageQuestionAttachmentPayloads(payloads, references, scope);
  } };
}
