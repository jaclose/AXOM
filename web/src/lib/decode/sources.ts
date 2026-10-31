// ===========================================================================
// Verified original files cached on this device.
//
// In the workspace a source document is its text and its identity (a
// checksum of the file's bytes). Showing a page as it was drawn needs the
// file itself, which is far too large for a workspace snapshot or for sync.
// Copies live in this IndexedDB database, keyed by the document's id.
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

export const SOURCE_ORIGINALS_DB = "axom-decode-originals-v1";
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
    const request = indexedDB.open(SOURCE_ORIGINALS_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new SourceOriginalError("storage", "The original file could not be opened on this device."));
    request.onblocked = () => reject(new SourceOriginalError("storage", "Close other AXOM tabs and try again."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>, failure: string): Promise<T> {
  const db = await open();
  try {
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
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = fail;
      transaction.onabort = fail;
    });
  } finally {
    db.close();
  }
}

const versionKey = (id: string, checksum: string) => ["version", id, checksum];
const chunkKey = (id: string, storageId: string, index: number) => ["chunk", id, storageId, index];
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

async function deleteKeys(keys: IDBValidKey[]): Promise<void> {
  for (const key of keys) {
    await withStore("readwrite", store => store.delete(key), "The original file could not be removed.");
  }
}

/** Materialize every Blob handle in one readonly transaction. IndexedDB keeps
 * a repairing writer behind this transaction; once it completes, these Blob
 * handles remain readable even if the retired chunk records are reclaimed. */
