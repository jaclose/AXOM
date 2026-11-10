import { ASSET_ROLES, type AssetRole } from "./question-content/blocks";
// ===========================================================================
// Question-note image attachments (Q2b-2). Metadata is an additive, tiny
// array on QuestionRecord (schema v32 untouched); image BYTES live in the
// dedicated IndexedDB object store `questionAttachmentBlobs` — never in the
// serialized workspace JSON and never in localStorage. Portable backups may
// inline base64 payloads inside the exported file only.
// ===========================================================================
import { ATTACHMENT_STORE_NAME, STORE_NAME, DB_NAME, DB_VERSION, ensureVaultStores } from "./localVault";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent, legacyQuestionAttachmentOwnerHint, type QuestionAttachmentScope } from "./questionAttachmentScope";
import { MAX_QUESTION_ATTACHMENT_BYTES, MAX_QUESTION_ATTACHMENTS, MAX_QUESTION_ATTACHMENT_TOTAL_BYTES } from "./questionAttachmentLimits";
export { MAX_QUESTION_ATTACHMENT_BYTES, MAX_QUESTION_ATTACHMENTS, MAX_QUESTION_ATTACHMENT_TOTAL_BYTES } from "./questionAttachmentLimits";

export const QUESTION_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type QuestionAttachmentMimeType = (typeof QUESTION_ATTACHMENT_TYPES)[number];

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

/** Private-library media is content-addressed and may be referenced by more
 * than one question or review document. Removing one metadata reference must
 * never delete the shared canonical bytes. */
export function isPrivateLibraryAttachmentBlobKey(blobKey: string): boolean {
  return blobKey.startsWith("private-library:");
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
    let blocked = false;
    req.onupgradeneeded = () => ensureVaultStores(req.result);
    req.onsuccess = () => {
      if (blocked) { req.result.close(); return; }
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("Unable to open the attachment store"));
    req.onblocked = () => { blocked = true; reject(new Error("The attachment store is blocked by another tab. Close older AXOM tabs and retry.")); };
  });
}

async function withAttachmentStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openAttachmentDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACHMENT_STORE_NAME, mode);
    let req: IDBRequest<T>;
    try { req = run(tx.objectStore(ATTACHMENT_STORE_NAME)); }
    catch (error) { tx.abort(); db.close(); reject(error); return; }
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

const scopedBlobKey = (scope: QuestionAttachmentScope, blobKey: string): IDBValidKey[] => ["axom-attachment-v1", scope.owner, blobKey];
const LEGACY_OWNER_KEY = "axom.attachments.legacy-owner.v1";

function assertScope(scope: QuestionAttachmentScope, accountId?: string): void {
  if (!isQuestionAttachmentScopeCurrent(scope) || (accountId !== undefined && scope.accountId !== accountId)) {
    throw new Error("The account changed during image access. Reopen the question before retrying.");
  }
}

/** An atomic, permanent receipt prevents a later account from claiming old
 * unscoped bytes. Unknown ownership stays unknown; originals remain on disk. */
export async function readLegacyLocalBinaryOwner(): Promise<string | null> {
  const hint = legacyQuestionAttachmentOwnerHint();
  const db = await openAttachmentDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(LEGACY_OWNER_KEY);
    let owner: string | null = null;
    request.onsuccess = () => {
      if (request.result === undefined) store.add({ owner: hint }, LEGACY_OWNER_KEY);
      owner = request.result === undefined ? hint : request.result?.owner ?? null;
    };
    tx.oncomplete = () => { db.close(); resolve(owner); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Image ownership could not be verified.")); };
  });
}

export async function putQuestionAttachmentBlob(blobKey: string, record: QuestionAttachmentBlobRecord, options: AttachmentReadOptions = {}): Promise<IDBValidKey> {
  const scope = options.scope ?? getQuestionAttachmentScope();
  assertScope(scope, options.accountId);
  const key = await withAttachmentStore("readwrite", (store) => {
    assertScope(scope, options.accountId);
    return store.put(record, scopedBlobKey(scope, blobKey));
  });
  assertScope(scope, options.accountId);
  return key;
}

export type MissingAttachmentRestoreResult =
  | { status: "restored" }
  | { status: "rejected" | "exists" | "failed"; message: string };

function attachmentErrorName(error: unknown): string | undefined {
  // IndexedDB implementations and other realms may return plain Error objects,
  // so instanceof DOMException is not a reliable storage-error discriminator.
  return error && typeof error === "object" && "name" in error && typeof error.name === "string"
    ? error.name : undefined;
}

