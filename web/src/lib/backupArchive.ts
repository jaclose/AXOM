// Keep ZIP in the static dependency graph. Recovery must not fetch a new
// lazy chunk on the first export or restore after a deployment or network loss.
import JSZip from "jszip";
import { sha256Hex } from "./checksum";
import { readSourceOriginal, saveSourceOriginal } from "./decode/sources";
import type { SourceDocument } from "./library";
import { privateReviewMedia } from "./privateLibrary/media";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent } from "./questionAttachmentScope";
import {
  ATTACHMENT_EXPORT_KEY, MAX_QUESTION_ATTACHMENT_BYTES, base64ToBytes, blobToBase64,
  extractQuestionAttachmentPayloads, getQuestionAttachmentBlob, normalizeQuestionAttachments, stageQuestionAttachmentPayloads,
  type QuestionImageAttachment, type QuestionAttachmentExportPayload, type AttachmentReadOptions,
  type StagedQuestionAttachmentRestore,
} from "./questionAttachments";

type References = ReadonlyArray<{ id: string; attachments?: readonly QuestionImageAttachment[] }>;
type MediaEntry = { file: string; metadata: Omit<QuestionAttachmentExportPayload, "base64">; sha256?: string };
type OriginalEntry = { file: string; documentId: string; sha256: string; byteSize: number; mimeType: string };
/** A missing WebCrypto implementation is a recovery capability failure, not
 * evidence that the archived bytes were corrupted. Never silently accept a
 * checksum-bound ZIP member when its digest cannot be verified. */
async function requiredRestoreSha256(bytes: Uint8Array): Promise<string> {
  const digest = await sha256Hex(bytes);
  if (digest === undefined) {
    throw new Error("SHA-256 verification is unavailable in this browser or app. Restore this backup in an environment with WebCrypto support. No workspace data has been changed.");
  }
  return digest;
}

const MAX_ORIGINAL_BYTES = 128 * 1024 * 1024;
export const MAX_ZIP_WORKSPACE_BYTES = MAX_ORIGINAL_BYTES;
export const MAX_ZIP_BACKUP_ENTRIES = 30_000;
export const MAX_ZIP_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;

/** Export must obey the exact ceilings enforced by readPortableBackup.
 * Count JSZip's real entries, including generated directories and workspace.json.
 * Validate the serialized size separately because ZIP metadata adds overhead. */
class ZipExportBudgetExceeded extends Error {}
class ZipExportCryptoUnavailable extends Error {}

/** Only advertise a v3 ZIP with digest-bound members when this environment can
 * actually compute the SHA-256 required to read it again. */
async function requiredExportSha256(bytes: Uint8Array): Promise<string> {
  try {
    const digest = await sha256Hex(bytes);
    if (digest) return digest;
  } catch {
    // A present but unusable SubtleCrypto digest is also an export failure.
  }
  throw new ZipExportCryptoUnavailable("SHA-256 is unavailable; no ZIP backup was downloaded or certified.");
}
export function assertRestorableZipBudget(entryCount: number, expandedBytes: number, archiveBytes?: number): void {
  if (!Number.isSafeInteger(entryCount) || entryCount < 0 || entryCount > MAX_ZIP_BACKUP_ENTRIES) {
    throw new ZipExportBudgetExceeded("The ZIP backup exceeds 30,000 file entries. No backup was downloaded or certified.");
  }
  if (!Number.isSafeInteger(expandedBytes) || expandedBytes < 0 || expandedBytes > MAX_ZIP_BACKUP_BYTES) {
    throw new ZipExportBudgetExceeded("The ZIP backup's expanded size exceeds the 2 GB recovery safety limit. No backup was downloaded or certified.");
  }
  if (archiveBytes !== undefined && (!Number.isSafeInteger(archiveBytes) || archiveBytes < 0 || archiveBytes > MAX_ZIP_BACKUP_BYTES)) {
    throw new ZipExportBudgetExceeded("The ZIP archive size exceeds the 2 GB recovery safety limit. No backup was downloaded or certified.");
  }
}
/** Conservative JSZip STORE/streamFiles envelope for AXOM's generated ASCII paths.
 * For every entry budget the 30-byte local and 46-byte central headers,
 * both filenames, a 24-byte ZIP64-size streaming descriptor, and 64 bytes
 * of optional extras in EACH header. Reserve end/ZIP64 end/locator records,
 * even though accepted 2-GiB archives should not need ZIP64 offsets.
 *
 * This is an upper bound for the fixed generated filenames only; importer
 * limits and the final measured archive-size check stay authoritative. */
const ZIP_END_RECORD_ALLOWANCE = 22 + 56 + 20;
function zipStoredEntryEnvelope(filename: string): number {
  // All callers pass fixed generated ASCII paths (media/N, originals/N,
  // workspace.json, and their directories), so character count is UTF-8 bytes.
  // Avoid adding a TextEncoder requirement to offline/native recovery.
  return 30 + 46 + 24 + 2 * filename.length + 2 * 64;
}
/** Bound serialised STORE overhead without producing a near-2-GiB archive.
 * JSZip auto-adds category directories. File numbering uses admitted entries,
 * not metadata candidates or gaps for missing media. */
