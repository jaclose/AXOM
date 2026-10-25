// @vitest-environment node
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../checksum";
import {
  SOURCE_ORIGINAL_CHUNK_BYTES, SOURCE_ORIGINALS_DB, SourceOriginalError, deleteSourceOriginal, hasStoredSourceOriginal,
  readSourceOriginal, saveSourceOriginal, sourceCoverage,
} from "./sources";

beforeEach(() => {
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
});
afterEach(async () => {
  await new Promise<void>((resolve) => {
    const request = fakeIndexedDb.deleteDatabase(SOURCE_ORIGINALS_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  vi.unstubAllGlobals();
});

const bytes = (text: string) => new Blob([text], { type: "application/pdf" });
const problemOf = async (run: Promise<unknown>) => run.then(() => "saved", (error: unknown) => (error instanceof SourceOriginalError ? error.problem : "other"));

async function originalEntries(): Promise<Array<{ key: IDBValidKey; value: unknown }>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SOURCE_ORIGINALS_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("originals");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("originals", "readonly");
      const store = transaction.objectStore("originals");
      const keys = store.getAllKeys(), values = store.getAll();
      transaction.oncomplete = () => {
        db.close();
        resolve(keys.result.map((key, index) => ({ key, value: values.result[index] })));
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

async function changeOriginal(key: IDBValidKey, value?: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SOURCE_ORIGINALS_DB, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction("originals", "readwrite");
      if (value === undefined) transaction.objectStore("originals").delete(key);
      else transaction.objectStore("originals").put(value, key);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

const versionManifest = (entries: Awaited<ReturnType<typeof originalEntries>>) => entries
  .find(({ key }) => Array.isArray(key) && key[0] === "version")?.value as { storageId: string; chunkCount: number };

describe("the original file of a source, on this device", () => {
  it("keeps a file whose bytes are the source's, and gives it back", async () => {
    const file = bytes("%PDF the imported file");
    const document = { id: "doc-1", checksum: await sha256Hex(await file.arrayBuffer()) };
    await saveSourceOriginal(document, file);
    const kept = await readSourceOriginal("doc-1");
    expect(await kept?.text()).toBe("%PDF the imported file");
    expect(await hasStoredSourceOriginal("doc-1", document.checksum)).toBe(true);
    expect(await hasStoredSourceOriginal("doc-2", document.checksum)).toBe(false);
    expect(await readSourceOriginal("doc-2")).toBeUndefined();
  });

  it("keeps the legacy Blob copy when upgrading to versioned storage", async () => {
    const legacy = bytes("legacy original");
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(SOURCE_ORIGINALS_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("originals");
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction("originals", "readwrite");
        transaction.objectStore("originals").put(legacy, "doc-1");
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    const oldHash = await sha256Hex(await legacy.arrayBuffer());
    expect(await (await readSourceOriginal("doc-1", oldHash))?.text()).toBe("legacy original");
    await saveSourceOriginal({ id: "doc-1", checksum: await sha256Hex("new edition") }, bytes("new edition"));
    expect(await (await readSourceOriginal("doc-1", oldHash))?.text()).toBe("legacy original");
  });

  it("stores a large original in independently verified chunks and retains its immutable edition", async () => {
    const content = new Uint8Array(SOURCE_ORIGINAL_CHUNK_BYTES + 257);
    for (let index = 0; index < content.length; index += 4093) content[index] = index % 251;
    const file = new Blob([content], { type: "application/pdf" });
    const checksum = await sha256Hex(await file.arrayBuffer());
    expect(checksum).toBeTruthy();

    await saveSourceOriginal({ id: "large-doc", checksum }, file);
    const entries = await originalEntries();
    const chunks = entries.filter(({ key }) => Array.isArray(key) && key[0] === "chunk");
    expect(chunks).toHaveLength(2);
    expect(chunks.every(({ value }) => value instanceof Blob && value.size <= SOURCE_ORIGINAL_CHUNK_BYTES)).toBe(true);
    expect(entries.some(({ value }) => value instanceof Blob && value.size === file.size)).toBe(false);
    expect(entries.find(({ key }) => Array.isArray(key) && key[0] === "version")?.value).toMatchObject({
      kind: "chunked-source-original", checksum, byteSize: file.size, chunkCount: 2,
    });

    const firstStorageId = versionManifest(entries).storageId;
    const firstChunkKeys = chunks.map(({ key }) => key);
    await saveSourceOriginal({ id: "large-doc", checksum }, file);
    const reusedEntries = await originalEntries();
    expect(versionManifest(reusedEntries).storageId).toBe(firstStorageId);
    expect(reusedEntries.filter(({ key }) => Array.isArray(key) && key[0] === "chunk").map(({ key }) => key)).toEqual(firstChunkKeys);

    const restored = await readSourceOriginal("large-doc", checksum);
    expect(restored?.size).toBe(file.size);
    expect(restored?.type).toBe("application/pdf");
    expect(await sha256Hex(await restored?.arrayBuffer() as ArrayBuffer)).toBe(checksum);

    const newer = bytes("corrected edition");
    const newerChecksum = await sha256Hex(await newer.arrayBuffer());
    await saveSourceOriginal({ id: "large-doc", checksum: newerChecksum }, newer);
    expect(await (await readSourceOriginal("large-doc"))?.text()).toBe("corrected edition");
    expect((await readSourceOriginal("large-doc", checksum))?.size).toBe(file.size);

    await deleteSourceOriginal("large-doc");
    expect(await originalEntries()).toEqual([]);
  });

  it("atomically repairs chunks, keeps an in-flight Blob snapshot readable, and reclaims retired generations", async () => {
    const file = new Blob([new Uint8Array(SOURCE_ORIGINAL_CHUNK_BYTES + 1)], { type: "application/pdf" });
    const checksum = await sha256Hex(await file.arrayBuffer());
    await saveSourceOriginal({ id: "large-doc", checksum }, file);
    const firstEntries = await originalEntries();
    const firstManifest = versionManifest(firstEntries);
    const firstChunkKeys = firstEntries.filter(({ key }) => Array.isArray(key) && key[0] === "chunk").map(({ key }) => key);

    // The reader's single readonly transaction has already materialized every
    // Blob handle when hashing begins. Pause there, then corrupt and repair the
    // stored generation underneath it.
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    let releaseReader!: () => void;
    let readerStarted!: () => void;
    const started = new Promise<void>(resolve => { readerStarted = resolve; });
    const arrayBuffer = vi.spyOn(Blob.prototype, "arrayBuffer").mockImplementation(function (this: Blob) {
      arrayBuffer.mockRestore();
      readerStarted();
      return new Promise<ArrayBuffer>(resolve => {
        releaseReader = () => { void originalArrayBuffer.call(this).then(resolve); };
      });
    });
    const inFlight = readSourceOriginal("large-doc", checksum);
    await started;
    await changeOriginal(firstChunkKeys[0], new Blob([new Uint8Array(SOURCE_ORIGINAL_CHUNK_BYTES).fill(1)]));
    // Presence is deliberately metadata-only. Explicit opening below performs
    // the checksum verification and rejects the corrupt bytes.
    const presenceBytes = vi.spyOn(Blob.prototype, "arrayBuffer");
    expect(await hasStoredSourceOriginal("large-doc", checksum)).toBe(true);
    expect(presenceBytes).not.toHaveBeenCalled();
    presenceBytes.mockRestore();
    expect(await readSourceOriginal("large-doc", checksum)).toBeUndefined();

    await saveSourceOriginal({ id: "large-doc", checksum }, file);
    const repairedEntries = await originalEntries();
    const repairedManifest = versionManifest(repairedEntries);
    expect(repairedManifest.storageId).not.toBe(firstManifest.storageId);
    expect(firstChunkKeys.every(key => repairedEntries.some(entry => JSON.stringify(entry.key) === JSON.stringify(key)))).toBe(false);
    expect(repairedEntries.filter(({ key }) => Array.isArray(key) && key[0] === "chunk")).toHaveLength(2);
    expect((await readSourceOriginal("large-doc", checksum))?.size).toBe(file.size);
    releaseReader();
    expect(await inFlight).toEqual(expect.objectContaining({ size: file.size, type: "application/pdf" }));

    const repairedChunkKeys = repairedEntries
      .filter(({ key }) => Array.isArray(key) && key[0] === "chunk" && key[2] === repairedManifest.storageId)
      .map(({ key }) => key);
    await changeOriginal(repairedChunkKeys[1]);
    const missingPresenceBytes = vi.spyOn(Blob.prototype, "arrayBuffer");
    expect(await hasStoredSourceOriginal("large-doc", checksum)).toBe(false);
    expect(missingPresenceBytes).not.toHaveBeenCalled();
    missingPresenceBytes.mockRestore();
    expect(await readSourceOriginal("large-doc", checksum)).toBeUndefined();
    await saveSourceOriginal({ id: "large-doc", checksum }, file);
    const replacedMissingEntries = await originalEntries();
    expect(versionManifest(replacedMissingEntries).storageId).not.toBe(repairedManifest.storageId);
    expect(replacedMissingEntries.some(entry => JSON.stringify(entry.key) === JSON.stringify(repairedChunkKeys[0]))).toBe(false);
    expect(replacedMissingEntries.filter(({ key }) => Array.isArray(key) && key[0] === "chunk")).toHaveLength(2);
    expect((await readSourceOriginal("large-doc", checksum))?.size).toBe(file.size);
  });

  it("preserves revisions across replacement, concurrent saves and retry", async () => {
    const first = bytes("original edition"), second = bytes("corrected edition");
    const one = await sha256Hex(await first.arrayBuffer()), two = await sha256Hex(await second.arrayBuffer());
    await Promise.all([
      saveSourceOriginal({ id: "doc-1", checksum: one }, first),
      saveSourceOriginal({ id: "doc-1", checksum: two }, second),
    ]);
    await saveSourceOriginal({ id: "doc-1", checksum: two }, second);
    expect(await (await readSourceOriginal("doc-1", one))?.text()).toBe("original edition");
    expect(await (await readSourceOriginal("doc-1", `sha256:${two}`))?.text()).toBe("corrected edition");
    expect(await (await readSourceOriginal("doc-1"))?.text()).toBe("corrected edition");
    expect(await readSourceOriginal("doc-1", "0".repeat(64))).toBeUndefined();
    await deleteSourceOriginal("doc-1");
    expect(await readSourceOriginal("doc-1", one)).toBeUndefined();
  });

  it("refuses another version of the file, so page numbers cannot point at other pages", async () => {
    const document = { id: "doc-1", checksum: await sha256Hex("%PDF the imported file") };
    expect(await problemOf(saveSourceOriginal(document, bytes("%PDF a later edition")))).toBe("different-file");
    expect(await readSourceOriginal("doc-1")).toBeUndefined();
  });

  it("refuses a file for a source that has no fingerprint to match it against", async () => {
    expect(await problemOf(saveSourceOriginal({ id: "doc-1" }, bytes("%PDF anything")))).toBe("no-fingerprint");
  });

  it("removes the original when its source leaves, and removing nothing is not an error", async () => {
    const file = bytes("%PDF the imported file");
    await saveSourceOriginal({ id: "doc-1", checksum: await sha256Hex(await file.arrayBuffer()) }, file);
    await deleteSourceOriginal("doc-1");
    expect(await readSourceOriginal("doc-1")).toBeUndefined();
    await expect(deleteSourceOriginal("never-there")).resolves.toBeUndefined();
  });
});

describe("how much of a source gave text", () => {
  it("counts readable pages and names the sparse ones", () => {
    const readable = "A full page of extracted text. ".repeat(6);
    expect(sourceCoverage({ pageTexts: [readable, "  ", "Figure 3", readable] })).toEqual({ pages: 4, readable: 2, sparsePages: [2, 3] });
  });

  it("has nothing to say about a source without pages", () => {
    expect(sourceCoverage({})).toBeUndefined();
    expect(sourceCoverage({ pageTexts: [] })).toBeUndefined();
  });
});
