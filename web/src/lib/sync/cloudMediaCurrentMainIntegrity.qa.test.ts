// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { deleteQuestionAttachmentBlobs, getQuestionAttachmentBlob, putQuestionAttachmentBlob } from "../questionAttachments";
import { resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "../questionAttachmentScope";
import { makeSeed } from "../seed";
import { MEDIA_BUCKET, clearCloudMediaUploadCache, uploadCloudMedia } from "./cloudMedia";

// Standalone current-main, test-only audit. Never talks to a production account or bucket.
// A historical manifest is not a current proof of the exact private original.
const owner = "qa-current-main-owner";
const objects = new Map<string, Blob>();
const upload = vi.fn(async (path: string, data: Blob) => {
  if (objects.has(path)) return { error: { statusCode: "409" } };
  objects.set(path, data);
  return { error: null };
});
const download = vi.fn(async (path: string) => {
  const data = objects.get(path);
  return data ? { data, error: null } : { data: null, error: { statusCode: "404" } };
});
const client = { storage: { from: (bucket: string) => {
  expect(bucket).toBe(MEDIA_BUCKET);
  return { upload, download };
} } } as unknown as SupabaseClient;
const guard = async () => undefined;

async function fixture() {
  const at = "2026-11-10T00:00:00.000Z";
  const blob = new Blob([new Uint8Array([137, 80, 78, 71, 123, 45])], { type: "image/png" });
  const blobKey = "qa-current-" + crypto.randomUUID();
  const attachment = { id: blobKey, blobKey, fileName: "source.png", mimeType: "image/png" as const,
    byteSize: blob.size, altText: "Synthetic exact original", createdAt: at, updatedAt: at };
  await putQuestionAttachmentBlob(blobKey, { ...attachment, questionId: "qa-question", blob }, { accountId: owner });
  const state = makeSeed();
  state.questions = [{
    id: "qa-question", stem: "Synthetic source", options: [{ key: "A", text: "A" }],
    source: "manual", correctKey: "A", status: "unseen", tags: [],
    attempts: [], notes: "", attachments: [attachment], createdAt: at, updatedAt: at,
  }];
  state.documents = [];
  const hash = await sha256(new Uint8Array(await blob.arrayBuffer()));
  return { state, blobKey, blob, hash, path: owner + "/" + hash };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  resetQuestionAttachmentScopeForTests();
  setQuestionAttachmentAccount(owner);
  clearCloudMediaUploadCache();
  objects.clear();
  upload.mockClear();
  download.mockClear();
});

describe("current-main verified media recovery after a historical manifest", () => {
  it("fails closed if both same-account local bytes and cloud original are gone", async () => {
    const { state, blobKey, path } = await fixture();
    const previous = await uploadCloudMedia(client, owner, state, guard);
    expect(previous).toHaveLength(1);
    expect(objects.has(path)).toBe(true);
    objects.delete(path); // Fake map only: simulate remote disappearance.
    await deleteQuestionAttachmentBlobs([blobKey]); // Fake IndexedDB only.
    clearCloudMediaUploadCache();
    expect(await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: owner })).toBeUndefined();
    expect((await download(path)).error).toMatchObject({ statusCode: "404" });
    const count = download.mock.calls.length;
    await expect(uploadCloudMedia(client, owner, state, guard, previous))
      .rejects.toThrow(/missing|original|image|protect/i);
    expect(download.mock.calls.length).toBeGreaterThan(count); // Actual second-call verification.
    expect(upload).toHaveBeenCalledTimes(1); // No fabricated repair without source.
  });

  it("heals a definite remote 404 from an intact same-account original, then verifies readback", async () => {
    const { state, blobKey, blob, path } = await fixture();
    const previous = await uploadCloudMedia(client, owner, state, guard);
    objects.delete(path);
    upload.mockClear();
    download.mockClear();
    expect((await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: owner }))?.blob.size).toBe(blob.size);
    expect(await uploadCloudMedia(client, owner, state, guard, previous)).toEqual(previous);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(download.mock.calls.filter(([p]) => p === path).length).toBeGreaterThanOrEqual(2);
    expect(await sha256(new Uint8Array(await objects.get(path)!.arrayBuffer())))
      .toBe(await sha256(new Uint8Array(await blob.arrayBuffer())));
  });

  it("refuses same-size corrupted remote bytes without overwriting them", async () => {
    const { state, blob, path } = await fixture();
    const previous = await uploadCloudMedia(client, owner, state, guard);
    objects.set(path, new Blob([new Uint8Array([1, 2, 3, 4, 5, 6])], { type: "image/png" }));
    expect(objects.get(path)?.size).toBe(blob.size);
    upload.mockClear();
    download.mockClear();
    await expect(uploadCloudMedia(client, owner, state, guard, previous))
      .rejects.toThrow(/integrity|changed|original/i);
    expect(upload).not.toHaveBeenCalled();
    expect(objects.get(path)).not.toBe(blob);
  });

  it("rejects access-denied remote original without uploading around RLS", async () => {
    const { state } = await fixture();
    const previous = await uploadCloudMedia(client, owner, state, guard);
    upload.mockClear();
    download.mockClear();
    download.mockImplementationOnce(async () => ({
      data: null, error: { statusCode: "403" },
    }));
    await expect(uploadCloudMedia(client, owner, state, guard, previous))
      .rejects.toThrow(/verify|reconnect|original|protect/i);
    expect(download).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
  });

  it("allows exact remote-only recovery after local eviction, with fresh verification", async () => {
    const { state, blobKey, path } = await fixture();
    const previous = await uploadCloudMedia(client, owner, state, guard);
    await deleteQuestionAttachmentBlobs([blobKey]);
    expect(await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: owner })).toBeUndefined();
    clearCloudMediaUploadCache();
    download.mockClear();
    const next = await uploadCloudMedia(client, owner, state, guard, previous);
    expect(next).toEqual(previous);
    expect(download.mock.calls.some(([p]) => p === path)).toBe(true);
  });

  it("never lets a second account reuse another account's retained manifest", async () => {
    const { state, blobKey } = await fixture();
    const previous = await uploadCloudMedia(client, owner, state, guard);
    const anotherOwner = "qa-current-main-other-owner";
    setQuestionAttachmentAccount(anotherOwner);
    expect(await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: anotherOwner })).toBeUndefined();
    await expect(uploadCloudMedia(client, anotherOwner, state, guard, previous))
      .rejects.toThrow(/missing|original|image|protect/i);
    expect(upload.mock.calls.every(([p]) => p.startsWith(owner + "/"))).toBe(true);
    setQuestionAttachmentAccount(owner); // A -> B -> A must preserve A's bytes.
    expect(await getQuestionAttachmentBlob(blobKey, { localOnly: true, accountId: owner })).toBeDefined();
  });
});