export function projectedZipSerializedOverhead(mediaCount: number, originalCount: number): number {
  assertRestorableZipEntryCounts(mediaCount, originalCount);
  let overhead = ZIP_END_RECORD_ALLOWANCE + zipStoredEntryEnvelope("workspace.json");
  if (mediaCount > 0) overhead += zipStoredEntryEnvelope("media/");
  if (originalCount > 0) overhead += zipStoredEntryEnvelope("originals/");
  for (let i = 0; i < mediaCount; i++) overhead += zipStoredEntryEnvelope(`media/${i}`);
  for (let i = 0; i < originalCount; i++) overhead += zipStoredEntryEnvelope(`originals/${i}`);
  return overhead;
}

/** Account for the actual admitted files, not just referenced candidate keys.
 * A missing or corrupt asset belongs in the omission report, and must not
 * block a restorable partial rescue. JSZip creates one directory per populated
 * media/original category; the workspace manifest is always present. */
export function assertRestorableZipEntryCounts(mediaCount: number, originalCount: number): void {
  if (!Number.isSafeInteger(mediaCount) || mediaCount < 0
    || !Number.isSafeInteger(originalCount) || originalCount < 0) {
    throw new ZipExportBudgetExceeded("The ZIP backup exceeds 30,000 file entries. No backup was downloaded or certified.");
  }
  assertRestorableZipBudget(
    1 + mediaCount + originalCount
      + Number(mediaCount > 0) + Number(originalCount > 0),
    0,
  );
}
/** When reference metadata could exceed the ZIP entry ceiling, inspect actual
 * available files before retaining binary data in JSZip. The callbacks verify
 * one candidate at a time and return its byte length, or null if unavailable.
 * A malformed/missing file is still eligible for an honest partial rescue.
 *
 * This second pass is deliberately conditional: ordinary backups do not pay
 * for duplicate media reads, while count- or byte-risk backups are probed
 * before allocating nearly 2 GiB of retained ZIP binary members.
 * Recheck the real budget when admitting each member because storage may
 * change between inspection and export. */
export async function preflightRestorableZipCandidateBudget(
  mediaCandidates: number,
  originalCandidates: number,
  probeMediaBytes: (index: number) => Promise<number | null>,
  probeOriginalBytes: (index: number) => Promise<number | null>,
  conservativeExpandedBytes = 0,
  mandatoryWorkspaceBytes = 0,
  mediaDescriptorBytes?: (candidateIndex: number, admittedIndex: number) => number,
  originalDescriptorBytes?: (candidateIndex: number, admittedIndex: number) => number,
): Promise<{ mediaAvailable: boolean[]; originalsAvailable: boolean[] } | null> {
  if (!Number.isSafeInteger(mediaCandidates) || mediaCandidates < 0
    || !Number.isSafeInteger(originalCandidates) || originalCandidates < 0) {
    throw new ZipExportBudgetExceeded("Invalid ZIP backup candidate count. No backup was downloaded or certified.");
  }
  const worstCaseEntries = 1 + mediaCandidates + originalCandidates
    + Number(mediaCandidates > 0) + Number(originalCandidates > 0);
  // Even a ZIP with fewer than 30,000 files can exceed 2 GiB before the
  // manifest is written. A conservative upper estimate selects verification,
  // never rejection: missing/corrupt candidates remain eligible for a
  // restorable partial archive.
  const possibleByteOverflow = !Number.isSafeInteger(conservativeExpandedBytes)
    || conservativeExpandedBytes > MAX_ZIP_BACKUP_BYTES;
  if (worstCaseEntries <= MAX_ZIP_BACKUP_ENTRIES && !possibleByteOverflow) return null;

  // Snapshot actual verified availability. Never add a file that was absent
  // from the preflight simply because storage changed before the second pass:
  // that could inflate the retained archive beyond the checked entry count.
  const mediaAvailable = new Array<boolean>(mediaCandidates).fill(false);
  const originalsAvailable = new Array<boolean>(originalCandidates).fill(false);
  // Even the smallest workspace.json member consumes expanded bytes. If
  // candidates alone exactly fill 2 GiB, fail before retaining their buffers.
  assertRestorableZipBudget(0, mandatoryWorkspaceBytes);
  let admittedMedia = 0, admittedOriginals = 0, expandedBytes = mandatoryWorkspaceBytes;
  let projectedManifestBytes = mandatoryWorkspaceBytes;
  // Reserve ZIP transport overhead before retaining any risk-sized binaries.
  // Incremental accounting is O(entries), unlike recomputing prior members.
  let serializedOverhead = projectedZipSerializedOverhead(0, 0);
  const record = (bytes: number, isMedia: boolean, descriptorBytes = 0) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0
      || !Number.isSafeInteger(descriptorBytes) || descriptorBytes < 0) {
      throw new ZipExportBudgetExceeded("Invalid ZIP backup candidate size. No backup was downloaded or certified.");
    }
    // Charge only descriptors and transport entries for verified present files.
    // Missing images/originals must remain eligible for partial rescue.
    if (projectedManifestBytes + descriptorBytes > MAX_ZIP_WORKSPACE_BYTES) {
      throw new ZipExportBudgetExceeded("The ZIP workspace exceeds the 128 MB recovery safety limit. No backup was downloaded or certified.");
    }
    const nextMedia = admittedMedia + Number(isMedia);
    const nextOriginals = admittedOriginals + Number(!isMedia);
    assertRestorableZipEntryCounts(nextMedia, nextOriginals);
    const nextFileName = isMedia ? `media/${admittedMedia}` : `originals/${admittedOriginals}`;
    const directoryOverhead = (isMedia && admittedMedia === 0)
      ? zipStoredEntryEnvelope("media/")
      : (!isMedia && admittedOriginals === 0)
        ? zipStoredEntryEnvelope("originals/")
        : 0;
    const nextOverhead = serializedOverhead + directoryOverhead + zipStoredEntryEnvelope(nextFileName);
    const nextExpanded = expandedBytes + bytes + descriptorBytes;
    assertRestorableZipBudget(0, nextExpanded, nextExpanded + nextOverhead);
    admittedMedia = nextMedia;
    admittedOriginals = nextOriginals;
    expandedBytes = nextExpanded;
    projectedManifestBytes += descriptorBytes;
    serializedOverhead = nextOverhead;
  };
  for (let i = 0; i < mediaCandidates; i++) {
    const size = await probeMediaBytes(i);
    if (size !== null) {
      record(size, true, mediaDescriptorBytes?.(i, admittedMedia) ?? 0);
      mediaAvailable[i] = true;
    }
  }
  for (let i = 0; i < originalCandidates; i++) {
    const size = await probeOriginalBytes(i);
    if (size !== null) {
      record(size, false, originalDescriptorBytes?.(i, admittedOriginals) ?? 0);
      originalsAvailable[i] = true;
    }
  }
  return { mediaAvailable, originalsAvailable };
}

