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
export function backupOriginalDocuments(documents: readonly SourceDocument[]): SourceDocument[] {
  return documents.filter(doc => /^[a-f0-9]{64}$/.test(doc.checksum?.replace(/^sha256:/, "") ?? "") && typeof doc.fileType === "string" && !doc.fileType.startsWith("axom-"));
}
const FORMAT = "axom-media-backup";
export const LARGE_MEDIA_BACKUP_BYTES = 128 * 1024 * 1024;

type MediaReference = { metadata: Omit<QuestionAttachmentExportPayload, "base64">; conflicting: boolean };

/** One shared key may be referenced repeatedly, but it cannot name different media.
 * Keep the first reference and mark conflicts; a last-wins Map would hide evidence
 * that at least one question cannot be faithfully recovered from this archive. */
function mediaReferences(references: References): MediaReference[] {
  const byKey = new Map<string, MediaReference>();
  for (const question of references) {
    for (const attachment of question.attachments ?? []) {
      const existing = byKey.get(attachment.blobKey);
      if (existing) {
        if (existing.metadata.mimeType !== attachment.mimeType
          || existing.metadata.byteSize !== attachment.byteSize) existing.conflicting = true;
      } else {
        byKey.set(attachment.blobKey, {
          metadata: { ...attachment, questionId: question.id }, conflicting: false,
        });
      }
    }
  }
  return [...byKey.values()];
}


/** Structural image validation before certifying backup completeness.
 * The attachment's MIME and byte size are labels, not evidence of image bytes.
 * For PNG, validate every chunk CRC to detect same-length damaged content.
 * These checks do not authenticate provenance or replace a source checksum. */
function hasExpectedImageStructure(bytes: Uint8Array, mime: string): boolean {
  const has = (offset: number, ...values: number[]) =>
    offset + values.length <= bytes.length && values.every((value, i) => bytes[offset + i] === value);
  const be32 = (at: number) =>
    ((bytes[at] * 0x1000000 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]) >>> 0);
  if (mime === "image/png") {
    if (!has(0, 137, 80, 78, 71, 13, 10, 26, 10)) return false;
    let offset = 8;
    let first = true;
    let sawImageData = false;
    while (offset + 12 <= bytes.length) {
      const length = be32(offset);
      if (length > bytes.length - offset - 12) return false;
      const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (first && (name !== "IHDR" || length !== 13
        || be32(offset + 8) === 0 || be32(offset + 12) === 0)) return false;
      let crc = 0xffffffff;
      for (let i = offset + 4; i < offset + 8 + length; i++) {
        crc ^= bytes[i];
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      if (((crc ^ 0xffffffff) >>> 0) !== be32(offset + 8 + length)) return false;
      offset += length + 12;
      first = false;
      if (name === "IDAT") sawImageData = true;
      if (name === "IEND") return sawImageData && length === 0 && offset === bytes.length;
    }
    return false;
  }
  if (mime === "image/jpeg") return bytes.length >= 4
    && has(0, 0xff, 0xd8, 0xff) && has(bytes.length - 2, 0xff, 0xd9);
  if (mime === "image/gif") return bytes.length >= 14
    && has(0, 71, 73, 70, 56) && (bytes[4] === 55 || bytes[4] === 57)
    && bytes[5] === 97 && (bytes[6] | bytes[7]) !== 0
    && (bytes[8] | bytes[9]) !== 0 && bytes[bytes.length - 1] === 0x3b;
  if (mime === "image/webp") return bytes.length >= 20
    && has(0, 82, 73, 70, 70) && has(8, 87, 69, 66, 80)
    && ((bytes[4] + bytes[5] * 256 + bytes[6] * 65536 + bytes[7] * 16777216) >>> 0) === bytes.length - 8
    && has(12, 86, 80, 56) && [32, 76, 88].includes(bytes[15]);
  return false;
}

/** Validate zlib IDAT data and PNG scanline geometry before certifying an image.
 * CRC-correct containers alone can contain zero/invalid compressed pixels.
 * Indexed palette samples are unfiltered and range-checked in every Adam7 pass.
 * This is bounded structural validation, not a source digest or full pixel decode. */
