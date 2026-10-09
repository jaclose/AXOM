import { ASSET_ROLES, type AssetRole } from "./question-content/blocks";
// ===========================================================================
// Question-note image attachments (Q2b-2). Metadata is an additive, tiny
// array on QuestionRecord (schema v32 untouched); image BYTES live in the
// dedicated IndexedDB object store `questionAttachmentBlobs` — never in the
// serialized workspace JSON and never in localStorage. Portable backups may
// inline base64 payloads inside the exported file only.
// ===========================================================================
import { ATTACHMENT_STORE_NAME, DB_NAME, DB_VERSION, ensureVaultStores } from "./localVault";

export const QUESTION_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type QuestionAttachmentMimeType = (typeof QUESTION_ATTACHMENT_TYPES)[number];

export const MAX_QUESTION_ATTACHMENT_BYTES = 8 * 1024 * 1024;        // 8 MB per image
export const MAX_QUESTION_ATTACHMENTS = 10;                          // per question
export const MAX_QUESTION_ATTACHMENT_TOTAL_BYTES = 30 * 1024 * 1024; // per question

export interface QuestionImageAttachment {
  id: string;
  fileName: string;
  mimeType: QuestionAttachmentMimeType;
  byteSize: number;
  width?: number;
  height?: number;
  /** User-authored description. Blank is allowed; the UI reads it as "Description not added". */
  altText: string;
  createdAt: string;
  updatedAt: string;
  /** Stable key into the questionAttachmentBlobs store (today equal to id). */
  blobKey: string;
  /**
   * "exhibit": part of the question itself (an ECG, a slide, a graph), shown
   * with the stem before answering. Absent: an image the learner added to
   * their own notes, shown with the review.
   */
  role?: "exhibit" | AssetRole;
  /** Canonical content asset associated with these locally stored bytes. */
  assetId?: string;
}

export interface QuestionAttachmentBlobRecord {
  blob: Blob;
  mimeType: QuestionAttachmentMimeType;
  byteSize: number;
  questionId: string;
  updatedAt: string;
}

// --- metadata normalization (mirrors normalizeQuestionAnnotations) ----------

export function normalizeQuestionAttachments(value: unknown): QuestionImageAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const byId = new Map<string, QuestionImageAttachment>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const mimeType = QUESTION_ATTACHMENT_TYPES.includes(item.mimeType as QuestionAttachmentMimeType)
      ? item.mimeType as QuestionAttachmentMimeType : undefined;
    const byteSize = typeof item.byteSize === "number" && Number.isFinite(item.byteSize) && item.byteSize > 0
      ? Math.floor(item.byteSize) : 0;
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
    const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : "";
    if (!id || !mimeType || !byteSize || byteSize > MAX_QUESTION_ATTACHMENT_BYTES || !createdAt || !updatedAt) continue;
    const attachment: QuestionImageAttachment = {
      id,
      fileName: normalizeAttachmentFileName(typeof item.fileName === "string" ? item.fileName : "", mimeType),
      mimeType,
      byteSize,
      width: typeof item.width === "number" && item.width > 0 ? Math.floor(item.width) : undefined,
      height: typeof item.height === "number" && item.height > 0 ? Math.floor(item.height) : undefined,
      altText: typeof item.altText === "string" ? item.altText.trim().slice(0, 500) : "",
      createdAt,
      updatedAt,
      blobKey: typeof item.blobKey === "string" && item.blobKey.trim() ? item.blobKey.trim() : id,
      ...((item.role === "exhibit" || ASSET_ROLES.includes(item.role as AssetRole)) ? { role: item.role as "exhibit" | AssetRole } : {}),
      ...(typeof item.assetId === "string" ? { assetId: item.assetId } : {}),
    };
    const existing = byId.get(id);
    if (!existing || attachment.updatedAt >= existing.updatedAt) byId.set(id, attachment);
  }
  return byId.size ? [...byId.values()] : undefined;
}

const EXTENSION_BY_TYPE: Record<QuestionAttachmentMimeType, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
};