async function readableAttachmentRecord(value: QuestionAttachmentBlobRecord | undefined): Promise<boolean> {
  if (!value?.blob || typeof value.blob.arrayBuffer !== "function" || value.blob.size <= 0
    || value.blob.size !== value.byteSize || !QUESTION_ATTACHMENT_TYPES.includes(value.mimeType)) return false;
  // A Blob descriptor can survive even when its backing bytes cannot be read.
  return (await value.blob.arrayBuffer()).byteLength === value.byteSize;
}

function attachmentRestoreFailure(error: unknown, saved = false): MissingAttachmentRestoreResult {
  const prefix = saved ? "The image was saved but could not be read back. " : "AXOM could not save this image. ";
  const name = attachmentErrorName(error);
  if (name === "QuotaExceededError") return { status: "failed", message: `${prefix}The browser reported a storage-space limit. Keep the original, export a portable backup, and retry after making space.` };
  if (name === "VersionError") return { status: "failed", message: `${prefix}This tab uses an older image-store version. Reload the latest AXOM, close older AXOM tabs, and retry with the original file.` };
  if (error instanceof Error && error.message.startsWith("The attachment store is blocked by another tab.")) {
    return { status: "failed", message: `${prefix}Close older AXOM tabs so the image store can open, then retry. Keep the original file.` };
  }
  if (error instanceof Error && error.message === "The account changed during image access. Reopen the question before retrying.") {
    return { status: "failed", message: `${prefix}The account changed. Reopen this question in its original account before retrying.` };
  }
  if (["AbortError", "TransactionInactiveError", "InvalidStateError"].includes(name ?? "")) {
    return { status: "failed", message: `${prefix}The browser interrupted the image-storage transaction (${name}). Keep the original, reload AXOM, and retry.` };
  }
  if (name === "NotFoundError") return { status: "failed", message: `${prefix}The image store is unavailable in this tab. Reload the latest AXOM and retry. Keep the original and do not clear browser data.` };
  if (name === "DataCloneError") return { status: "failed", message: `${prefix}This browser could not store the selected file. Keep the original and retry in an updated browser.` };
  if (name === "NotReadableError") return { status: "failed", message: `${prefix}The browser could not read the image bytes. Keep the original, export a portable backup, and reload AXOM before retrying.` };
  if (name === "ConstraintError") return { status: "failed", message: `${prefix}An image record already reserves this key, but its bytes could not be verified. AXOM did not replace it. Keep the original and export a portable backup before repairing storage.` };
  return { status: "failed", message: `${prefix}Keep the original file and try again.` };
}

/** A missing attachment has no stored checksum, so require every recorded
 * property and a successful decode before the learner reviews the preview. */
export async function validateMissingQuestionAttachmentFile(
  file: File,
  attachment: QuestionImageAttachment,
): Promise<AttachmentValidation> {
  if (isPrivateLibraryAttachmentBlobKey(attachment.blobKey)) {
    return { ok: false, message: "This shared image must be restored from its source library." };
  }
  if (normalizeAttachmentFileName(file.name, attachment.mimeType) !== attachment.fileName) {
    return { ok: false, message: `Choose the original file named "${attachment.fileName}".` };
  }
  if (file.type !== attachment.mimeType) {
    return { ok: false, message: `"${file.name}" has a different image format from the missing file.` };
  }
  if (file.size !== attachment.byteSize) {
    return { ok: false, message: `"${file.name}" has a different file size from the missing image.` };
  }
  let dimensions: { width: number; height: number } | undefined;
  try {
    dimensions = await probeImageDimensions(file);
  } catch {
    return { ok: false, message: `"${file.name}" could not be opened as an image.` };
  }
  if (!dimensions) {
    return { ok: false, message: "This browser could not verify the image. Try a current browser." };
  }
  if ((attachment.width && dimensions.width !== attachment.width)
    || (attachment.height && dimensions.height !== attachment.height)) {
    return { ok: false, message: `"${file.name}" has different image dimensions from the missing file.` };
  }
  return { ok: true };
}

/** Add only the absent key. `add` protects a concurrently restored image from
 * replacement; metadata and question content are deliberately untouched. */
