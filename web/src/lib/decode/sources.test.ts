// @vitest-environment node
import { indexedDB as fakeIndexedDb } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../checksum";
import {
  SOURCE_ORIGINALS_DB, SourceOriginalError, deleteSourceOriginal, readSourceOriginal, saveSourceOriginal, sourceCoverage,
} from "./sources";

beforeEach(() => {
  vi.stubGlobal("indexedDB", fakeIndexedDb);
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
