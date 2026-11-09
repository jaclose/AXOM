import { indexedDB as fakeIndexedDb, IDBKeyRange, IDBObjectStore as FakeObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTACHMENT_STORE_NAME, DB_NAME, DB_VERSION, ensureVaultStores } from "./localVault";
import { initializeQuestionAttachmentScope, resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "./questionAttachmentScope";
import { adoptDeviceQuestionAttachments, collectQuestionAttachmentPayloads, deleteQuestionAttachmentBlobs,
  getQuestionAttachmentBlob, listQuestionAttachmentBlobKeys, putQuestionAttachmentBlob,
  restoreQuestionAttachmentPayloads, runQuestionAttachmentMaintenance, type QuestionImageAttachment } from "./questionAttachments";

const key = "identical-key";
const meta: QuestionImageAttachment = { id: key, blobKey: key, fileName: "figure.png", mimeType: "image/png",
  byteSize: 1, createdAt: "2026-11-09", updatedAt: "2026-11-09", altText: "Synthetic figure" };
const questions = [{ id: "same-question", attachments: [meta] }];
const record = (text: string) => ({ blob: new Blob([text], { type: "image/png" }), mimeType: "image/png" as const,
  byteSize: text.length, questionId: "same-question", updatedAt: meta.updatedAt });

async function raw<T>(run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => ensureVaultStores(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACHMENT_STORE_NAME, "readwrite");
    const req = run(tx.objectStore(ATTACHMENT_STORE_NAME));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
beforeEach(async () => {
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  resetQuestionAttachmentScopeForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("account-owned attachment bytes", () => {
  it("recovers a blocked v4 upgrade without losing legacy bytes or leaving the late connection open", async () => {
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 4);
      req.onupgradeneeded = () => ensureVaultStores(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = old.transaction(ATTACHMENT_STORE_NAME, "readwrite");
      tx.objectStore(ATTACHMENT_STORE_NAME).put(record("A"), key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    initializeQuestionAttachmentScope("A", "A");
    const versionChange = vi.fn();
    old.onversionchange = versionChange;
    await expect(getQuestionAttachmentBlob(key)).rejects.toThrow(/blocked by another tab/i);
    expect(versionChange).toHaveBeenCalledOnce();
    old.close();
    expect(await (await getQuestionAttachmentBlob(key))!.blob.text()).toBe("A");
    await expect(new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 4);
      req.onsuccess = () => { req.result.close(); resolve(undefined); };
      req.onerror = () => reject(req.error);
    })).rejects.toMatchObject({ name: "VersionError" });
  });

  it("isolates same-key reads, exports, lists and targeted deletes while preserving both accounts", async () => {
    setQuestionAttachmentAccount("A");
    await putQuestionAttachmentBlob(key, record("A"));
    setQuestionAttachmentAccount("B");
    expect(await getQuestionAttachmentBlob(key, { localOnly: true })).toBeUndefined();
    expect(await listQuestionAttachmentBlobKeys()).toEqual([]);
    expect(await collectQuestionAttachmentPayloads(questions)).toEqual({ payloads: [], missingBlobKeys: [key] });
    await putQuestionAttachmentBlob(key, record("B"));
    expect((await collectQuestionAttachmentPayloads(questions)).payloads[0].base64).toBe(btoa("B"));
    await runQuestionAttachmentMaintenance([]);
    await deleteQuestionAttachmentBlobs([key]);
    setQuestionAttachmentAccount("A");
    expect(await (await getQuestionAttachmentBlob(key))!.blob.text()).toBe("A");
    expect((await collectQuestionAttachmentPayloads(questions)).payloads[0].base64).toBe(btoa("A"));
  });

  it("rejects an A→B→A transition during a real IndexedDB read", async () => {
    setQuestionAttachmentAccount("A");
    await putQuestionAttachmentBlob(key, record("A"));
    const original = FakeObjectStore.prototype.get;
    vi.spyOn(FakeObjectStore.prototype, "get").mockImplementationOnce(function (this: IDBObjectStore, input) {
      const request = original.call(this, input);
      setQuestionAttachmentAccount("B");
      setQuestionAttachmentAccount("A");
      return request;
    });
    await expect(getQuestionAttachmentBlob(key)).rejects.toThrow(/account changed/i);
    expect(await (await getQuestionAttachmentBlob(key))!.blob.text()).toBe("A");
  });

  it("rejects a requested cloud account different from the active image owner", async () => {
    setQuestionAttachmentAccount("B");
    await putQuestionAttachmentBlob(key, record("B"));
    await expect(getQuestionAttachmentBlob(key, { accountId: "A" })).rejects.toThrow(/account changed/i);
    await expect(putQuestionAttachmentBlob(key, record("A"), { accountId: "A" })).rejects.toThrow(/account changed/i);
    expect(await (await getQuestionAttachmentBlob(key))!.blob.text()).toBe("B");
  });

  it("retains legacy bytes under the old device link instead of the next signed-in reader", async () => {
    await raw(store => store.put(record("A"), key));
    initializeQuestionAttachmentScope("B", "A");
    expect(await getQuestionAttachmentBlob(key, { localOnly: true })).toBeUndefined();
    setQuestionAttachmentAccount("A");
    expect(await (await getQuestionAttachmentBlob(key))!.blob.text()).toBe("A");
    await runQuestionAttachmentMaintenance([]);
    await deleteQuestionAttachmentBlobs([key]);
    expect(await raw(store => store.get(key))).toMatchObject({ questionId: "same-question" });
    expect(await (await getQuestionAttachmentBlob(key))!.blob.text()).toBe("A");
    resetQuestionAttachmentScopeForTests();
    initializeQuestionAttachmentScope("B", "B");
    expect(await getQuestionAttachmentBlob(key, { localOnly: true })).toBeUndefined();
    setQuestionAttachmentAccount("A");
    expect(await (await getQuestionAttachmentBlob(key))!.blob.text()).toBe("A");
  });

  it("never assigns ambiguous legacy bytes after a new account links, and keeps offline restore usable", async () => {
    await raw(store => store.put(record("?"), key));
    initializeQuestionAttachmentScope();
    expect(await getQuestionAttachmentBlob(key, { localOnly: true })).toBeUndefined();
    setQuestionAttachmentAccount("B");
    initializeQuestionAttachmentScope("B", "B");
    await adoptDeviceQuestionAttachments("B", [key]);
    expect(await getQuestionAttachmentBlob(key, { localOnly: true })).toBeUndefined();
    expect(await raw(store => store.get(key))).toBeTruthy();
    setQuestionAttachmentAccount();
    await restoreQuestionAttachmentPayloads([{ ...meta, questionId: "same-question", base64: btoa("R") }], questions);
    expect(await (await getQuestionAttachmentBlob(key))!.blob.text()).toBe("R");
    expect(await (await raw(store => store.get(key))).blob.text()).toBe("?");
  });

  it("copies known guest images only on explicit device adoption and preserves offline originals", async () => {
    await putQuestionAttachmentBlob(key, record("G"));
    setQuestionAttachmentAccount("A");
    expect(await getQuestionAttachmentBlob(key, { localOnly: true })).toBeUndefined();
    await adoptDeviceQuestionAttachments("A", [key]);
    expect(await (await getQuestionAttachmentBlob(key))!.blob.text()).toBe("G");
    setQuestionAttachmentAccount("B");
    expect(await getQuestionAttachmentBlob(key, { localOnly: true })).toBeUndefined();
    setQuestionAttachmentAccount();
    expect(await (await getQuestionAttachmentBlob(key))!.blob.text()).toBe("G");
  });
});