export async function restoreMissingQuestionAttachment(input: {
  file: File;
  attachment: QuestionImageAttachment;
  questionId: string;
}): Promise<MissingAttachmentRestoreResult> {
  const { attachment, file, questionId } = input;
  const scope = getQuestionAttachmentScope();
  const validation = await validateMissingQuestionAttachmentFile(file, attachment);
  if (!validation.ok) return { status: "rejected", message: validation.message };
  try {
    const existing = await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, scope });
    if (existing) {
      const readable = await readableAttachmentRecord(existing);
      assertScope(scope);
      if (!readable) return attachmentRestoreFailure({ name: "ConstraintError" });
      return { status: "exists", message: "This image is already stored. AXOM did not replace it." };
    }
    await withAttachmentStore("readwrite", (store) => {
      assertScope(scope);
      return store.add({
      blob: file,
      mimeType: attachment.mimeType,
      byteSize: file.size,
      questionId,
      updatedAt: attachment.updatedAt,
      } satisfies QuestionAttachmentBlobRecord, scopedBlobKey(scope, attachment.blobKey));
    });
  } catch (error) {
    if (attachmentErrorName(error) === "ConstraintError") {
      // A competing add can win after the initial read. A reserved key alone
      // is not evidence of usable bytes; retain malformed/dangling rows too.
      try {
        const existing = await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, scope });
        const readable = await readableAttachmentRecord(existing);
        assertScope(scope);
        if (readable) return { status: "exists", message: "This image is already stored. AXOM did not replace it." };
      } catch (readError) { return attachmentRestoreFailure(readError); }
    }
    return attachmentRestoreFailure(error);
  }
  try {
    const stored = await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, scope });
    if (!await readableAttachmentRecord(stored) || !stored || stored.questionId !== questionId || stored.mimeType !== attachment.mimeType
      || stored.byteSize !== file.size || stored.blob.size !== file.size
      || !equalBytes(new Uint8Array(await stored.blob.arrayBuffer()), new Uint8Array(await file.arrayBuffer()))) {
      return { status: "failed", message: "The image was saved but could not be verified. Keep the original file." };
    }
    assertScope(scope);
  } catch (error) {
    return attachmentRestoreFailure(error, true);
  }
  return { status: "restored" };
}

type MissingAttachmentLoader = (blobKey: string) => Promise<QuestionAttachmentBlobRecord | undefined>;
let missingAttachmentLoader: MissingAttachmentLoader | undefined;
let missingAttachmentScope: QuestionAttachmentScope | undefined;
export function setMissingAttachmentLoader(loader: MissingAttachmentLoader): () => void {
  missingAttachmentLoader = loader;
  missingAttachmentScope = getQuestionAttachmentScope();
  return () => { if (missingAttachmentLoader === loader) missingAttachmentLoader = undefined; };
}

export interface AttachmentReadOptions { localOnly?: boolean; accountId?: string; scope?: QuestionAttachmentScope }

export async function getQuestionAttachmentBlob(blobKey: string, options: AttachmentReadOptions = {}): Promise<QuestionAttachmentBlobRecord | undefined> {
  const scope = options.scope ?? getQuestionAttachmentScope();
  assertScope(scope, options.accountId);
  let local = await withAttachmentStore<QuestionAttachmentBlobRecord | undefined>("readonly", (store) => store.get(scopedBlobKey(scope, blobKey)));
  assertScope(scope, options.accountId);
  if (!local && await readLegacyLocalBinaryOwner() === scope.owner) {
    assertScope(scope, options.accountId);
    local = await withAttachmentStore<QuestionAttachmentBlobRecord | undefined>("readonly", (store) => store.get(blobKey));
  }
  assertScope(scope, options.accountId);
  const result = local ?? (options.localOnly || missingAttachmentScope !== scope ? undefined : await missingAttachmentLoader?.(blobKey));
  assertScope(scope, options.accountId);
  return result;
}

export async function deleteQuestionAttachmentBlobs(blobKeys: readonly string[], options: AttachmentReadOptions = {}): Promise<void> {
  const scope = options.scope ?? getQuestionAttachmentScope();
  assertScope(scope, options.accountId);
  for (const key of blobKeys) {
    await withAttachmentStore("readwrite", (store) => { assertScope(scope); return store.delete(scopedBlobKey(scope, key)); });
  }
}

export async function listQuestionAttachmentBlobKeys(): Promise<string[]> {
  const scope = getQuestionAttachmentScope();
  const canReadLegacy = await readLegacyLocalBinaryOwner() === scope.owner;
  const keys = await withAttachmentStore<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
  assertScope(scope);
  return [...new Set(keys.flatMap(key => Array.isArray(key)
    ? key[0] === "axom-attachment-v1" && key[1] === scope.owner && typeof key[2] === "string" ? [key[2]] : []
    : canReadLegacy && typeof key === "string" ? [key] : []))].sort();
}

/** Called only by the learner's explicit "protect this device" action.
 * Copy only known device-owned rows, never ambiguous legacy or another
 * account's rows. The device originals remain available for offline recovery. */
