import {
  ATTACHMENT_EXPORT_KEY, MAX_QUESTION_ATTACHMENT_BYTES, blobToBase64,
  extractQuestionAttachmentPayloads, getQuestionAttachmentBlob, restoreQuestionAttachmentPayloads,
  type QuestionImageAttachment, type QuestionAttachmentExportPayload,
} from "./questionAttachments";

type References = ReadonlyArray<{ id: string; attachments?: readonly QuestionImageAttachment[] }>;
type MediaEntry = { file: string; metadata: Omit<QuestionAttachmentExportPayload, "base64"> };
const FORMAT = "axom-media-backup";
export const LARGE_MEDIA_BACKUP_BYTES = 128 * 1024 * 1024;

function mediaReferences(references: References) {
  return [...new Map(references.flatMap(q => (q.attachments ?? []).map(a => [a.blobKey, { ...a, questionId: q.id }] as const))).values()];
}
export function mediaBackupBytes(references: References): number {
  return mediaReferences(references).reduce((n, a) => n + a.byteSize, 0);
}

/** Binary images avoid the single-string limit of large base64 JSON backups. */
export async function createMediaBackupArchive(payload: Record<string, unknown>, references: References) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const media: MediaEntry[] = [];
  const missingBlobKeys: string[] = [];
  for (const metadata of mediaReferences(references)) {
    try {
      const record = await getQuestionAttachmentBlob(metadata.blobKey);
      if (!record) throw new Error("Missing image");
      const bytes = new Uint8Array(await record.blob.arrayBuffer());
      const file = `media/${media.length}`;
      zip.file(file, bytes); media.push({ file, metadata });
    } catch { missingBlobKeys.push(metadata.blobKey); }
  }
  zip.file("workspace.json", JSON.stringify({ ...payload, _backupFormat: FORMAT, _backupVersion: 1, media }));
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true });
  return { blob, attachmentCount: media.length, missingBlobKeys };
}

export interface PortableBackupRead {
  rawText: string;
  restoreMedia: (references: References) => Promise<{ restored: number; skipped: number }>;
}

/** Restore one image at a time through the existing timestamp/ownership rules. */
export async function readPortableBackup(file: File): Promise<PortableBackupRead> {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    const rawText = await file.text();
    const payloads = extractQuestionAttachmentPayloads(JSON.parse(rawText));
    return { rawText, restoreMedia: refs => restoreQuestionAttachmentPayloads(payloads, refs) };
  }
  if (file.size > 2 * 1024 * 1024 * 1024) throw new Error("This backup exceeds the 2 GB archive limit.");
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()));
  if (Object.keys(zip.files).length > 30000) throw new Error("Too many files in this backup.");
  let expanded = 0;
  for (const entry of Object.values(zip.files)) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    const limit = entry.name === "workspace.json" ? 128 * 1024 * 1024 : MAX_QUESTION_ATTACHMENT_BYTES;
    if (size < 0 || size > limit) throw new Error("A backup file exceeds the safety limit.");
    expanded += size;
  }
  if (expanded > 2 * 1024 * 1024 * 1024) throw new Error("The expanded backup exceeds the safety limit.");
  const workspace = zip.file("workspace.json");
  if (!workspace) throw new Error("This ZIP is not an AXOM workspace backup. Prepared libraries are installed from the Course Library or QBank.");
  const rawText = await workspace.async("string");
  const manifest = JSON.parse(rawText) as { _backupFormat?: string; _backupVersion?: number; media?: MediaEntry[] };
  if (manifest._backupFormat !== FORMAT || manifest._backupVersion !== 1 || !Array.isArray(manifest.media)) throw new Error("Unsupported workspace backup format.");
  const media = manifest.media;
  for (const item of media) {
    if (!item || !/^media\/\d+$/.test(item.file) || !zip.file(item.file) || extractQuestionAttachmentPayloads({ [ATTACHMENT_EXPORT_KEY]: [{ ...item.metadata, base64: "AA==" }] }).length !== 1) throw new Error("The backup contains an invalid or missing image record.");
  }
  return { rawText, restoreMedia: async references => {
    let restored = 0, skipped = 0;
    for (const item of media) {
      const bytes = await zip.file(item.file)!.async("uint8array");
      if (bytes.length > MAX_QUESTION_ATTACHMENT_BYTES) throw new Error("A backup image exceeds the safety limit.");
      const base64 = await blobToBase64(new Blob([bytes as BlobPart]));
      const payloads = extractQuestionAttachmentPayloads({ [ATTACHMENT_EXPORT_KEY]: [{ ...item.metadata, base64 }] });
      const result = await restoreQuestionAttachmentPayloads(payloads, references);
      restored += result.restored; skipped += result.skipped;
    }
    return { restored, skipped };
  } };
}