async function readChunkHandles(
  documentId: string,
  manifest: ChunkedSourceOriginal,
  failure: string,
): Promise<Blob[] | undefined> {
  const db = await open();
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

async function readChunked(documentId: string, manifest: ChunkedSourceOriginal, checksum: string): Promise<Blob | undefined> {
  if (manifest.checksum !== checksum || manifest.byteSize < 0
      || manifest.chunkCount !== Math.ceil(manifest.byteSize / manifest.chunkBytes)) return undefined;
  const digest = sha256.create();
  const chunks = await readChunkHandles(documentId, manifest, "AXOM could not read this version of the original file.");
  if (!chunks) return undefined;
  for (const chunk of chunks) {
    digest.update(new Uint8Array(await chunk.arrayBuffer()));
  }
  return hex(digest.digest()) === checksum ? new Blob(chunks, { type: manifest.mimeType }) : undefined;
}

async function readVersion(documentId: string, checksum: string, value: unknown): Promise<Blob | undefined> {
  if (value instanceof Blob) return await hashBlob(value) === checksum ? value : undefined;
  return isChunkedSourceOriginal(value) ? readChunked(documentId, value, checksum) : undefined;
}

async function saveVersion(documentId: string, checksum: string, file: Blob): Promise<void> {
  const prior = await withStore<unknown>("readonly", store => store.get(versionKey(documentId, checksum)), "AXOM could not read this version of the original file.");
  // A checksum-addressed version is immutable. Verifying and reusing it avoids
  // duplicating a large file and leaves its chunk keys stable for readers that
  // began before this save.
  if (await readVersion(documentId, checksum, prior)) return;

  if (file.size < CHUNKED_SOURCE_ORIGINAL_MIN_BYTES) {
    await withStore("readwrite", store => store.put(file, versionKey(documentId, checksum)), "The original file could not be saved. Check this device's storage and try again.");
    return;
  }

  const storageId = newStorageId(checksum);
  const chunkCount = Math.ceil(file.size / SOURCE_ORIGINAL_CHUNK_BYTES);
  let written = 0;
  try {
    for (; written < chunkCount; written++) {
      const start = written * SOURCE_ORIGINAL_CHUNK_BYTES;
      const chunk = file.slice(start, Math.min(file.size, start + SOURCE_ORIGINAL_CHUNK_BYTES));
      await withStore("readwrite", store => store.put(chunk, chunkKey(documentId, storageId, written)), "The original file could not be saved. Check this device's storage and try again.");
    }
    const manifest: ChunkedSourceOriginal = {
      kind: "chunked-source-original", version: 1, checksum, byteSize: file.size, mimeType: file.type,
      chunkBytes: SOURCE_ORIGINAL_CHUNK_BYTES, chunkCount, storageId,
    };
    await swapChunkedVersion(documentId, checksum, manifest);
  } catch (error) {
    await deleteKeys(Array.from({ length: written }, (_, index) => chunkKey(documentId, storageId, index))).catch(() => undefined);
    throw error;
  }
}

/** Publish the repaired manifest and retire the preceding chunk generation in
 * one transaction. Any earlier readonly transaction finishes materializing
 * its Blob handles before this writer can swap and reclaim the old records. */
async function swapChunkedVersion(
  documentId: string,
  checksum: string,
  manifest: ChunkedSourceOriginal,
): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.get(versionKey(documentId, checksum));
    request.onsuccess = () => {
      const prior = isChunkedSourceOriginal(request.result) ? request.result : undefined;
      store.put(manifest, versionKey(documentId, checksum));
      if (prior && prior.storageId !== manifest.storageId) {
        for (let index = 0; index < prior.chunkCount; index += 1) {
          store.delete(chunkKey(documentId, prior.storageId, index));
        }
      }
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
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
export async function saveSourceOriginal(document: Pick<SourceDocument, "id" | "checksum">, file: Blob): Promise<void> {
  if (!document.checksum) {
    throw new SourceOriginalError("no-fingerprint", "This source was saved without a fingerprint, so a file cannot be matched to it. Import the file again to attach it.");
  }
  const checksum = fingerprint(document.checksum);
  // Blob.size is normally immutable, but tests and some host bridges can expose
  // a decorated Blob. A slice gives storage the browser's canonical byte view.
  const canonicalFile = file.slice(0, file.size, file.type);
  if (await hashBlob(canonicalFile) !== checksum) {
    throw new SourceOriginalError("different-file", "This is a different version of the file. Choose the exact file that was imported, so page numbers still point at the right pages.");
  }
  const current = await withStore<unknown>("readonly", store => store.get(document.id), "AXOM could not read the original file.");
  if (current instanceof Blob) {
    const previousHash = await hashBlob(current);
    if (previousHash !== checksum) await saveVersion(document.id, previousHash, current);
  }
  await saveVersion(document.id, checksum, canonicalFile);
  await withStore("readwrite", store => store.put({ checksum }, document.id), "The original file could not be saved. Check this device's storage and try again.");
}

/** Lightweight UI presence probe. This reads only the current pointer and the
 * version value or chunk manifest; it never reconstructs or hashes file bytes.
 * Call `readSourceOriginal` before displaying or exporting the file. */
export async function hasStoredSourceOriginal(documentId: string, checksum?: string): Promise<boolean> {
  const found = await withStore<unknown>("readonly", store => store.get(documentId), "AXOM could not check the original file on this device.");
  if (found instanceof Blob) return true;
  const expected = checksum ? fingerprint(checksum) : undefined;
  const hash = expected ?? (found && typeof found === "object" && "checksum" in found ? found.checksum : undefined);
  if (typeof hash !== "string") return false;
  const version = await withStore<unknown>("readonly", store => store.get(versionKey(documentId, hash)), "AXOM could not check this version of the original file.");
  if (version instanceof Blob) return true;
  if (!isChunkedSourceOriginal(version)
      || version.checksum !== hash
      || version.byteSize < 0
      || version.chunkCount !== Math.ceil(version.byteSize / version.chunkBytes)) return false;
  return Boolean(await readChunkHandles(documentId, version, "AXOM could not check this version of the original file."));
}

export async function readSourceOriginal(documentId: string, checksum?: string): Promise<Blob | undefined> {
  const found = await withStore<unknown>("readonly", store => store.get(documentId), "AXOM could not read the original file.");
  const expected = checksum ? fingerprint(checksum) : undefined;
  if (found instanceof Blob && (!expected || await hashBlob(found) === expected)) return found;
  const hash = expected ?? (found && typeof found === "object" && "checksum" in found ? found.checksum : undefined);
  if (typeof hash !== "string") return undefined;
  const version = await withStore<unknown>("readonly", store => store.get(versionKey(documentId, hash)), "AXOM could not read this version of the original file.");
  return readVersion(documentId, hash, version);
}

/** Explicit removal deletes this document's copies, never another source's. */
export async function deleteSourceOriginal(documentId: string): Promise<void> {
  const versionKeys = await withStore<IDBValidKey[]>("readonly", store => store.getAllKeys(IDBKeyRange.bound(["version", documentId], ["version", documentId, []])), "The original file could not be removed.");
  const chunkKeys = await withStore<IDBValidKey[]>("readonly", store => store.getAllKeys(IDBKeyRange.bound(["chunk", documentId], ["chunk", documentId, []])), "The original file could not be removed.");
  await deleteKeys(versionKeys);
  await deleteKeys(chunkKeys);
  await withStore("readwrite", store => store.delete(documentId), "The original file could not be removed.");
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