export async function adoptDeviceQuestionAttachments(accountId: string, blobKeys: Iterable<string>): Promise<void> {
  const scope = getQuestionAttachmentScope();
  assertScope(scope, accountId);
  const deviceScope: QuestionAttachmentScope = { owner: "device", generation: -1 };
  for (const blobKey of new Set(blobKeys)) {
    const device = await withAttachmentStore<QuestionAttachmentBlobRecord | undefined>("readonly", store => store.get(scopedBlobKey(deviceScope, blobKey)));
    assertScope(scope, accountId);
    if (!device) continue;
    const current = await getQuestionAttachmentBlob(blobKey, { localOnly: true, scope, accountId });
    if (current) {
      const [left, right] = await Promise.all([current.blob.arrayBuffer(), device.blob.arrayBuffer()]);
      if (current.mimeType !== device.mimeType || !equalBytes(new Uint8Array(left), new Uint8Array(right))) {
        throw new Error("This account already has a different image with the same identity. Export both workspaces before combining them.");
      }
      continue;
    }
    await withAttachmentStore("readwrite", store => {
      assertScope(scope, accountId);
      return store.add(device, scopedBlobKey(scope, blobKey));
    });
    assertScope(scope, accountId);
  }
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
  scope?: QuestionAttachmentScope;
}): Promise<AttachmentCreationResult> {
  const scope = input.scope ?? getQuestionAttachmentScope();
  assertScope(scope);
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
    }, { scope });
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
  /** Automatic deletion is disabled until per-account ownership can be proven. */
  deletedOrphanBlobKeys: string[];
  /** Count of retained origin-shared keys, without disclosing other accounts' key IDs. */
  preservedUnscopedBlobCount?: number;
  missingBlobKeys: string[];
}

/** Read-only inventory of the currently hydrated question references.
 *
 * IMPORTANT: questionAttachmentBlobs is shared by every account on this browser
 * origin, while this list belongs to only the currently hydrated workspace.
 * An absent key here is NOT proof that another account has discarded it.
 * Deleting an "orphan" during account B rehydration could erase account A's
 * still-referenced image. Preserve every unscoped key until the vault has
 * durable, verified account ownership and a safe legacy migration.
 *
 * Explicit, caller-authorized targeted deletion remains separate via
 * deleteQuestionAttachmentBlobs. This inventory does not fix the distinct
 * cross-account read/export issue; those paths require their own guards.
 * Retention may consume more device storage until scoped GC is implemented. */
export async function runQuestionAttachmentMaintenance(
  questions: ReadonlyArray<{ attachments?: readonly QuestionImageAttachment[] }>,
): Promise<AttachmentMaintenanceReport> {
  const referenced = new Set<string>();
  for (const question of questions) {
    for (const attachment of question.attachments ?? []) referenced.add(attachment.blobKey);
  }
  const stored = await listQuestionAttachmentBlobKeys();
  const preservedUnscopedBlobCount = stored.filter(
    (key) => !referenced.has(key) && !isPrivateLibraryAttachmentBlobKey(key),
  ).length;
  const storedSet = new Set(stored);
  const missingBlobKeys = [...referenced].filter((key) => !storedSet.has(key));
  return { deletedOrphanBlobKeys: [], preservedUnscopedBlobCount, missingBlobKeys };
}

// --- portable backup payloads ------------------------------------------------

export interface QuestionAttachmentExportPayload extends QuestionImageAttachment {
  questionId: string;
  /** Raw base64 (no data: prefix). Exists only inside exported backup files. */
  base64: string;
}

export interface StagedQuestionAttachmentRestore {
  restored: number;
  skipped: number;
  /** Remove only blob keys this restore inserted. Existing bytes are immutable. */
  rollback: () => Promise<void>;
}

export const ATTACHMENT_EXPORT_KEY = "questionAttachmentPayloads";