export function backupOriginalDocuments(documents: readonly SourceDocument[]): SourceDocument[] {
  // Root and deferred aliases may describe the same immutable original. A
  // duplicate entry makes a new ZIP unreadable: recovery forbids two archive
  // members claiming the same document ID. Reject contradictory identities
  // before writing, but retain one byte source for compatible aliases.
  assertConsistentSourceDocumentChecksums(documents);
  const seen = new Set<string>();
  return documents.filter(doc => {
    if (!doc || typeof doc.id !== "string" || !/^[a-f0-9]{64}$/.test(doc.checksum?.replace(/^sha256:/, "") ?? "")
      || typeof doc.fileType !== "string" || doc.fileType.length === 0 || doc.fileType.startsWith("axom-")) return false;
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });
}
/** Root and deferred copies may mirror one original ID, but must not
 * contradict the immutable original's identity. Do not compare mutable title,
 * filename or tags; legacy internal/untyped records are not original claims.
 * Refuse ambiguity before offering Replace/Merge consent. */
function assertConsistentSourceDocumentChecksums(records: readonly unknown[]): void {
  type OriginalClaim = { digest: string; fileType?: string; sizeBytes?: number };
  const byId = new Map<string, OriginalClaim>();
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const { id, checksum, fileType, sizeBytes } = record as Partial<SourceDocument>;
    if (typeof id !== "string" || typeof checksum !== "string") continue;
    // An internal or untyped document is metadata, not an assertion about
    // source-original bytes, even when it happens to carry a valid digest.
    // Apply the same eligibility boundary as backupOriginalDocuments.
    const externalType = typeof fileType === "string" && fileType.length > 0
      && !fileType.startsWith("axom-") ? fileType.toLowerCase() : undefined;
    if (!externalType) continue;
    const digest = checksum.replace(/^sha256:/, "");
    if (!/^[a-f0-9]{64}$/.test(digest)) continue;
    const prior = byId.get(id);
    if (prior !== undefined && prior.digest !== digest) {
      throw new Error("The backup contains conflicting source-document checksums for one document ID. No workspace data has been changed.");
    }
    // Only two eligible external-original records can conflict on their MIME
    // or declared size. Invalid/absent sizes are historical metadata gaps,
    // not proof that a single source's cached original is corrupt.
    // SourceDocument.fileType permits either a MIME type or an extension.
    // Compare MIME against MIME only; "pdf" and "application/pdf" are not
    // conflicting evidence about the same immutable source bytes.
    const explicitMime = externalType?.includes("/") ? externalType : undefined;
    const externalSize = externalType !== undefined && typeof sizeBytes === "number"
      && Number.isSafeInteger(sizeBytes) && sizeBytes >= 0 ? sizeBytes : undefined;
    if (prior?.fileType && explicitMime && prior.fileType !== explicitMime) {
      throw new Error("The backup contains conflicting source-document file type for one document ID. No workspace data has been changed.");
    }
    if (prior?.sizeBytes !== undefined && externalSize !== undefined
      && prior.sizeBytes !== externalSize) {
      throw new Error("The backup contains conflicting source-document size for one document ID. No workspace data has been changed.");
    }
    byId.set(id, {
      digest,
      fileType: prior?.fileType ?? explicitMime,
      sizeBytes: prior?.sizeBytes ?? externalSize,
    });
  }
}
const FORMAT = "axom-media-backup";
// v3 binds each included image to its exported bytes. Historical v1/v2 ZIPs
// remain recoverable but lack this digest guarantee; a mutable manifest digest
// is not a signature and cannot authenticate the original source of an image.
export const LARGE_MEDIA_BACKUP_BYTES = 128 * 1024 * 1024;
// Small JSON backups include base64 inline; reject unbounded parsing/inflate.
// ZIP remains the supported format for larger original exports.
export const MAX_JSON_BACKUP_BYTES = 256 * 1024 * 1024;
export const MAX_JSON_MEDIA_RECORDS = 4096;
const MAX_JSON_MEDIA_BYTES = LARGE_MEDIA_BACKUP_BYTES;

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