async function hasInflatablePngImageData(bytes: Uint8Array): Promise<boolean> {
  try {
    if (typeof DecompressionStream !== "function") return false;
    const u32 = (at: number) =>
      (bytes[at] * 0x1000000 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]) >>> 0;
    const width = u32(16), height = u32(20), depth = bytes[24], color = bytes[25], interlace = bytes[28];
    const allowedDepths: Record<number, readonly number[]> = {
      0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16],
    };
    const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
    if (!width || !height || !allowedDepths[color]?.includes(depth)
      || bytes[26] !== 0 || bytes[27] !== 0 || (interlace !== 0 && interlace !== 1)) return false;
    const parts: Uint8Array[] = [];
    let totalCompressed = 0, sawIdat = false, afterIdat = false, paletteEntries = 0;
    for (let at = 8; at + 12 <= bytes.length;) {
      const n = u32(at), name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      if (name === "IHDR" && at !== 8) return false;
      if (name === "PLTE") {
        // PNG palettes have 1..256 RGB triplets, appear once before IDAT, and
        // are forbidden in grayscale images. Indexed depth limits entry count.
        if (sawIdat || paletteEntries || color === 0 || color === 4
          || n === 0 || n % 3 !== 0 || n > 3 * 256
          || (color === 3 && n / 3 > 2 ** depth)) return false;
        paletteEntries = n / 3;
      }
      if (name === "IDAT") {
        if (afterIdat) return false;
        sawIdat = true;
        totalCompressed += n;
        if (totalCompressed > bytes.length) return false;
        parts.push(bytes.subarray(at + 8, at + 8 + n));
      } else if (sawIdat) afterIdat = true;
      if (name === "IEND") break;
      at += n + 12;
    }
    if (!sawIdat || totalCompressed === 0 || (color === 3 && !paletteEntries)) return false;
    const passes = interlace === 0 ? [[0, 0, 1, 1]] : [
      [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
      [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
    ];
    const rows: Array<{ w: number; h: number; rowBytes: number }> = [];
    let expected = 0;
    for (const [x, y, dx, dy] of passes) {
      const w = Math.max(0, Math.ceil((width - x) / dx));
      const h = Math.max(0, Math.ceil((height - y) / dy));
      if (!w || !h) continue;
      const rowBytes = Math.ceil(w * channels[color] * depth / 8);
      const added = h * (rowBytes + 1);
      if (!Number.isSafeInteger(added) || added > MAX_ORIGINAL_BYTES - expected) return false;
      expected += added;
      rows.push({ w, h, rowBytes });
    }
    const compressed = new Uint8Array(totalCompressed);
    let written = 0;
    for (const part of parts) { compressed.set(part, written); written += part.length; }
    const decoded = new Uint8Array(expected);
    const reader = new Blob([compressed as BlobPart]).stream()
      .pipeThrough(new DecompressionStream("deflate")).getReader();
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > expected - length) { await reader.cancel(); return false; }
      decoded.set(value, length); length += value.byteLength;
    }
    if (length !== expected) return false;
    let offset = 0;
    for (const { w, h, rowBytes } of rows) {
      // Each Adam7 pass has its own previous row; filters operate on reconstructed
      // bytes, not compressed/raw filtered bytes. Indexed PNG samples use bpp=1.
      let previous = color === 3 ? new Uint8Array(rowBytes) : undefined;
      for (let y = 0; y < h; y++) {
        const filter = decoded[offset++];
        if (filter > 4) return false;
        if (previous) {
          const current = new Uint8Array(rowBytes);
          for (let i = 0; i < rowBytes; i++) {
            const left = i ? current[i - 1] : 0;
            const above = previous[i];
            const upperLeft = i ? previous[i - 1] : 0;
            let predictor = 0;
            if (filter === 1) predictor = left;
            else if (filter === 2) predictor = above;
            else if (filter === 3) predictor = Math.floor((left + above) / 2);
            else if (filter === 4) {
              const p = left + above - upperLeft;
              const dl = Math.abs(p - left), da = Math.abs(p - above), dul = Math.abs(p - upperLeft);
              predictor = dl <= da && dl <= dul ? left : da <= dul ? above : upperLeft;
            }
            current[i] = (decoded[offset + i] + predictor) & 255;
          }
          for (let x = 0; x < w; x++) {
            const bit = x * depth;
            const pixel = (current[bit >>> 3] >>> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
            if (pixel >= paletteEntries) return false;
          }
          previous = current;
        }
        offset += rowBytes;
      }
    }
    return true;
  } catch { return false; }
}

/** The same byte/metadata admission check protects both ZIP and JSON exports.
 * A readable storage record is not proof that it matches the learner's reference. */
async function verifiedMediaBlob(
  metadata: Omit<QuestionAttachmentExportPayload, "base64">,
  options: AttachmentReadOptions,
): Promise<{ blob: Blob; bytes: Uint8Array }> {
  const record = await getQuestionAttachmentBlob(metadata.blobKey, options);
  if (!record) throw new Error("Missing image");
  const bytes = new Uint8Array(await record.blob.arrayBuffer());
  if (!Number.isSafeInteger(metadata.byteSize) || metadata.byteSize <= 0
    || metadata.byteSize > MAX_QUESTION_ATTACHMENT_BYTES
    || bytes.byteLength !== metadata.byteSize || record.byteSize !== metadata.byteSize
    || record.mimeType !== metadata.mimeType || !hasExpectedImageStructure(bytes, metadata.mimeType)
    || (metadata.mimeType === "image/png" && !(await hasInflatablePngImageData(bytes)))) throw new Error("Image record does not match its reference");
  return { blob: record.blob, bytes };
}

