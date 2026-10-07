// ===========================================================================
// The original file of a source document, kept on this device only.
//
// In the workspace a source document is its text and its identity (a
// checksum of the file's bytes). Showing a page as it was drawn needs the
// file itself, which is far too large for a workspace snapshot or for sync.
// So it lives here, in its own IndexedDB database, keyed by the document's
// id. It is never exported, never uploaded, and is not on another device
// until the learner attaches the same file there.
//
// A file is only accepted when its bytes match the document's checksum: a
// different version of the file would put other pages behind the page
// numbers that analyses cite.
// ===========================================================================
import { sha256Hex } from "../checksum";
import type { SourceDocument } from "../library";

export const SOURCE_ORIGINALS_DB = "axom-decode-originals-v1";
const STORE = "originals";

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
      const request = run(transaction.objectStore(STORE));
      const fail = () => reject(new SourceOriginalError("storage", failure));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = fail;
      transaction.onabort = fail;
    });
  } finally {
    db.close();
  }
}

/** Keep the original of a source on this device, once its bytes are shown to be that source's. */
export async function saveSourceOriginal(document: Pick<SourceDocument, "id" | "checksum">, file: Blob): Promise<void> {
  if (!document.checksum) {
    throw new SourceOriginalError("no-fingerprint", "This source was saved without a fingerprint, so a file cannot be matched to it. Import the file again to attach it.");
  }
  if (await sha256Hex(await file.arrayBuffer()) !== document.checksum) {
    throw new SourceOriginalError("different-file", "This is a different version of the file. Choose the exact file that was imported, so page numbers still point at the right pages.");
  }
  await withStore("readwrite", (store) => store.put(file, document.id), "The original file could not be saved. Check this device's storage and try again.");
}

export async function readSourceOriginal(documentId: string): Promise<Blob | undefined> {
  const found = await withStore<unknown>("readonly", (store) => store.get(documentId), "AXOM could not read the original file.");
  return found instanceof Blob ? found : undefined;
}

/** A source that leaves the workspace takes its original with it. */
export async function deleteSourceOriginal(documentId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(documentId), "The original file could not be removed.");
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