/** Reject JPEGs that merely have SOI/EOI sentinels but no image data.
 * Walk variable-length marker segments and entropy-byte stuffing without
 * expanding pixels or trusting a metadata MIME label. This proves structural
 * plausibility only; it is not a full image decode or source checksum. */
function hasExpectedJpegStructure(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2, sawFrame = false, sawScan = false, sawEntropy = false, inEntropy = false;
  while (offset < bytes.length) {
    if (inEntropy && bytes[offset] !== 0xff) {
      sawEntropy = true;
      offset++;
      continue;
    }
    if (bytes[offset] !== 0xff) return false;
    let markerAt = offset + 1;
    while (markerAt < bytes.length && bytes[markerAt] === 0xff) markerAt++;
    if (markerAt >= bytes.length) return false;
    const marker = bytes[markerAt];
    offset = markerAt + 1;
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      if (!inEntropy) return false;
      sawEntropy = true;
      continue;
    }
    if (marker === 0xd9) return sawFrame && sawScan && sawEntropy && offset === bytes.length;
    if (marker === 0xd8) return false; // Nested start-of-image is never an image segment.
    if (marker === 0x01) {
      if (inEntropy) return false;
      continue; // TEM has no length field.
    }
    inEntropy = false;
    if (offset + 2 > bytes.length) return false;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    const isFrame = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (sawFrame || segmentLength < 11) return false;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const components = bytes[offset + 7];
      if (!width || !height || !components || segmentLength !== 8 + 3 * components) return false;
      sawFrame = true;
    }
    if (marker === 0xda) {
      if (!sawFrame || segmentLength < 8) return false;
      const components = bytes[offset + 2];
      if (!components || segmentLength !== 6 + 2 * components) return false;
      sawScan = true;
      inEntropy = true;
    }
    offset += segmentLength;
  }
  return false;
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
  if (mime === "image/jpeg") return hasExpectedJpegStructure(bytes);
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
  const referencedMedia = mediaReferences(references);
  const eligibleOriginals = backupOriginalDocuments(documents);
  // Metadata is a *conservative* trigger, not an admission decision. Media
  // bytes are checked against their declared sizes; originals may reach
  // MAX_ORIGINAL_BYTES regardless of stale sizeBytes metadata. Reserve the
  // maximum permitted workspace manifest for preflight selection too.
  // Only verified present files count towards the actual first-pass budget,
  // preserving honest partial recovery when references have lost their blobs.
  const potentialMediaBytes = referencedMedia.reduce((sum, { metadata }) => (
    sum + (Number.isSafeInteger(metadata.byteSize) && metadata.byteSize >= 0
      ? metadata.byteSize : MAX_QUESTION_ATTACHMENT_BYTES)
  ), 0);
  const potentialExpandedBytes = potentialMediaBytes
    + eligibleOriginals.length * MAX_ORIGINAL_BYTES + MAX_ZIP_WORKSPACE_BYTES;
  const candidateEntries = 1 + referencedMedia.length + eligibleOriginals.length
    + Number(referencedMedia.length > 0) + Number(eligibleOriginals.length > 0);
  const needsPreflight = candidateEntries > MAX_ZIP_BACKUP_ENTRIES
    || !Number.isSafeInteger(potentialExpandedBytes)
    || potentialExpandedBytes > MAX_ZIP_BACKUP_BYTES;
  // Start with the no-file JSON and charge exact image descriptors and a
  // safe upper bound for each original descriptor only when that file is
  // verified as present. Reserve all projected JSON before retaining binary
  // ZIP entries; absent assets never consume the preflight budget.
  const mandatoryWorkspaceBytes = needsPreflight
    ? new Blob([JSON.stringify({
      ...payload, _backupFormat: FORMAT, _backupVersion: 3, media: [], originals: [],
    })], { type: "application/json" }).size
    : 0;
  if (mandatoryWorkspaceBytes > MAX_ZIP_WORKSPACE_BYTES) {
    throw new ZipExportBudgetExceeded("The ZIP workspace exceeds the 128 MB recovery safety limit. No backup was downloaded or certified.");
  }
  const preflight = await preflightRestorableZipCandidateBudget(
    referencedMedia.length, eligibleOriginals.length,
    async index => {
      const { metadata, conflicting } = referencedMedia[index];
      if (conflicting) return null;
      try {
        const { bytes } = await verifiedMediaBlob(metadata, options);
        return bytes.byteLength;
      } catch { return null; }
    },
    async index => {
      const document = eligibleOriginals[index];
      try {
        const blob = await readSourceOriginal(document.id, document.checksum, options);
        return blob && blob.size <= MAX_ORIGINAL_BYTES && blob.type.length <= 255 ? blob.size : null;
      } catch { return null; }
    },
    potentialExpandedBytes,
    mandatoryWorkspaceBytes,
    (candidateIndex, admittedIndex) => new Blob([JSON.stringify({
      file: `media/${admittedIndex}`,
      metadata: referencedMedia[candidateIndex].metadata,
      sha256: "0".repeat(64),
    })], { type: "application/json" }).size + Number(admittedIndex > 0),
    (candidateIndex, admittedIndex) => {
      const document = eligibleOriginals[candidateIndex];
      // The original's Blob MIME may differ from document.fileType. A 255
      // printable-ASCII-character worst case, all JSON-escaped, bounds any
      // importer-admissible MIME without guessing its value or size.
      return new Blob([JSON.stringify({
        file: `originals/${admittedIndex}`,
        documentId: document.id,
        sha256: document.checksum!.replace(/^sha256:/, ""),
        byteSize: MAX_ORIGINAL_BYTES,
        mimeType: "\\".repeat(255),
      })], { type: "application/json" }).size + Number(admittedIndex > 0);
    },
  );
  if (!isQuestionAttachmentScopeCurrent(scope)) {
    throw new Error("The account changed during export. Start a new export from the current workspace.");
  }
  // Speculative candidate counts cannot reject a partial rescue: unavailable
  // files are explicitly reported and omitted. Budget each admitted ZIP member
  // after verifying its bytes, before writing the entry or claiming success.
  const zip = new JSZip();
  const media: MediaEntry[] = [];
  const missingBlobKeys: string[] = [];
  let expandedBytes = 0;
  const reserveExpandedBytes = (bytes: number) => {
    assertRestorableZipBudget(0, expandedBytes + bytes);
    expandedBytes += bytes;
  };
  for (const [index, { metadata, conflicting }] of referencedMedia.entries()) {
    if (conflicting || (preflight && !preflight.mediaAvailable[index])) {
      missingBlobKeys.push(metadata.blobKey);
      continue;
    }
    let bytes: Uint8Array;
    try {
      ({ bytes } = await verifiedMediaBlob(metadata, options));
    } catch {
      missingBlobKeys.push(metadata.blobKey);
      continue;
    }
    // A missing asset may be salvaged as metadata only; budget or digest
    // failures must instead abort the export, never certify a weaker copy.
    reserveExpandedBytes(bytes.byteLength);
    assertRestorableZipEntryCounts(media.length + 1, 0);
    const file = `media/${media.length}`;
    const sha256 = await requiredExportSha256(bytes);
    zip.file(file, bytes);
    media.push({ file, metadata, sha256 });
  }
  const originals: OriginalEntry[] = [];
  const missingOriginalIds: string[] = [];
  for (const [index, document] of eligibleOriginals.entries()) {
    if (preflight && !preflight.originalsAvailable[index]) {
      missingOriginalIds.push(document.id);
      continue;
    }
    try {
      const blob = await readSourceOriginal(document.id, document.checksum, options);
      if (!blob || blob.size > MAX_ORIGINAL_BYTES || blob.type.length > 255) throw new Error("Original unavailable or fails MIME safety limit");
      // Check the declared size before allocating original bytes, then account
      // for the actual buffer length only after the read succeeds.
      assertRestorableZipBudget(0, expandedBytes + blob.size);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      reserveExpandedBytes(bytes.byteLength);
      assertRestorableZipEntryCounts(media.length, originals.length + 1);
      // Source originals are validated by the local noble-hashes reader, but a
      // v3 ZIP must also be digest-verifiable in its exporting environment.
      const sha256 = await requiredExportSha256(bytes);
      if (sha256 !== document.checksum!.replace(/^sha256:/, "")) {
        throw new Error("Original checksum changed during export");
      }
      const file = `originals/${originals.length}`;
      zip.file(file, bytes);
      originals.push({ file, documentId: document.id, sha256, byteSize: bytes.byteLength, mimeType: blob.type });
    } catch (error) {
      if (error instanceof ZipExportBudgetExceeded || error instanceof ZipExportCryptoUnavailable) throw error;
      missingOriginalIds.push(document.id);
    }
  }
  // The ZIP reader limits the uncompressed workspace.json entry to 128 MiB.
  // Do not produce a backup the same application would refuse to restore.
  const workspaceJson = JSON.stringify({ ...payload, _backupFormat: FORMAT, _backupVersion: 3, media, originals });
  const workspaceBytes = new Blob([workspaceJson], { type: "application/json" }).size;
  if (workspaceBytes > MAX_ZIP_WORKSPACE_BYTES) {
    throw new Error("The ZIP workspace exceeds the 128 MB recovery safety limit. No backup was downloaded or certified.");
  }
  reserveExpandedBytes(workspaceBytes);
  zip.file("workspace.json", workspaceJson);
  const entryCount = Object.keys(zip.files).length;
  // No near-limit ZIP may reach generateAsync if the mandatory streamed headers,
  // category directories, central directory and end records cannot fit.
  assertRestorableZipBudget(entryCount, expandedBytes,
    expandedBytes + projectedZipSerializedOverhead(media.length, originals.length));
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true });
  // STORE still adds per-file headers/central directory bytes. The generated
  // ZIP must fit the reader's file-size bound, not just its uncompressed data.
  assertRestorableZipBudget(entryCount, expandedBytes, blob.size);
  if (!isQuestionAttachmentScopeCurrent(scope)) throw new Error("The account changed during export. Start a new export from the current workspace.");
  return { blob, attachmentCount: media.length, missingBlobKeys, originalCount: originals.length, missingOriginalIds };
}

