// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setQuestionAttachmentAccount } from "./account/attachmentScope";
import { exportStateWithAttachments } from "./backup";
import { createMediaBackupArchive } from "./backupArchive";
import { DB_NAME } from "./localVault";
import { putQuestionAttachmentBlob, type QuestionImageAttachment } from "./questionAttachments";
import { makeSeed } from "./seed";

const date = "2026-11-09T00:00:00.000Z";
const key = "same-image-key";
const bytesA = "ACCOUNT_A_IMAGE";
const attachment: QuestionImageAttachment = {
  id: key, blobKey: key, fileName: "figure.png", mimeType: "image/png",
  byteSize: bytesA.length, altText: "Figure", createdAt: date, updatedAt: date,
};

function stateWithImage() {
  const state = makeSeed();
  state.questions = [{
    id: "same-question", source: "manual", stem: "Synthetic question", options: [],
    status: "unseen", tags: [], attempts: [], attachments: [attachment],
    createdAt: date, updatedAt: date,
  }];
  return state;
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? Error("Could not reset test storage"));
    request.onblocked = () => reject(Error("A test storage connection remained open"));
  });
}

beforeEach(async () => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  await deleteDatabase();
  setQuestionAttachmentAccount("synthetic-A");
  await putQuestionAttachmentBlob(key, {
    blob: new Blob([bytesA], { type: "image/png" }), mimeType: "image/png",
    byteSize: bytesA.length, questionId: "same-question", updatedAt: date,
  });
});

afterEach(() => {
  setQuestionAttachmentAccount(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

it("exports A's image but does not place A's bytes in B's JSON backup", async () => {
  const downloads: Blob[] = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true, value: vi.fn((blob: Blob) => { downloads.push(blob); return `blob:test-${downloads.length}`; }),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const state = stateWithImage();
  const a = await exportStateWithAttachments(state);
  expect(a.attachmentCount).toBe(1);
  const aBackup = JSON.parse(await downloads[0].text());
  expect(atob(aBackup.questionAttachmentPayloads[0].base64)).toBe(bytesA);

  setQuestionAttachmentAccount("synthetic-B");
  const b = await exportStateWithAttachments(state);
  expect(b.attachmentCount).toBe(0);
  expect(b.missingBlobKeys).toEqual([key]);
  const bBackup = JSON.parse(await downloads[1].text());
  expect(bBackup.questionAttachmentPayloads).toBeUndefined();
  expect(JSON.stringify(bBackup)).not.toContain(bytesA);
});

it("aborts a JSON backup when the account changes during the attachment read", async () => {
  const original = NodeBlob.prototype.arrayBuffer;
  let entered!: () => void;
  let release!: () => void;
  const reading = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(NodeBlob.prototype, "arrayBuffer").mockImplementation(function (this: NodeBlob) {
    if (this.type === "image/png") { entered(); return gate.then(() => original.call(this)); }
    return original.call(this);
  });
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const exporting = exportStateWithAttachments(stateWithImage());
  await reading;
  setQuestionAttachmentAccount("synthetic-B");
  release();
  await expect(exporting).rejects.toThrow(/account changed/i);
  expect(download).not.toHaveBeenCalled();
});

it("aborts a ZIP archive when the account changes during media collection", async () => {
  const original = NodeBlob.prototype.arrayBuffer;
  let entered!: () => void;
  let release!: () => void;
  const reading = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(NodeBlob.prototype, "arrayBuffer").mockImplementation(function (this: NodeBlob) {
    if (this.type === "image/png") { entered(); return gate.then(() => original.call(this)); }
    return original.call(this);
  });

  const archiving = createMediaBackupArchive({ _app: "AXOM" }, stateWithImage().questions);
  await reading;
  setQuestionAttachmentAccount("synthetic-B");
  release();
  await expect(archiving).rejects.toThrow(/account changed/i);
});
