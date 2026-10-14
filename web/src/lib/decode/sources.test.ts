// @vitest-environment node
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../checksum";
import {
  SOURCE_ORIGINALS_DB, SourceOriginalError, deleteSourceOriginal, readSourceOriginal, saveSourceOriginal, sourceCoverage,
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

describe("the original file of a source, on this device", () => {
  it("keeps a file whose bytes are the source's, and gives it back", async () => {
    const file = bytes("%PDF the imported file");
    const document = { id: "doc-1", checksum: await sha256Hex(await file.arrayBuffer()) };
    await saveSourceOriginal(document, file);
    const kept = await readSourceOriginal("doc-1");
    expect(await kept?.text()).toBe("%PDF the imported file");
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