export interface PortableBackupRead {
  rawText: string;
  /** Referenced file bytes absent from this portable archive, irrespective of
   * its declared complete/saved-work label. Metadata may still be restored. */
  omissions: { missingBlobKeys: string[]; missingOriginalIds: string[] };
  restoreOriginals: (documents: readonly SourceDocument[]) => Promise<{ restored: number; skipped: number }>;
  restoreMedia: (references: References) => Promise<StagedQuestionAttachmentRestore>;
}

/** Read and validate a portable copy before any workspace state is adopted. */
export async function readPortableBackup(file: File): Promise<PortableBackupRead> {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    // Guard before allocating the whole JSON string; older oversized files
    // remain unchanged so they can be handled without destructive recovery.
    if (file.size > MAX_JSON_BACKUP_BYTES) {
      throw new Error("This JSON backup exceeds the 256 MB safety limit. No workspace data has been changed.");
    }
    const rawText = await file.text();
    const parsed = JSON.parse(rawText) as unknown;
    const declared = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)[ATTACHMENT_EXPORT_KEY] : undefined;
    if (Array.isArray(declared) && declared.length > MAX_JSON_MEDIA_RECORDS) {
      throw new Error("The JSON backup contains too many image records. No workspace data has been changed.");
    }
    const payloads = extractQuestionAttachmentPayloads(parsed);
    // Do not silently discard malformed records from a portable JSON image
    // list, or expose a workspace whose embedded bytes cannot be restored.
    if (declared !== undefined && (!Array.isArray(declared) || declared.length !== payloads.length)) {
      throw new Error("The backup contains an invalid or missing image record.");
    }
    // Check the aggregate declared work before decoding or inflating any image.
    // Count every record, including duplicates, since each costs parsing work.
    let declaredMediaBytes = 0;
    for (const payload of payloads) {
      declaredMediaBytes += payload.byteSize;
      if (!Number.isSafeInteger(declaredMediaBytes) || declaredMediaBytes > MAX_JSON_MEDIA_BYTES) {
        throw new Error("The JSON backup's total image size exceeds the 128 MB safety limit. No workspace data has been changed.");
      }
    }
    const verified = new Map<string, { mimeType: string; byteSize: number; bytes: Uint8Array }>();
    for (const payload of payloads) {
      const bytes = base64ToBytes(payload.base64);
      if (!bytes || bytes.byteLength !== payload.byteSize) {
        throw new Error("A backup image failed its integrity check. No workspace data has been changed.");
      }
      const prior = verified.get(payload.blobKey);
      // Immutable storage keys can be shared by several question references.
      // Equal bytes are permitted; conflicting metadata or bytes must fail
      // BEFORE workspace adoption, not only during side-effectful staging.
      if (prior) {
        if (prior.mimeType !== payload.mimeType || prior.byteSize !== payload.byteSize
          || prior.bytes.some((byte, index) => byte !== bytes[index])) {
          throw new Error("The JSON backup contains conflicting image records for one storage key. No workspace data has been changed.");
        }
        continue;
      }
      if (!hasExpectedImageStructure(bytes, payload.mimeType)
        || (payload.mimeType === "image/png" && !(await hasInflatablePngImageData(bytes)))) {
        throw new Error("A backup image failed its integrity check. No workspace data has been changed.");
      }
      verified.set(payload.blobKey, { mimeType: payload.mimeType, byteSize: payload.byteSize, bytes });
    }
    // A complete JSON file can carry references without corresponding image
    // payloads, including historical attachments with id but no blobKey.
    // Inspect the actual validated binary records before offering recovery.
    // JSON never embeds original-file manifests, so do not infer original
    // omissions from source-document metadata.
    const workspace = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as {
        questions?: Array<{ id: string; attachments?: QuestionImageAttachment[] }>;
        documents?: SourceDocument[];
        deferredContent?: {
          questions?: Array<{ id: string; attachments?: QuestionImageAttachment[] }>;
          documents?: SourceDocument[];
        };
      } : {};
    // Verify all root/deferred claims before filtering out historical records
    // without fileType. A filtered duplicate must not hide a contradictory ID.
    const documentRecords = [
      ...(Array.isArray(workspace.documents) ? workspace.documents : []),
      ...(Array.isArray(workspace.deferredContent?.documents) ? workspace.deferredContent.documents : []),
    ];
    assertConsistentSourceDocumentChecksums(documentRecords);
    const sourceDocuments = documentRecords.filter((doc): doc is SourceDocument =>
      !!doc && typeof doc.id === "string" && typeof doc.fileType === "string");
    const questions = [
      ...(Array.isArray(workspace.questions) ? workspace.questions : []),
      ...(Array.isArray(workspace.deferredContent?.questions) ? workspace.deferredContent.questions : []),
    ].filter(question => !!question && typeof question.id === "string")
      .map(question => ({
        id: question.id,
        attachments: normalizeQuestionAttachments(question.attachments) ?? [],
      }));
    const expected = mediaReferences([...questions, ...privateReviewMedia(sourceDocuments)]);
    // An embedded image is usable only if its validated bytes and declared
    // metadata match *every* question reference to the same immutable key.
    // Refuse contradictions before the Settings confirmation, not after the
    // workspace has been offered for replacement. Missing bytes alone remain
    // eligible for explicitly disclosed metadata-only partial recovery.
    for (const { metadata, conflicting } of expected) {
      if (conflicting) {
        throw new Error("The JSON backup references conflicting image metadata for one storage key. No workspace data has been changed.");
      }
      const embedded = verified.get(metadata.blobKey);
      if (embedded && (embedded.mimeType !== metadata.mimeType || embedded.byteSize !== metadata.byteSize)) {
        throw new Error("A JSON backup image does not match its reference MIME or size. No workspace data has been changed.");
      }
    }
    const omissions = {
      missingBlobKeys: [...new Set(expected.map(({ metadata }) => metadata.blobKey).filter(key => !verified.has(key)))],
      missingOriginalIds: [] as string[],
    };
    return { rawText, omissions, restoreMedia: async refs => {
      assertConsistentMediaReferences(refs);
      return stageQuestionAttachmentPayloads(payloads, refs);
    }, restoreOriginals: async () => ({ restored: 0, skipped: 0 }) };
  }
  if (file.size > MAX_ZIP_BACKUP_BYTES) throw new Error("This backup exceeds the 2 GB archive limit.");
  const zip = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()));
  if (Object.keys(zip.files).length > MAX_ZIP_BACKUP_ENTRIES) throw new Error("Too many files in this backup.");
  let expanded = 0;
  for (const entry of Object.values(zip.files)) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    const limit = entry.name === "workspace.json" || /^originals\/\d+$/.test(entry.name) ? MAX_ORIGINAL_BYTES : MAX_QUESTION_ATTACHMENT_BYTES;
    if (size < 0 || size > limit) throw new Error("A backup file exceeds the safety limit.");
    expanded += size;
  }
  if (expanded > MAX_ZIP_BACKUP_BYTES) throw new Error("The expanded backup exceeds the safety limit.");
  const workspace = zip.file("workspace.json");
  if (!workspace) throw new Error("This ZIP is not an AXOM workspace backup. Prepared libraries are installed from the Course Library or QBank.");
  const rawText = await workspace.async("string");
  const manifest = JSON.parse(rawText) as {
    _backupFormat?: string; _backupVersion?: number; media?: MediaEntry[]; originals?: OriginalEntry[];
    questions?: Array<{ id: string; attachments?: QuestionImageAttachment[] }>;
    documents?: SourceDocument[];
    deferredContent?: { questions?: Array<{ id: string; attachments?: QuestionImageAttachment[] }>; documents?: SourceDocument[] };
  };
  if (manifest._backupFormat !== FORMAT || ![1, 2, 3].includes(manifest._backupVersion ?? 0) || !Array.isArray(manifest.media)) throw new Error("Unsupported workspace backup format.");
  const media = manifest.media;
  const mediaFiles = new Set<string>();
  const mediaMetadata = new Map<string, { mimeType: string; byteSize: number }>();
  for (const item of media) {
    if (!item || !/^media\/\d+$/.test(item.file) || !zip.file(item.file)) throw new Error("The backup contains an invalid or missing image record.");
    // Use the same normalized fallback as restore: historical ZIP media
    // without a blobKey can still identify a distinct image by attachment ID.
    const normalized = extractQuestionAttachmentPayloads({ [ATTACHMENT_EXPORT_KEY]: [{ ...item.metadata, base64: "AA==" }] });
    if (normalized.length !== 1) throw new Error("The backup contains an invalid or missing image record.");
    // Validate the actual archive bytes, not only metadata, before handing
    // workspace JSON to the caller. Use the export-side image predicates so
    // ZIP imports cannot silently accept media that a new export would hold.
    // New archives must carry a well-formed digest for every included image.
    // Older archives may omit it, but a present digest is never ignored.
    if ((manifest._backupVersion === 3 && item.sha256 === undefined)
      || (item.sha256 !== undefined && (typeof item.sha256 !== "string"
        || !/^[a-f0-9]{64}$/.test(item.sha256)))) {
      throw new Error("A backup image has an invalid or missing SHA-256 digest. No workspace data has been changed.");
    }
    const imageBytes = await zip.file(item.file)!.async("uint8array");
    const { mimeType, byteSize } = normalized[0];
    if (imageBytes.byteLength !== byteSize || !hasExpectedImageStructure(imageBytes, mimeType)
      || (mimeType === "image/png" && !(await hasInflatablePngImageData(imageBytes)))) {
      throw new Error("A backup image failed its integrity check. No workspace data has been changed.");
    }
    if (item.sha256 !== undefined && await requiredRestoreSha256(imageBytes) !== item.sha256) {
      throw new Error("A backup image failed its SHA-256 integrity check. No workspace data has been changed.");
    }
    // One stored image per immutable key and archive path: reject aliases
    // before exposing workspace metadata for adoption.
    if (mediaFiles.has(item.file) || mediaMetadata.has(normalized[0].blobKey)) {
      throw new Error("The backup contains duplicate image records. No workspace data has been changed.");
    }
    mediaFiles.add(item.file);
    mediaMetadata.set(normalized[0].blobKey, { mimeType, byteSize });
  }
  const originals = (manifest._backupVersion ?? 0) >= 2 ? manifest.originals : [];
  if (!Array.isArray(originals)) throw new Error("The backup has no original-file manifest.");
  const ids = new Set<string>(), files = new Set<string>();
  const documentRecords = [
    ...(Array.isArray(manifest.documents) ? manifest.documents : []),
    ...(Array.isArray(manifest.deferredContent?.documents) ? manifest.deferredContent.documents : []),
  ];
  assertConsistentSourceDocumentChecksums(documentRecords);
  const sourceDocuments = documentRecords.filter((doc): doc is SourceDocument =>
    !!doc && typeof doc.id === "string" && typeof doc.fileType === "string");
  // Never collapse root/deferred records before assessing original completeness:
  // a later internal, untyped or malformed alias cannot erase an eligible root.
  // Valid duplicate digests have already passed the cross-record consistency check.
  const originalDigestById = new Map<string, string>(
    backupOriginalDocuments(sourceDocuments).map(doc =>
      [doc.id, doc.checksum?.replace(/^sha256:/, "") ?? ""] as const),
  );
  // Check integrity before the caller offers to adopt any workspace records.
  for (const item of originals) {
    if (!item || typeof item.documentId !== "string" || ids.has(item.documentId) || files.has(item.file)
      || !/^originals\/\d+$/.test(item.file) || !zip.file(item.file) || !/^[a-f0-9]{64}$/.test(item.sha256)
      || !Number.isSafeInteger(item.byteSize) || item.byteSize < 0 || item.byteSize > MAX_ORIGINAL_BYTES
      || typeof item.mimeType !== "string" || item.mimeType.length > 255
      || originalDigestById.get(item.documentId) !== item.sha256) throw new Error("The backup contains an invalid or missing original-file record.");
    const bytes = await zip.file(item.file)!.async("uint8array");
    if (bytes.byteLength !== item.byteSize || await requiredRestoreSha256(bytes) !== item.sha256) throw new Error("An original file failed its backup integrity check. No workspace data has been changed.");
    ids.add(item.documentId); files.add(item.file);
  }
  // An archive can say _backupScope: "complete" while omitting source bytes.
  // Derive omissions from its actual referenced metadata and verified members,
  // not from a producer assertion. This also works for older v1/v2 ZIPs.
  // Review-image references may live on synthetic review documents without
  // checksum-bound originals. Keep them for media completeness; the original
  // filter independently limits original-file expectations to valid checksums.
  const missingOriginalIds = [...originalDigestById.keys()].filter(id => !ids.has(id));
  const questions = [
    ...(Array.isArray(manifest.questions) ? manifest.questions : []),
    ...(Array.isArray(manifest.deferredContent?.questions) ? manifest.deferredContent.questions : []),
  ].filter(question => question && typeof question.id === "string")
    .map(question => ({
      id: question.id,
      // Historical v1/v2 metadata may have id without blobKey. Parse/import
      // accepts those records and uses id as the storage key; completeness must
      // inspect the same normalized references or it can hide missing bytes.
      attachments: normalizeQuestionAttachments(question.attachments) ?? [],
    }));
  const expectedMedia = mediaReferences([...questions, ...privateReviewMedia(sourceDocuments)]);
  // Match JSON recovery: a verified ZIP member proves its own bytes, not that
  // every imported workspace reference describes the same immutable media.
  // Reject contradictions before Settings can offer Replace/Merge consent.
  // A genuinely absent member is still eligible for disclosed partial rescue.
  for (const { metadata, conflicting } of expectedMedia) {
    if (conflicting) {
      throw new Error("The ZIP backup references conflicting image metadata for one storage key. No workspace data has been changed.");
    }
    const embedded = mediaMetadata.get(metadata.blobKey);
    if (embedded && (embedded.mimeType !== metadata.mimeType || embedded.byteSize !== metadata.byteSize)) {
      throw new Error("A ZIP backup image does not match its reference MIME or size. No workspace data has been changed.");
    }
  }
  const missingBlobKeys = expectedMedia
    .map(({ metadata }) => metadata.blobKey).filter(key => !mediaMetadata.has(key));
  const omissions = { missingBlobKeys, missingOriginalIds };
  return { rawText, omissions, restoreOriginals: async documents => {
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