export function normalizeAttachmentFileName(name: string, mimeType: QuestionAttachmentMimeType): string {
  const fallback = `image.${EXTENSION_BY_TYPE[mimeType]}`;
  // Drop non-printable characters without a control-char regex.
  const printable = [...name.trim()].filter((ch) => ch.charCodeAt(0) >= 0x20).join("");
  const cleaned = printable.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 120);
  return cleaned || fallback;
}

// --- validation --------------------------------------------------------------

export type AttachmentValidation = { ok: true } | { ok: false; message: string };

export function validateQuestionAttachmentFile(
  file: { name: string; type: string; size: number },
  existing: readonly QuestionImageAttachment[] = [],
): AttachmentValidation {
  if (!QUESTION_ATTACHMENT_TYPES.includes(file.type as QuestionAttachmentMimeType)) {
    return { ok: false, message: "AXOM accepts PNG, JPEG, WebP, and GIF images only." };
  }
  if (file.size <= 0) {
    return { ok: false, message: `"${file.name}" is empty — it has no image data to save.` };
  }
  if (file.size > MAX_QUESTION_ATTACHMENT_BYTES) {
    return { ok: false, message: "This image is larger than the 8 MB limit." };
  }
  if (existing.length >= MAX_QUESTION_ATTACHMENTS) {
    return { ok: false, message: `This question already has ${MAX_QUESTION_ATTACHMENTS} attachments.` };
  }
  const totalBytes = existing.reduce((sum, item) => sum + Math.max(0, item.byteSize), 0);
  if (totalBytes + file.size > MAX_QUESTION_ATTACHMENT_TOTAL_BYTES) {
    return { ok: false, message: "This question has reached its 30 MB attachment limit." };
  }
  return { ok: true };
}

/** Browser-only decode check: a renamed non-image fails here. Skipped when the
 * decode API is unavailable (jsdom); declared-type validation still applies. */
export async function probeImageDimensions(blob: Blob): Promise<{ width: number; height: number } | undefined> {
  if (typeof createImageBitmap !== "function") return undefined;
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close?.();
  }
}

// --- blob store I/O ----------------------------------------------------------

function openAttachmentDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => ensureVaultStores(req.result);
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("Unable to open the attachment store"));
    req.onblocked = () => reject(new Error("The attachment store is blocked by another tab"));
  });
}

async function withAttachmentStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openAttachmentDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACHMENT_STORE_NAME, mode);
    const req = run(tx.objectStore(ATTACHMENT_STORE_NAME));
    let result: T;
    let settled = false;
    req.onsuccess = () => { result = req.result; };
    req.onerror = () => {
      if (!settled) reject(req.error ?? new Error("Attachment store request failed"));
      settled = true;
    };
    tx.oncomplete = () => {
      db.close();
      if (!settled) resolve(result);
      settled = true;
    };
    tx.onerror = () => {
      db.close();
      if (!settled) reject(tx.error ?? new Error("Attachment store transaction failed"));
      settled = true;
    };
    tx.onabort = tx.onerror;
  });
}

export function putQuestionAttachmentBlob(blobKey: string, record: QuestionAttachmentBlobRecord): Promise<IDBValidKey> {
  return withAttachmentStore("readwrite", (store) => store.put(record, blobKey));
}

export function getQuestionAttachmentBlob(blobKey: string): Promise<QuestionAttachmentBlobRecord | undefined> {
  return withAttachmentStore("readonly", (store) => store.get(blobKey));
}

export async function deleteQuestionAttachmentBlobs(blobKeys: readonly string[]): Promise<void> {
  for (const key of blobKeys) {
    await withAttachmentStore("readwrite", (store) => store.delete(key));
  }
}

export function listQuestionAttachmentBlobKeys(): Promise<string[]> {
  return withAttachmentStore<IDBValidKey[]>("readonly", (store) => store.getAllKeys())
    .then((keys) => keys.map((key) => String(key)));
}

