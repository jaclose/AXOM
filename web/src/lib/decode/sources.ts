// ===========================================================================
// Verified original files cached on this device.
//
// In the workspace a source document is its text and its identity (a
// checksum of the file's bytes). Showing a page as it was drawn needs the
// file itself, which is far too large for a workspace snapshot or for sync.
// Copies live in this IndexedDB database, keyed by account and document identity.
// An explicit academic download can restore a copy from the protected
// immutable backend file; attaching the exact local original also works.
// Workspace snapshots carry identity and text, not these binary bytes.
//
// A file is only accepted when its bytes match the document's checksum: a
// different version of the file would put other pages behind the page
// numbers that analyses cite.
// ===========================================================================
import { sha256 } from "@noble/hashes/sha2.js";
import type { SourceDocument } from "../library";
import { readLegacyLocalBinaryOwner } from "../questionAttachments";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent, type QuestionAttachmentScope } from "../questionAttachmentScope";

export const SOURCE_ORIGINALS_DB = "axom-decode-originals-v1";
export const SOURCE_ORIGINALS_DB_VERSION = 2;
const STORE = "originals";
/** Keep each IndexedDB value comfortably below the size at which Chromium
 * starts rejecting otherwise valid source originals. */
export const SOURCE_ORIGINAL_CHUNK_BYTES = 8 * 1024 * 1024;
const CHUNKED_SOURCE_ORIGINAL_MIN_BYTES = SOURCE_ORIGINAL_CHUNK_BYTES;

interface ChunkedSourceOriginal {
  kind: "chunked-source-original";
  version: 1;
  checksum: string;
  byteSize: number;
  mimeType: string;
  chunkBytes: number;
  chunkCount: number;
  storageId: string;
}

export type SourceOriginalProblem = "no-fingerprint" | "different-file" | "storage";

export class SourceOriginalError extends Error {
  readonly problem: SourceOriginalProblem;
  constructor(problem: SourceOriginalProblem, message: string) {
    super(message);
    this.name = "SourceOriginalError";
    this.problem = problem;
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SOURCE_ORIGINALS_DB, SOURCE_ORIGINALS_DB_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(new SourceOriginalError("storage", "The original file could not be opened on this device."));
    request.onblocked = () => { blocked = true; reject(new SourceOriginalError("storage", "Close other AXOM tabs and try again.")); };
  });
}

export interface SourceOriginalAccess { scope?: QuestionAttachmentScope; accountId?: string }

function assertOriginalScope(scope: QuestionAttachmentScope, accountId?: string): void {
  if (!isQuestionAttachmentScopeCurrent(scope) || (accountId !== undefined && scope.accountId !== accountId)) {
    throw new SourceOriginalError("storage", "The account changed while accessing this original file. Reopen the source and retry.");
  }
}

type OriginalStorageId = string | IDBValidKey[];
const scopedDocumentId = (owner: string, documentId: string): IDBValidKey[] => ["axom-original-v2", owner, documentId];

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>, failure: string, scope: QuestionAttachmentScope): Promise<T> {
  assertOriginalScope(scope);
  const db = await open();
  try {
    assertOriginalScope(scope);
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const fail = () => reject(new SourceOriginalError("storage", failure));
      let request: IDBRequest<T>;
      try {
        request = run(transaction.objectStore(STORE));
      } catch {
        transaction.abort();
        fail();
        return;
      }
      transaction.oncomplete = () => {
        try { assertOriginalScope(scope); resolve(request.result); }
        catch (error) { reject(error); }
      };
      transaction.onerror = fail;
      transaction.onabort = fail;
    });
  } finally {
    db.close();
  }
}

const versionKey = (id: OriginalStorageId, checksum: string) => ["version", id, checksum];
const chunkKey = (id: OriginalStorageId, storageId: string, index: number) => ["chunk", id, storageId, index];
const fingerprint = (checksum: string) => checksum.replace(/^sha256:/, "");

