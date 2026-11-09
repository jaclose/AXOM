// @vitest-environment node
import { indexedDB, IDBKeyRange, IDBObjectStore as FakeObjectStore } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../checksum";
import { createMediaBackupArchive, readPortableBackup } from "../backupArchive";
import { DB_NAME } from "../localVault";
import { makeSeed } from "../seed";
import { clearCloudOriginalUploadCache, uploadCloudOriginals } from "../sync/cloudOriginals";
import type { SourceDocument } from "../library";
import { initializeQuestionAttachmentScope, resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "../questionAttachmentScope";
import { SOURCE_ORIGINALS_DB, adoptDeviceSourceOriginals, deleteSourceOriginal, hasStoredSourceOriginal, readSourceOriginal, saveSourceOriginal } from "./sources";
import * as sourceOriginals from "./sources";

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  resetQuestionAttachmentScopeForTests();
  clearCloudOriginalUploadCache();
});
afterEach(async () => {
  for (const name of [SOURCE_ORIGINALS_DB, DB_NAME]) await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function ownerOriginal() {
  const original = new Blob(["%PDF synthetic private original owned by A"], { type: "application/pdf" });
  const checksum = await sha256Hex(await original.arrayBuffer());
  if (!checksum) throw new Error("Synthetic original checksum unavailable");
  const document: SourceDocument = { id: "shared-source-id", title: "Synthetic source", fileName: "source.pdf", fileType: "pdf", checksum,
    uploadedAt: "2026-11-09", rawText: "Synthetic source", tags: [], linkedQuestionSetIds: [], libraryOnly: true, sizeBytes: original.size,
    originalFile: { version: 1, sha256: checksum, byteSize: original.size, mimeType: "application/pdf" } };
  setQuestionAttachmentAccount("A");
  await saveSourceOriginal(document, original);
  return { original, document };
}

describe("original source account isolation", () => {
  it("does not reveal A's cached original to B when only source metadata is reused", async () => {
    const { document } = await ownerOriginal();
    setQuestionAttachmentAccount("B");
    expect(await hasStoredSourceOriginal(document.id, document.checksum)).toBe(false);
    expect(await readSourceOriginal(document.id, document.checksum)).toBeUndefined();
    setQuestionAttachmentAccount("A");
    expect(await (await readSourceOriginal(document.id, document.checksum))?.text()).toContain("owned by A");
  });

  it("does not put A's cached original into B's portable backup without adoption", async () => {
    const { document } = await ownerOriginal();
    setQuestionAttachmentAccount("B");
    const exported = await createMediaBackupArchive({ documents: [document] }, [], [document]);
    expect(exported.originalCount).toBe(0);
    expect(exported.missingOriginalIds).toEqual([document.id]);
  });

  it("does not upload A's cached original into B's cloud account", async () => {
    const { document, original } = await ownerOriginal();
    const upload = vi.fn(async () => ({ error: null }));
    const client = { storage: { from: () => ({ upload, download: async () => ({ data: original, error: null }) }) } } as unknown as SupabaseClient;
    setQuestionAttachmentAccount("B");
    await expect(uploadCloudOriginals(client, "B", { ...makeSeed(), documents: [document] }, undefined, async () => {})).rejects.toThrow(/missing on this device/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects an A→B→A transition during the original read", async () => {
    const { document } = await ownerOriginal();
    const get = FakeObjectStore.prototype.get;
    vi.spyOn(FakeObjectStore.prototype, "get").mockImplementationOnce(function (this: IDBObjectStore, key) {
      const request = get.call(this, key);
      setQuestionAttachmentAccount("B"); setQuestionAttachmentAccount("A");
      return request;
    });
    await expect(readSourceOriginal(document.id, document.checksum)).rejects.toThrow(/account changed/);
  });

  it("keeps a valid offline archive usable when explicitly restored in B", async () => {
    const { document } = await ownerOriginal();
    const archive = await createMediaBackupArchive({ documents: [document] }, [], [document]);
    setQuestionAttachmentAccount("B");
    const backup = await readPortableBackup(new File([archive.blob], "offline.zip"));
    expect(await backup.restoreOriginals([document])).toEqual({ restored: 1, skipped: 0 });
    expect(await (await readSourceOriginal(document.id, document.checksum))?.text()).toContain("owned by A");
    await deleteSourceOriginal(document.id);
    setQuestionAttachmentAccount("A");
    expect(await readSourceOriginal(document.id, document.checksum)).toBeInstanceOf(Blob);
  });

  it("copies only known device originals during explicit adoption and keeps the device copy", async () => {
    const original = new Blob(["guest source"]);
    const document = { id: "guest", checksum: await sha256Hex(await original.arrayBuffer()) };
    await saveSourceOriginal(document, original);
    setQuestionAttachmentAccount("A");
    expect(await readSourceOriginal(document.id, document.checksum)).toBeUndefined();
    await adoptDeviceSourceOriginals("A", [document]);
    expect(await readSourceOriginal(document.id, document.checksum)).toBeInstanceOf(Blob);
    setQuestionAttachmentAccount("B");
    expect(await readSourceOriginal(document.id, document.checksum)).toBeUndefined();
    setQuestionAttachmentAccount();
    expect(await readSourceOriginal(document.id, document.checksum)).toBeInstanceOf(Blob);
  });

  it("does not stage backup originals into B after the account changes between reading and writing", async () => {
    const { document } = await ownerOriginal();
    const archive = await createMediaBackupArchive({ documents: [document] }, [], [document]);
    const backup = await readPortableBackup(new File([archive.blob], "offline.zip"));
    await deleteSourceOriginal(document.id);
    const read = sourceOriginals.readSourceOriginal;
    vi.spyOn(sourceOriginals, "readSourceOriginal").mockImplementationOnce(async (...args) => {
      const value = await read(...args);
      setQuestionAttachmentAccount("B");
      return value;
    });
    await expect(backup.restoreOriginals([document])).rejects.toThrow(/account changed/);
    expect(await read(document.id, document.checksum)).toBeUndefined();
  });

  it("retries a blocked old-client upgrade and preserves legacy bytes under their original owner", async () => {
    const original = new Blob(["legacy source"]);
    const hash = await sha256Hex(await original.arrayBuffer());
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(SOURCE_ORIGINALS_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("originals");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = old.transaction("originals", "readwrite");
      tx.objectStore("originals").put(original, "legacy");
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    initializeQuestionAttachmentScope("A", "A");
    try {
      await expect(readSourceOriginal("legacy", hash)).rejects.toThrow(/Close other AXOM tabs/);
    } finally { old.close(); }
    expect(await readSourceOriginal("legacy", hash)).toBeInstanceOf(Blob);
    setQuestionAttachmentAccount("B");
    expect(await readSourceOriginal("legacy", hash)).toBeUndefined();
    await deleteSourceOriginal("legacy");
    setQuestionAttachmentAccount("A");
    expect(await readSourceOriginal("legacy", hash)).toBeInstanceOf(Blob);
  });

  it("does not claim ambiguous legacy originals when a new account links", async () => {
    const original = new Blob(["ambiguous original"]);
    const hash = await sha256Hex(await original.arrayBuffer());
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(SOURCE_ORIGINALS_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("originals");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("originals", "readwrite"); tx.objectStore("originals").put(original, "legacy");
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    });
    initializeQuestionAttachmentScope();
    expect(await readSourceOriginal("legacy", hash)).toBeUndefined();
    setQuestionAttachmentAccount("B");
    await adoptDeviceSourceOriginals("B", [{ id: "legacy", checksum: hash }]);
    expect(await readSourceOriginal("legacy", hash)).toBeUndefined();
    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = indexedDB.open(SOURCE_ORIGINALS_DB);
      request.onsuccess = () => {
        const current = request.result, tx = current.transaction("originals", "readonly"), read = tx.objectStore("originals").get("legacy");
        tx.oncomplete = () => { current.close(); resolve(read.result); }; tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    expect(stored).toBeInstanceOf(Blob);
  });
});