// --- creation ---------------------------------------------------------------

export type AttachmentCreationResult =
  | { status: "created"; attachment: QuestionImageAttachment }
  | { status: "rejected"; message: string }
  | { status: "failed"; message: string };

/** Validate → write blob → return metadata. The caller persists the metadata;
 * if that persistence fails it must call deleteQuestionAttachmentBlobs([blobKey])
 * so no orphan blob survives a failed save. */
export async function createQuestionAttachment(input: {
  file: File | Blob & { name?: string; type: string; size: number };
  questionId: string;
  existing: readonly QuestionImageAttachment[];
  now?: string;
}): Promise<AttachmentCreationResult> {
  const name = ("name" in input.file && typeof input.file.name === "string" && input.file.name) || "pasted-image";
  const validation = validateQuestionAttachmentFile(
    { name, type: input.file.type, size: input.file.size },
    input.existing,
  );
  if (!validation.ok) return { status: "rejected", message: validation.message };
  const mimeType = input.file.type as QuestionAttachmentMimeType;

  let dimensions: { width: number; height: number } | undefined;
  try {
    dimensions = await probeImageDimensions(input.file as Blob);
  } catch {
    return { status: "rejected", message: `"${name}" could not be decoded as an image.` };
  }

  const now = input.now ?? new Date().toISOString();
  const id = `attachment-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  const attachment: QuestionImageAttachment = {
    id,
    fileName: normalizeAttachmentFileName(name, mimeType),
    mimeType,
    byteSize: input.file.size,
    width: dimensions?.width,
    height: dimensions?.height,
    altText: "",
    createdAt: now,
    updatedAt: now,
    blobKey: id,
  };
  try {
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: input.file as Blob,
      mimeType,
      byteSize: input.file.size,
      questionId: input.questionId,
      updatedAt: now,
    });
  } catch (error) {
    const isQuota = error instanceof DOMException && error.name === "QuotaExceededError";
    return {
      status: "failed",
      message: isQuota
        ? "AXOM could not save this image because local storage is full."
        : "AXOM could not save this image to local storage.",
    };
  }
  return { status: "created", attachment };
}

// --- orphan maintenance ------------------------------------------------------

export interface AttachmentMaintenanceReport {
  deletedOrphanBlobKeys: string[];
  missingBlobKeys: string[];
}

/** Bounded, deterministic, non-destructive sweep: deletes blobs no question
 * references; reports (but never deletes) metadata whose blob is missing.
 * SAFETY: only call with a question list that is known to be fully loaded —
 * never before store rehydration (an empty list would orphan every blob).
 * AXOM runs it post-restore/merge with the restored questions passed
 * explicitly; question deletion uses targeted deletes instead of a sweep. */
export async function runQuestionAttachmentMaintenance(
  questions: ReadonlyArray<{ attachments?: readonly QuestionImageAttachment[] }>,
): Promise<AttachmentMaintenanceReport> {
  const referenced = new Set<string>();
  for (const question of questions) {
    for (const attachment of question.attachments ?? []) referenced.add(attachment.blobKey);
  }
  const stored = await listQuestionAttachmentBlobKeys();
  const orphans = stored.filter((key) => !referenced.has(key));
  await deleteQuestionAttachmentBlobs(orphans);
  const storedSet = new Set(stored);
  const missing = [...referenced].filter((key) => !storedSet.has(key));
  return { deletedOrphanBlobKeys: orphans, missingBlobKeys: missing };
}

// --- portable backup payloads ------------------------------------------------

export interface QuestionAttachmentExportPayload extends QuestionImageAttachment {
  questionId: string;
  /** Raw base64 (no data: prefix). Exists only inside exported backup files. */
  base64: string;
}

export const ATTACHMENT_EXPORT_KEY = "questionAttachmentPayloads";

export async function collectQuestionAttachmentPayloads(
  questions: ReadonlyArray<{ id: string; attachments?: readonly QuestionImageAttachment[] }>,
): Promise<{ payloads: QuestionAttachmentExportPayload[]; missingBlobKeys: string[] }> {
  const payloads: QuestionAttachmentExportPayload[] = [];
  const missing: string[] = [];
  for (const question of questions) {
    for (const attachment of question.attachments ?? []) {
      // One unreadable blob (missing record OR a failing arrayBuffer/base64)
      // must isolate to that attachment — never reject the whole export and
      // strip every image down to metadata-only.
      let base64: string | undefined;
      try {
        const record = await getQuestionAttachmentBlob(attachment.blobKey);
        if (record) base64 = await blobToBase64(record.blob);
      } catch {
        base64 = undefined;
      }
      if (base64 === undefined) {
        missing.push(attachment.blobKey);
        continue;
      }
      payloads.push({ ...attachment, questionId: question.id, base64 });
    }
  }
  return { payloads, missingBlobKeys: missing };
}

export function extractQuestionAttachmentPayloads(raw: unknown): QuestionAttachmentExportPayload[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as Record<string, unknown>)[ATTACHMENT_EXPORT_KEY];
  if (!Array.isArray(list)) return [];
  const payloads: QuestionAttachmentExportPayload[] = [];
  for (const candidate of list) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const normalized = normalizeQuestionAttachments([item])?.[0];
    const questionId = typeof item.questionId === "string" ? item.questionId : "";
    const base64 = typeof item.base64 === "string" ? item.base64 : "";
    if (!normalized || !questionId || !base64) continue;
    // Reject payloads whose approximate decoded size exceeds the per-image cap
    // (with slack for base64 rounding); restoreQuestionAttachmentPayloads
    // re-checks the exact decoded length before writing.
    const approxBytes = Math.floor(base64.length * 0.75);
    if (approxBytes > MAX_QUESTION_ATTACHMENT_BYTES * 1.1) continue;
    payloads.push({ ...normalized, questionId, base64 });
  }
  return payloads;
}

/** Write imported payload bytes for every attachment the merged/restored state
 * still references. Deterministic conflicts: the surviving metadata's updatedAt
 * decides — bytes are written when the store has nothing for that key or when
 * the payload is at least as new as what is stored. */
export async function restoreQuestionAttachmentPayloads(
  payloads: readonly QuestionAttachmentExportPayload[],
  questions: ReadonlyArray<{ id: string; attachments?: readonly QuestionImageAttachment[] }>,
): Promise<{ restored: number; skipped: number }> {
  const surviving = new Map<string, QuestionImageAttachment & { questionId: string }>();
  for (const question of questions) {
    for (const attachment of question.attachments ?? []) {
      surviving.set(attachment.blobKey, { ...attachment, questionId: question.id });
    }
  }
  let restored = 0;
  let skipped = 0;
  for (const payload of payloads) {
    const target = surviving.get(payload.blobKey);
    if (!target) { skipped += 1; continue; }
    let existing: QuestionAttachmentBlobRecord | undefined;
    try {
      existing = await getQuestionAttachmentBlob(payload.blobKey);
    } catch {
      existing = undefined;
    }
    if (existing && existing.updatedAt > payload.updatedAt) { skipped += 1; continue; }
    if (existing && existing.updatedAt === payload.updatedAt && existing.byteSize === payload.byteSize) {
      skipped += 1;
      continue;
    }
    const bytes = base64ToBytes(payload.base64);
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_QUESTION_ATTACHMENT_BYTES) { skipped += 1; continue; }
    await putQuestionAttachmentBlob(payload.blobKey, {
      // bytes is a fresh, exact-length Uint8Array — its buffer is a plain ArrayBuffer.
      blob: new Blob([bytes.buffer as ArrayBuffer], { type: payload.mimeType }),
      mimeType: payload.mimeType,
      byteSize: bytes.byteLength,
      questionId: target.questionId,
      updatedAt: payload.updatedAt,
    });
    restored += 1;
  }
  return { restored, skipped };
}

// --- base64 helpers ----------------------------------------------------------

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array | undefined {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}
