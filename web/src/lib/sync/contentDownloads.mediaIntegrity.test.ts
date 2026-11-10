// @vitest-environment node
import { indexedDB, IDBKeyRange, IDBObjectStore as FakeIDBObjectStore } from "fake-indexeddb";
import { ATTACHMENT_STORE_NAME } from "../localVault";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { makeSeed } from "../seed";
import { deleteQuestionAttachmentBlobs, getQuestionAttachmentBlob, putQuestionAttachmentBlob } from "../questionAttachments";
import { addQuestionAttachmentBlobIfAbsent } from "./atomicMediaWrite";
import { getQuestionAttachmentScope, setQuestionAttachmentAccount } from "../questionAttachmentScope";
import { clearCloudContentCache, splitCloudContent, uploadCloudContent } from "./cloudContent";
import { clearCloudMediaUploadCache, MEDIA_BUCKET, uploadCloudMedia } from "./cloudMedia";
import { deferContent } from "./deferredContent";
import { materializeState } from "./contentDownloads";
import type { NoctyriumState } from "../types";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../account/supabase", () => ({ accountOperationClient: async () => session.current }));

const owner = "synthetic-content-download-r23";
const timestamp = "2026-11-10T00:00:00.000Z";
const original = new Blob([new Uint8Array([137, 80, 78, 71, 10, 20, 30, 40])], { type: "image/png" });
const objects = new Map<string, Blob>();
const download = vi.fn(async (bucket: string, path: string) => ({
  data: objects.get(`${bucket}/${path}`) ?? null,
  error: objects.has(`${bucket}/${path}`) ? null : { statusCode: "404" },
}));
const client = {
  storage: { from: (bucket: string) => ({
    upload: async (path: string, blob: Blob) => {
      const key = `${bucket}/${path}`;
      if (objects.has(key)) return { error: { statusCode: "409" } };
      objects.set(key, blob);
      return { error: null };
    },
    download: (path: string) => download(bucket, path),
  }) },
} as unknown as SupabaseClient;

function stateFixture(): NoctyriumState {
  const state = makeSeed();
  const key = `same-key-${crypto.randomUUID()}`;
  state.questions = [{
    id: `question-${key}`, stem: "Synthetic image identity question", options: [{ key: "A", text: "Synthetic" }],
    correctKey: "A", source: "manual", status: "unseen", tags: [], attempts: [],
    notes: "", createdAt: timestamp, updatedAt: timestamp,
    attachments: [{
      id: key, blobKey: key, fileName: "synthetic.png", mimeType: "image/png",
      byteSize: original.size, altText: "Synthetic source figure",
      createdAt: timestamp, updatedAt: timestamp,
    }],
  }];
  state.documents = [];
  return state;
}

async function protectedDeferred() {
  const state = stateFixture();
  const attachment = state.questions[0].attachments![0];
  await putQuestionAttachmentBlob(attachment.blobKey, {
    questionId: state.questions[0].id, blob: original, byteSize: original.size,
    mimeType: "image/png", updatedAt: timestamp,
  }, { accountId: owner });
  const split = await splitCloudContent(state);
  await uploadCloudContent(client, owner, split.objects, [], async () => undefined);
  const manifest = await uploadCloudMedia(client, owner, state, async () => undefined);
  const deferred = deferContent(split.workspace, owner, split.references, manifest);
  expect(manifest[0].hash).toBe(await sha256(new Uint8Array(await original.arrayBuffer())));
  download.mockClear();
  return { deferred, attachment };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  setQuestionAttachmentAccount(owner);
  const startedScope = getQuestionAttachmentScope();
  session.current = {
    client, userId: owner,
    assertCurrent: async () => {
      if (getQuestionAttachmentScope() !== startedScope) throw new Error("Account changed during content download.");
    },
  };
  objects.clear();
  download.mockClear();
  clearCloudContentCache();
  clearCloudMediaUploadCache();
});
afterEach(() => {
  setQuestionAttachmentAccount(undefined);
  vi.unstubAllGlobals();
});