/** Small JSON exports require the same shared-key and byte checks as ZIP.
 * Keep one verified payload per key; conflicting aliases are reported as missing
 * rather than emitted as incompatible, falsely complete restore records. */
export async function collectVerifiedMediaBackupPayloads(
  references: References, options: AttachmentReadOptions = {},
): Promise<{ payloads: QuestionAttachmentExportPayload[]; missingBlobKeys: string[] }> {
  const scope = options.scope ?? getQuestionAttachmentScope();
  options = { ...options, scope };
  const payloads: QuestionAttachmentExportPayload[] = [];
  const missingBlobKeys: string[] = [];
  for (const { metadata, conflicting } of mediaReferences(references)) {
    if (conflicting) {
      missingBlobKeys.push(metadata.blobKey);
      continue;
    }
    try {
      const { blob } = await verifiedMediaBlob(metadata, options);
      payloads.push({ ...metadata, base64: await blobToBase64(blob) });
    } catch {
      missingBlobKeys.push(metadata.blobKey);
    }
  }
  if (!isQuestionAttachmentScopeCurrent(scope)) throw new Error("The account changed during export. Start a new export from the current workspace.");
  return { payloads, missingBlobKeys };
}

function assertConsistentMediaReferences(references: References): void {
  if (mediaReferences(references).some(entry => entry.conflicting)) {
    throw new Error("The workspace references conflicting image metadata for one storage key. Resolve the conflict before restoring images.");
  }
}

export function mediaBackupBytes(references: References): number {
  return mediaReferences(references).reduce((n, entry) => n + entry.metadata.byteSize, 0);
}

/** Binary images avoid the single-string limit of large base64 JSON backups. */
export async function createMediaBackupArchive(payload: Record<string, unknown>, references: References, documents: readonly SourceDocument[] = [], options: AttachmentReadOptions = {}) {
  const scope = options.scope ?? getQuestionAttachmentScope();
  options = { ...options, scope };
  const zip = new JSZip();
  const media: MediaEntry[] = [];
  const missingBlobKeys: string[] = [];
  for (const { metadata, conflicting } of mediaReferences(references)) {
    if (conflicting) {
      missingBlobKeys.push(metadata.blobKey);
      continue;
    }
    try {
      const { bytes } = await verifiedMediaBlob(metadata, options);
      const file = `media/${media.length}`;
      zip.file(file, bytes); media.push({ file, metadata });
    } catch { missingBlobKeys.push(metadata.blobKey); }
  }
  const originals: OriginalEntry[] = [];
  const missingOriginalIds: string[] = [];
  for (const document of backupOriginalDocuments(documents)) {
    try {
      const blob = await readSourceOriginal(document.id, document.checksum, options);
      if (!blob || blob.size > MAX_ORIGINAL_BYTES) throw new Error("Original unavailable or too large");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const file = `originals/${originals.length}`;
      zip.file(file, bytes);
      originals.push({ file, documentId: document.id, sha256: document.checksum!.replace(/^sha256:/, ""), byteSize: bytes.byteLength, mimeType: blob.type });
    } catch { missingOriginalIds.push(document.id); }
  }
  zip.file("workspace.json", JSON.stringify({ ...payload, _backupFormat: FORMAT, _backupVersion: 2, media, originals }));
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true });
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
  if (!file.name.toLowerCase().endsWith(".zip")) {
    const rawText = await file.text();
    const payloads = extractQuestionAttachmentPayloads(JSON.parse(rawText));
    return { rawText, restoreMedia: async refs => {
      assertConsistentMediaReferences(refs);
      return stageQuestionAttachmentPayloads(payloads, refs);
    }, restoreOriginals: async () => ({ restored: 0, skipped: 0 }) };
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
    const scope = getQuestionAttachmentScope();
    let restored = 0, skipped = 0;
    for (const item of originals) {
      const document = documents.find(doc => doc.id === item.documentId && doc.checksum?.replace(/^sha256:/, "") === item.sha256);
      if (!document || await readSourceOriginal(document.id, document.checksum, { scope })) { skipped++; continue; }
      const bytes = await zip.file(item.file)!.async("uint8array");
      await saveSourceOriginal(document, new Blob([bytes as BlobPart], { type: item.mimeType }), { scope });
      restored++;
    }
    return { restored, skipped };
  }, restoreMedia: async references => {
    assertConsistentMediaReferences(references);
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
