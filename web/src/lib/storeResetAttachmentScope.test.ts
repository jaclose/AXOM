import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as attachments from "./questionAttachments";
import { resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "./questionAttachmentScope";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import { flushLocalVaultWrites } from "./localVault";

const key = "same-imported-image-key";
const record = (owner: string) => ({
  blob: new Blob([owner], { type: "image/png" }), mimeType: "image/png" as const,
  byteSize: owner.length, questionId: "shared-question-id", updatedAt: "2026-11-09",
});

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  resetQuestionAttachmentScopeForTests();
  useStore.setState(makeSeed());
  await flushLocalVaultWrites();
  setQuestionAttachmentAccount("A");
  await attachments.putQuestionAttachmentBlob(key, record("A"));
  setQuestionAttachmentAccount("B");
  await attachments.putQuestionAttachmentBlob(key, record("B"));
  setQuestionAttachmentAccount("A");
});
afterEach(async () => { await flushLocalVaultWrites(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each(["resetToSeed", "startFresh"] as const)("%s image cleanup ownership", action => {
  it("does not delete B's same-key bytes after A's completed inventory crosses an account switch", async () => {
    // The inventory has already verified A. Hold only delivery to the caller,
    // reproducing an account event between inventory completion and cleanup.
    const keys = await attachments.listQuestionAttachmentBlobKeys();
    let release!: (value: string[]) => void;
    vi.spyOn(attachments, "listQuestionAttachmentBlobKeys").mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const deletion = vi.spyOn(attachments, "deleteQuestionAttachmentBlobs");
    useStore.getState()[action]();
    setQuestionAttachmentAccount("B");
    release(keys);
    await vi.waitFor(() => expect(deletion).toHaveBeenCalledOnce());
    await deletion.mock.results[0].value.catch(() => undefined);
    expect(await (await attachments.getQuestionAttachmentBlob(key, { localOnly: true }))?.blob.text()).toBe("B");
    setQuestionAttachmentAccount("A");
    expect(await (await attachments.getQuestionAttachmentBlob(key, { localOnly: true }))?.blob.text()).toBe("A");
  });

  it("still removes the initiating account's bytes when its scope remains current", async () => {
    const deletion = vi.spyOn(attachments, "deleteQuestionAttachmentBlobs");
    useStore.getState()[action]();
    await vi.waitFor(() => expect(deletion).toHaveBeenCalledOnce());
    await deletion.mock.results[0].value;
    expect(await attachments.getQuestionAttachmentBlob(key, { localOnly: true })).toBeUndefined();
    setQuestionAttachmentAccount("B");
    expect(await (await attachments.getQuestionAttachmentBlob(key, { localOnly: true }))?.blob.text()).toBe("B");
  });
});