export async function collectQuestionAttachmentPayloads(
  questions: ReadonlyArray<{ id: string; attachments?: readonly QuestionImageAttachment[] }>,
  options: AttachmentReadOptions = {},
): Promise<{ payloads: QuestionAttachmentExportPayload[]; missingBlobKeys: string[] }> {
  const scope = options.scope ?? getQuestionAttachmentScope();
  options = { ...options, scope };
  const payloads: QuestionAttachmentExportPayload[] = [];
  const missing: string[] = [];
  for (const question of questions) {
    for (const attachment of question.attachments ?? []) {
      // One unreadable blob (missing record OR a failing arrayBuffer/base64)
      // must isolate to that attachment — never reject the whole export and
      // strip every image down to metadata-only.
      let base64: string | undefined;
      try {
        const record = await getQuestionAttachmentBlob(attachment.blobKey, options);
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
  assertScope(scope, options.accountId);
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * Stage portable-backup images before adopting their workspace metadata.
 * Blob keys are immutable identities here: matching existing bytes are reused,
 * while a different payload for an occupied key aborts without overwriting it.
 * Rollback is consequently bounded to keys inserted by this exact operation.
 */
export async function stageQuestionAttachmentPayloads(
  payloads: readonly QuestionAttachmentExportPayload[],
  questions: ReadonlyArray<{ id: string; attachments?: readonly QuestionImageAttachment[] }>,
): Promise<StagedQuestionAttachmentRestore> {
  const scope = getQuestionAttachmentScope();
  const surviving = new Map<string, QuestionImageAttachment & { questionId: string }>();
  for (const question of questions) {
    for (const attachment of question.attachments ?? []) {
      surviving.set(attachment.blobKey, { ...attachment, questionId: question.id });
    }
  }

  const inserted = new Map<string, QuestionAttachmentBlobRecord>();
  let restored = 0;
  let skipped = 0;

  const rollback = async () => {
    const failures: string[] = [];
    for (const [blobKey, staged] of inserted) {
      try {
        const current = await getQuestionAttachmentBlob(blobKey, { localOnly: true, scope });
        if (!current) continue;
        const [currentBytes, stagedBytes] = await Promise.all([
          current.blob.arrayBuffer().then(buffer => new Uint8Array(buffer)),
          staged.blob.arrayBuffer().then(buffer => new Uint8Array(buffer)),
        ]);
        if (current.mimeType !== staged.mimeType || current.questionId !== staged.questionId
          || current.updatedAt !== staged.updatedAt || !equalBytes(currentBytes, stagedBytes)) {
          failures.push(blobKey);
          continue;
        }
        await deleteQuestionAttachmentBlobs([blobKey], { scope });
      } catch {
        failures.push(blobKey);
      }
    }
    if (failures.length) {
      throw new Error(`AXOM could not confirm cleanup for ${failures.length} staged image attachment${failures.length === 1 ? "" : "s"}.`);
    }
  };

  try {
    for (const payload of payloads) {
      const target = surviving.get(payload.blobKey);
      if (!target) { skipped += 1; continue; }
      const bytes = base64ToBytes(payload.base64);
      if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_QUESTION_ATTACHMENT_BYTES
        || bytes.byteLength !== payload.byteSize || bytes.byteLength !== target.byteSize
        || payload.mimeType !== target.mimeType) {
        throw new Error("A backup image failed validation. No existing image was overwritten.");
      }

      const existing = await getQuestionAttachmentBlob(payload.blobKey, { localOnly: true, scope });
      if (existing) {
        const existingBytes = new Uint8Array(await existing.blob.arrayBuffer());
        if (existing.mimeType !== payload.mimeType || !equalBytes(existingBytes, bytes)) {
          throw new Error("A backup image uses an existing storage key with different bytes. No existing image was overwritten.");
        }
        skipped += 1;
        continue;
      }

      const record: QuestionAttachmentBlobRecord = {
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: payload.mimeType }),
        mimeType: payload.mimeType,
        byteSize: bytes.byteLength,
        questionId: target.questionId,
        updatedAt: payload.updatedAt,
      };
      await putQuestionAttachmentBlob(payload.blobKey, record, { scope });
      inserted.set(payload.blobKey, record);
      restored += 1;
    }
    assertScope(scope);
    return { restored, skipped, rollback };
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      throw new Error(`Image staging failed, and cleanup could not be confirmed after ${error instanceof Error ? error.message : "an image write failed"}. ${rollbackError instanceof Error ? rollbackError.message : "Keep this tab open and retry."}`, { cause: rollbackError });
    }
    throw error;
  }
}

/** Write imported payload bytes for every attachment the merged/restored state
 * still references. Deterministic conflicts: the surviving metadata's updatedAt
 * decides — bytes are written when the store has nothing for that key or when
 * the payload is at least as new as what is stored. */
export async function restoreQuestionAttachmentPayloads(
  payloads: readonly QuestionAttachmentExportPayload[],
  questions: ReadonlyArray<{ id: string; attachments?: readonly QuestionImageAttachment[] }>,
): Promise<{ restored: number; skipped: number }> {
  const scope = getQuestionAttachmentScope();
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
      existing = await getQuestionAttachmentBlob(payload.blobKey, { scope });
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
    }, { scope });
    restored += 1;
  }
  assertScope(scope);
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