describe("explicit account source download preserves immutable local image identity", () => {
  it("rejects same-size wrong bytes instead of silently accepting a mismatched original", async () => {
    const { deferred, attachment } = await protectedDeferred();
    const corrupt = new Blob([new Uint8Array([137, 80, 78, 71, 99, 88, 77, 66])], { type: "image/png" });
    expect(corrupt.size).toBe(original.size);
    await putQuestionAttachmentBlob(attachment.blobKey, {
      questionId: deferred.deferredContent!.questions[0].id, blob: corrupt,
      byteSize: corrupt.size, mimeType: "image/png", updatedAt: timestamp,
    }, { accountId: owner });
    await expect(materializeState(deferred)).rejects.toThrow(/image.*(original|bytes|integrity|checksum|conflict)/i);
    const retained = await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, accountId: owner });
    expect(await retained!.blob.arrayBuffer()).toEqual(await corrupt.arrayBuffer());
    expect(download.mock.calls.filter(([bucket]) => bucket === MEDIA_BUCKET)).toHaveLength(0);
    expect(deferred.questions).toHaveLength(0);
  });

  it("does not overwrite a locally saved wrong-size original during remote recovery", async () => {
    const { deferred, attachment } = await protectedDeferred();
    const conflicting = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
    await putQuestionAttachmentBlob(attachment.blobKey, {
      questionId: deferred.deferredContent!.questions[0].id, blob: conflicting,
      byteSize: conflicting.size, mimeType: "image/png", updatedAt: timestamp,
    }, { accountId: owner });
    await expect(materializeState(deferred)).rejects.toThrow(/image.*(original|bytes|integrity|checksum|conflict)/i);
    const retained = await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, accountId: owner });
    expect(await retained!.blob.arrayBuffer()).toEqual(await conflicting.arrayBuffer());
    expect(deferred.questions).toHaveLength(0);
  });

  it("reuses only the verified local bytes without a second media download", async () => {
    const { deferred } = await protectedDeferred();
    const restored = await materializeState(deferred);
    expect(restored.questions).toHaveLength(1);
    expect(download.mock.calls.filter(([bucket]) => bucket === MEDIA_BUCKET)).toHaveLength(0);
  });

  it("downloads a missing original from this account and stores exact verified bytes", async () => {
    const { deferred, attachment } = await protectedDeferred();
    await deleteQuestionAttachmentBlobs([attachment.blobKey], { accountId: owner });
    const restored = await materializeState(deferred);
    expect(restored.questions).toHaveLength(1);
    const fetched = await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, accountId: owner });
    expect(await fetched!.blob.arrayBuffer()).toEqual(await original.arrayBuffer());
    expect(download.mock.calls.filter(([bucket]) => bucket === MEDIA_BUCKET)).toHaveLength(1);
  });

  it("does not import into account B after an in-flight A download changes identity", async () => {
    const { deferred, attachment } = await protectedDeferred();
    await deleteQuestionAttachmentBlobs([attachment.blobKey], { accountId: owner });
    const regularDownload = download.getMockImplementation()!;
    let started!: () => void;
    const reachedDownload = new Promise<void>((resolve) => { started = resolve; });
    let resume!: () => void;
    const resumeDownload = new Promise<void>((resolve) => { resume = resolve; });
    download.mockImplementation(async (bucket, path) => {
      if (bucket === MEDIA_BUCKET) {
        started();
        await resumeDownload;
      }
      return regularDownload(bucket, path);
    });
    const pending = materializeState(deferred);
    await reachedDownload;
    setQuestionAttachmentAccount("synthetic-other-account-r23");
    resume();
    await expect(pending).rejects.toThrow(/Account changed/i);
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, accountId: "synthetic-other-account-r23" })).toBeUndefined();
  });
  it("does not replace a cross-tab image committed after the final missing-key read", async () => {
    const { deferred, attachment } = await protectedDeferred();
    await deleteQuestionAttachmentBlobs([attachment.blobKey], { accountId: owner });
    const conflicting = new Blob([new Uint8Array([137, 80, 78, 71, 66, 55, 44, 33])], { type: "image/png" });
    const originalGet = FakeIDBObjectStore.prototype.get;
    let scopedReads = 0;
    let raced = false;
    // Create the competing write transaction DURING the final readonly
    // get. IndexedDB queues it before the recovery writer's next readwrite
    // transaction, reproducing a real tab interleaving without changing
    // production code or depending on timing/sleep.
    const get = vi.spyOn(FakeIDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, key) {
      const request = originalGet.call(this, key);
      if (this.name === ATTACHMENT_STORE_NAME && Array.isArray(key) && key[2] === attachment.blobKey
        && ++scopedReads === 2) {
        raced = true;
        const tx = this.transaction.db.transaction(ATTACHMENT_STORE_NAME, "readwrite");
        tx.objectStore(ATTACHMENT_STORE_NAME).add({
          questionId: deferred.deferredContent!.questions[0].id,
          blob: conflicting, byteSize: conflicting.size, mimeType: attachment.mimeType, updatedAt: timestamp,
        }, key);
      }
      return request;
    });
    try {
      await expect(materializeState(deferred)).rejects.toThrow(/image.*(original|conflict)/i);
    } finally {
      get.mockRestore();
    }
    expect(raced).toBe(true);
    const retained = await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, accountId: owner });
    expect(await retained!.blob.arrayBuffer()).toEqual(await conflicting.arrayBuffer());
    expect(deferred.questions).toHaveLength(0);
  });

  it("atomically preserves a competing tab's original and rejects a mismatched winner", async () => {
    const { deferred, attachment } = await protectedDeferred();
    await deleteQuestionAttachmentBlobs([attachment.blobKey], { accountId: owner });
    const wrong = new Blob([new Uint8Array([137, 80, 78, 71, 9, 9, 9, 9])], { type: "image/png" });
    const record = {
      questionId: deferred.deferredContent!.questions[0].id,
      blob: wrong, byteSize: wrong.size, mimeType: attachment.mimeType, updatedAt: timestamp,
    };
    // Two same-account tabs can both decide a key is absent. Only add, never
    // put, makes the concurrent winner permanent and observable by recovery.
    const results = await Promise.all([
      addQuestionAttachmentBlobIfAbsent(attachment.blobKey, record, { accountId: owner }),
      addQuestionAttachmentBlobIfAbsent(attachment.blobKey, {
        ...record, blob: original, byteSize: original.size,
      }, { accountId: owner }),
    ]);
    expect([...results].sort()).toEqual(["exists", "inserted"]);
    const winning = await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, accountId: owner });
    const bytes = await winning!.blob.arrayBuffer();
    if (await sha256(new Uint8Array(bytes)) !== await sha256(new Uint8Array(await original.arrayBuffer()))) {
      await expect(materializeState(deferred)).rejects.toThrow(/image.*(original|conflict)/i);
      const after = await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, accountId: owner });
      expect(await after!.blob.arrayBuffer()).toEqual(bytes);
    } else {
      const restored = await materializeState(deferred);
      expect(restored.questions).toHaveLength(1);
    }
  });

  it("rejects an A to B to A epoch change while fetching missing original bytes", async () => {
    const { deferred, attachment } = await protectedDeferred();
    await deleteQuestionAttachmentBlobs([attachment.blobKey], { accountId: owner });
    const originalDownload = download.getMockImplementation()!;
    let started!: () => void;
    const downloading = new Promise<void>(resolve => { started = resolve; });
    let resume!: () => void;
    const resumed = new Promise<void>(resolve => { resume = resolve; });
    download.mockImplementation(async (bucket, path) => {
      if (bucket === MEDIA_BUCKET) { started(); await resumed; }
      return originalDownload(bucket, path);
    });
    const pending = materializeState(deferred);
    await downloading;
    setQuestionAttachmentAccount("synthetic-second-owner-r24");
    setQuestionAttachmentAccount(owner);
    resume();
    await expect(pending).rejects.toThrow(/Account changed/i);
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, accountId: owner })).toBeUndefined();
  });

  it("rejects an A→B→A scope change during a missing-image download even when the Supabase token stayed unchanged", async () => {
    const { deferred, attachment } = await protectedDeferred();
    await deleteQuestionAttachmentBlobs([attachment.blobKey], { accountId: owner });
    // A single accountOperationClient call can continue to observe the same
    // A session/token while local attachment ownership has cycled A→B→A.
    // Session-only checks are therefore intentionally still successful.
    session.current = { client, userId: owner, assertCurrent: async () => undefined };
    const upstream = download.getMockImplementation()!;
    let notifyDownload!: () => void;
    const reachedDownload = new Promise<void>(resolve => { notifyDownload = resolve; });
    let resumeDownload!: () => void;
    const resume = new Promise<void>(resolve => { resumeDownload = resolve; });
    download.mockImplementation(async (bucket, path) => {
      if (bucket === MEDIA_BUCKET) { notifyDownload(); await resume; }
      return upstream(bucket, path);
    });
    const pending = materializeState(deferred);
    await reachedDownload;
    setQuestionAttachmentAccount("synthetic-intermediate-owner-r26");
    setQuestionAttachmentAccount(owner);
    resumeDownload();
    await expect(pending).rejects.toThrow(/account changed/i);
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, accountId: owner })).toBeUndefined();
    // Access to B's database scope requires B ownership. Read under B,
    // then return to A; neither identity should have received the bytes.
    setQuestionAttachmentAccount("synthetic-intermediate-owner-r26");
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, accountId: "synthetic-intermediate-owner-r26" })).toBeUndefined();
    setQuestionAttachmentAccount(owner);
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, accountId: owner })).toBeUndefined();
    expect(deferred.questions).toHaveLength(0);
  });

  it("refuses an atomic image write with a superseded originating account generation", async () => {
    const initiating = getQuestionAttachmentScope();
    setQuestionAttachmentAccount("synthetic-intermediate-owner-r26");
    setQuestionAttachmentAccount(owner);
    const blobKey = "synthetic-epoch-r26-atomic-guard";
    await expect(addQuestionAttachmentBlobIfAbsent(blobKey, {
      questionId: "synthetic-epoch-r26",
      blob: original, byteSize: original.size, mimeType: "image/png", updatedAt: timestamp,
    }, { accountId: owner, scope: initiating })).rejects.toThrow(/account changed/i);
    expect(await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: owner })).toBeUndefined();
  });

  it("rejects an A→B→A transition while accountOperationClient is still awaiting the session", async () => {
    const { deferred, attachment } = await protectedDeferred();
    await deleteQuestionAttachmentBlobs([attachment.blobKey], { accountId: owner });
    let resolveSession!: (operation: unknown) => void;
    session.current = new Promise<unknown>(resolve => { resolveSession = resolve; });
    const pending = materializeState(deferred);
    // The local account has already switched twice when Auth returns A's
    // previous token. A freshly captured scope after this await is unsafe.
    setQuestionAttachmentAccount("synthetic-during-session-owner-r26");
    setQuestionAttachmentAccount(owner);
    resolveSession({ client, userId: owner, assertCurrent: async () => undefined });
    await expect(pending).rejects.toThrow(/account changed/i);
    expect(await getQuestionAttachmentBlob(attachment.blobKey, { localOnly: true, accountId: owner })).toBeUndefined();
    expect(deferred.questions).toHaveLength(0);
  });

});