function isChunkedSourceOriginal(value: unknown): value is ChunkedSourceOriginal {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChunkedSourceOriginal>;
  return item.kind === "chunked-source-original" && item.version === 1
    && typeof item.checksum === "string" && typeof item.byteSize === "number"
    && typeof item.mimeType === "string" && item.chunkBytes === SOURCE_ORIGINAL_CHUNK_BYTES
    && Number.isSafeInteger(item.chunkCount) && (item.chunkCount ?? 0) > 0
    && typeof item.storageId === "string";
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

/** Hash slices rather than materializing a second copy of a large PDF. */
async function hashBlob(blob: Blob): Promise<string> {
  const digest = sha256.create();
  for (let start = 0; start < blob.size; start += SOURCE_ORIGINAL_CHUNK_BYTES) {
    const end = Math.min(blob.size, start + SOURCE_ORIGINAL_CHUNK_BYTES);
    digest.update(new Uint8Array(await blob.slice(start, end).arrayBuffer()));
  }
  return hex(digest.digest());
}

function newStorageId(checksum: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${checksum}-${suffix}`;
}

async function deleteKeys(keys: IDBValidKey[], scope: QuestionAttachmentScope): Promise<void> {
  for (const key of keys) {
    await withStore("readwrite", store => store.delete(key), "The original file could not be removed.", scope);
  }
}

/** Materialize every Blob handle in one readonly transaction. IndexedDB keeps
 * a repairing writer behind this transaction; once it completes, these Blob
 * handles remain readable even if the retired chunk records are reclaimed. */
async function readChunkHandles(
  documentId: OriginalStorageId,
  manifest: ChunkedSourceOriginal,
  failure: string,
  scope: QuestionAttachmentScope,
): Promise<Blob[] | undefined> {
  assertOriginalScope(scope);
  const db = await open();
  try { assertOriginalScope(scope); } catch (error) { db.close(); throw error; }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const store = transaction.objectStore(STORE);
    const chunks = new Array<Blob>(manifest.chunkCount);
    let invalid = false;
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      const request = store.get(chunkKey(documentId, manifest.storageId, index));
      request.onsuccess = () => {
        const expectedSize = Math.min(manifest.chunkBytes, manifest.byteSize - index * manifest.chunkBytes);
        if (!(request.result instanceof Blob) || request.result.size !== expectedSize) {
          invalid = true;
          return;
        }
        chunks[index] = request.result;
      };
      request.onerror = () => { invalid = true; };
    }
    transaction.oncomplete = () => {
      db.close();
      try { assertOriginalScope(scope); } catch (error) { reject(error); return; }
      resolve(invalid || chunks.some(chunk => !(chunk instanceof Blob)) ? undefined : chunks);
    };
    const fail = () => {
      db.close();
      reject(new SourceOriginalError("storage", failure));
    };
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

async function readChunked(documentId: OriginalStorageId, manifest: ChunkedSourceOriginal, checksum: string, scope: QuestionAttachmentScope): Promise<Blob | undefined> {
  if (manifest.checksum !== checksum || manifest.byteSize < 0
      || manifest.chunkCount !== Math.ceil(manifest.byteSize / manifest.chunkBytes)) return undefined;
  const digest = sha256.create();
  const chunks = await readChunkHandles(documentId, manifest, "AXOM could not read this version of the original file.", scope);
  if (!chunks) return undefined;
  for (const chunk of chunks) {
    digest.update(new Uint8Array(await chunk.arrayBuffer()));
  }
  return hex(digest.digest()) === checksum ? new Blob(chunks, { type: manifest.mimeType }) : undefined;
}

async function readVersion(documentId: OriginalStorageId, checksum: string, value: unknown, scope: QuestionAttachmentScope): Promise<Blob | undefined> {
  if (value instanceof Blob) return await hashBlob(value) === checksum ? value : undefined;
  return isChunkedSourceOriginal(value) ? readChunked(documentId, value, checksum, scope) : undefined;
}

async function saveVersion(documentId: OriginalStorageId, checksum: string, file: Blob, scope: QuestionAttachmentScope): Promise<void> {
  const prior = await withStore<unknown>("readonly", store => store.get(versionKey(documentId, checksum)), "AXOM could not read this version of the original file.", scope);
  // A checksum-addressed version is immutable. Verifying and reusing it avoids
  // duplicating a large file and leaves its chunk keys stable for readers that
  // began before this save.
  if (await readVersion(documentId, checksum, prior, scope)) return;

  if (file.size < CHUNKED_SOURCE_ORIGINAL_MIN_BYTES) {
    await withStore("readwrite", store => store.put(file, versionKey(documentId, checksum)), "The original file could not be saved. Check this device's storage and try again.", scope);
    return;
  }

  const storageId = newStorageId(checksum);
  const chunkCount = Math.ceil(file.size / SOURCE_ORIGINAL_CHUNK_BYTES);
  let written = 0;
  try {
    for (; written < chunkCount; written++) {
      const start = written * SOURCE_ORIGINAL_CHUNK_BYTES;
      const chunk = file.slice(start, Math.min(file.size, start + SOURCE_ORIGINAL_CHUNK_BYTES));
      await withStore("readwrite", store => store.put(chunk, chunkKey(documentId, storageId, written)), "The original file could not be saved. Check this device's storage and try again.", scope);
    }
    const manifest: ChunkedSourceOriginal = {
      kind: "chunked-source-original", version: 1, checksum, byteSize: file.size, mimeType: file.type,
      chunkBytes: SOURCE_ORIGINAL_CHUNK_BYTES, chunkCount, storageId,
    };
    await swapChunkedVersion(documentId, checksum, manifest, scope);
  } catch (error) {
    await deleteKeys(Array.from({ length: written }, (_, index) => chunkKey(documentId, storageId, index)), scope).catch(() => undefined);
    throw error;
  }
}

/** Publish the repaired manifest and retire the preceding chunk generation in
 * one transaction. Any earlier readonly transaction finishes materializing
 * its Blob handles before this writer can swap and reclaim the old records. */
async function swapChunkedVersion(
  documentId: OriginalStorageId,
  checksum: string,
  manifest: ChunkedSourceOriginal,
  scope: QuestionAttachmentScope,
): Promise<void> {
  assertOriginalScope(scope);
  const db = await open();
  try { assertOriginalScope(scope); } catch (error) { db.close(); throw error; }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.get(versionKey(documentId, checksum));
    request.onsuccess = () => {
      if (!isQuestionAttachmentScopeCurrent(scope)) { transaction.abort(); return; }
      const prior = isChunkedSourceOriginal(request.result) ? request.result : undefined;
      store.put(manifest, versionKey(documentId, checksum));
      if (prior && prior.storageId !== manifest.storageId) {
        for (let index = 0; index < prior.chunkCount; index += 1) {
          store.delete(chunkKey(documentId, prior.storageId, index));
        }
      }
    };
    transaction.oncomplete = () => {
      db.close();
      try { assertOriginalScope(scope); resolve(); } catch (error) { reject(error); }
    };
    const fail = () => {
      db.close();
      reject(new SourceOriginalError("storage", "The original file could not be saved. Check this device's storage and try again."));
    };
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

/** Immutable versions share one verified payload per document/hash. The
 * current id is only a pointer; legacy Blob values remain readable. */
export async function saveSourceOriginal(document: Pick<SourceDocument, "id" | "checksum">, file: Blob, options: SourceOriginalAccess = {}): Promise<void> {
  const scope = options.scope ?? getQuestionAttachmentScope();
  assertOriginalScope(scope, options.accountId);
  if (!document.checksum) {
    throw new SourceOriginalError("no-fingerprint", "This source was saved without a fingerprint, so a file cannot be matched to it. Import the file again to attach it.");
  }
  const checksum = fingerprint(document.checksum);
  const documentId = scopedDocumentId(scope.owner, document.id);
  // A slice uses the browser's canonical byte view, including host bridge Blobs.
  const canonicalFile = file.slice(0, file.size, file.type);
  if (await hashBlob(canonicalFile) !== checksum) {
    throw new SourceOriginalError("different-file", "This is a different version of the file. Choose the exact file that was imported, so page numbers still point at the right pages.");
  }
  await saveVersion(documentId, checksum, canonicalFile, scope);
  await withStore("readwrite", store => store.put({ checksum }, documentId), "The original file could not be saved. Check this device's storage and try again.", scope);
  assertOriginalScope(scope, options.accountId);
}

async function hasOriginalForId(documentId: OriginalStorageId, checksum: string | undefined, scope: QuestionAttachmentScope): Promise<boolean> {
  const found = await withStore<unknown>("readonly", store => store.get(documentId), "AXOM could not check the original file on this device.", scope);
  if (found instanceof Blob) return true;
  const expected = checksum ? fingerprint(checksum) : undefined;
  const hash = expected ?? (found && typeof found === "object" && "checksum" in found ? found.checksum : undefined);
  if (typeof hash !== "string") return false;
  const version = await withStore<unknown>("readonly", store => store.get(versionKey(documentId, hash)), "AXOM could not check this version of the original file.", scope);
  if (version instanceof Blob) return true;
  if (!isChunkedSourceOriginal(version) || version.checksum !== hash || version.byteSize < 0
      || version.chunkCount !== Math.ceil(version.byteSize / version.chunkBytes)) return false;
  return Boolean(await readChunkHandles(documentId, version, "AXOM could not check this version of the original file.", scope));
}

/** Presence never grants read authority; exports and previews verify the bytes. */
export async function hasStoredSourceOriginal(documentId: string, checksum?: string, options: SourceOriginalAccess = {}): Promise<boolean> {
  const scope = options.scope ?? getQuestionAttachmentScope();
  assertOriginalScope(scope, options.accountId);
  let found = await hasOriginalForId(scopedDocumentId(scope.owner, documentId), checksum, scope);
  if (!found && await readLegacyLocalBinaryOwner() === scope.owner) {
    assertOriginalScope(scope, options.accountId);
    found = await hasOriginalForId(documentId, checksum, scope);
  }
  assertOriginalScope(scope, options.accountId);
  return found;
}

async function readOriginalForId(documentId: OriginalStorageId, checksum: string | undefined, scope: QuestionAttachmentScope): Promise<Blob | undefined> {
  const found = await withStore<unknown>("readonly", store => store.get(documentId), "AXOM could not read the original file.", scope);
  const expected = checksum ? fingerprint(checksum) : undefined;
  if (found instanceof Blob && (!expected || await hashBlob(found) === expected)) return found;
  const hash = expected ?? (found && typeof found === "object" && "checksum" in found ? found.checksum : undefined);
  if (typeof hash !== "string") return undefined;
  const version = await withStore<unknown>("readonly", store => store.get(versionKey(documentId, hash)), "AXOM could not read this version of the original file.", scope);
  return readVersion(documentId, hash, version, scope);
}

export async function readSourceOriginal(documentId: string, checksum?: string, options: SourceOriginalAccess = {}): Promise<Blob | undefined> {
  const scope = options.scope ?? getQuestionAttachmentScope();
  assertOriginalScope(scope, options.accountId);
  let original = await readOriginalForId(scopedDocumentId(scope.owner, documentId), checksum, scope);
  if (!original && await readLegacyLocalBinaryOwner() === scope.owner) {
    assertOriginalScope(scope, options.accountId);
    original = await readOriginalForId(documentId, checksum, scope);
  }
  assertOriginalScope(scope, options.accountId);
  return original;
}

/** Only explicit device adoption can copy known guest originals into an account.
 * Ambiguous legacy rows are never claimed; all device originals remain intact. */
export async function adoptDeviceSourceOriginals(accountId: string, documents: readonly Pick<SourceDocument, "id" | "checksum">[]): Promise<void> {
  const scope = getQuestionAttachmentScope();
  assertOriginalScope(scope, accountId);
  for (const document of documents) {
    if (!document.checksum) continue;
    const original = await readOriginalForId(scopedDocumentId("device", document.id), document.checksum, scope);
    assertOriginalScope(scope, accountId);
    if (original) await saveSourceOriginal(document, original, { scope, accountId });
  }
}

/** Explicit removal is limited to this account's copies; legacy bytes stay intact. */
export async function deleteSourceOriginal(documentId: string): Promise<void> {
  const scope = getQuestionAttachmentScope();
  const id = scopedDocumentId(scope.owner, documentId);
  const versionKeys = await withStore<IDBValidKey[]>("readonly", store => store.getAllKeys(IDBKeyRange.bound(["version", id], ["version", id, []])), "The original file could not be removed.", scope);
  const chunkKeys = await withStore<IDBValidKey[]>("readonly", store => store.getAllKeys(IDBKeyRange.bound(["chunk", id], ["chunk", id, []])), "The original file could not be removed.", scope);
  await deleteKeys(versionKeys, scope);
  await deleteKeys(chunkKeys, scope);
  await withStore("readwrite", store => store.delete(id), "The original file could not be removed.", scope);
}

/** Fewer characters than this on a page usually means a figure or a scan. It is not a verdict that the page is unreadable. */
export const SPARSE_PAGE_CHARACTERS = 100;

export interface SourceCoverage {
  pages: number;
  /** Pages with enough text to read a question or an explanation from. */
  readable: number;
  /** 1-based pages with little or no text. */
  sparsePages: number[];
}

/** How much of a document's pages gave text, read from the document itself. Undefined when it has no pages. */
export function sourceCoverage(document: Pick<SourceDocument, "pageTexts">): SourceCoverage | undefined {
  const pages = document.pageTexts;
  if (!pages?.length) return undefined;
  const sparsePages = pages.flatMap((text, index) => (text.trim().length < SPARSE_PAGE_CHARACTERS ? [index + 1] : []));
  return { pages: pages.length, readable: pages.length - sparsePages.length, sparsePages };
}
