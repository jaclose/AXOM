// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { deleteQuestionAttachmentBlobs, putQuestionAttachmentBlob } from "../questionAttachments";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { clearCloudMediaUploadCache, downloadCloudMediaAsset, uploadCloudMedia } from "./cloudMedia";

/**
 * Independent, isolated acceptance for cloud originals after local cache loss.
 * An index is NOT a verified original: the same manifest can outlive a missing,
 * corrupt, or wrong-account object. Synthetic IndexedDB and mock Storage only.
 * No production auth, provider writes, question removal, or real media deletion.
 */
const AT = "2026-11-08T00:00:00.000Z";
const originalBytes = new Uint8Array([137, 80, 78, 71, 16, 5]);
const alteredBytes = new Uint8Array([137, 80, 78, 71, 16, 6]);
const remote = new Map<string, Blob>();
const upload = vi.fn(async (path: string, blob: Blob) => {
  if (remote.has(path)) return { error: { statusCode: "409" } };
  remote.set(path, blob);
  return { error: null };
});
const download = vi.fn(async (path: string) => ({
  data: remote.get(path) ?? null,
  error: remote.has(path) ? null : { statusCode: "404", message: "Synthetic missing original" },
}));
const client = {
  storage: { from: () => ({ upload, download }) },
} as unknown as SupabaseClient;
const guard = async () => {};

async function fixture(): Promise<{ state: NoctyriumState; blobKey: string; hash: string }> {
  const state = makeSeed();
  const blobKey = "synthetic-recovery-" + crypto.randomUUID();
  const blob = new Blob([originalBytes], { type: "image/png" });
  state.questions = [{
    id: "synthetic-recovery-question", source: "manual",
    stem: "An original must remain recoverable before its revision is protected.",
    options: [{ key: "A", text: "A" }], correctKey: "A",
    status: "unseen", tags: [], attempts: [], notes: "",
    attachments: [{
      id: "synthetic-recovery-attachment", blobKey, fileName: "original.png",
      mimeType: "image/png", byteSize: blob.size, altText: "Recovery fixture",
      createdAt: AT, updatedAt: AT,
    }],
    createdAt: AT, updatedAt: AT,
  }];
  state.documents = [];
  await putQuestionAttachmentBlob(blobKey, {
    questionId: "synthetic-recovery-question", blob,
    mimeType: "image/png", byteSize: blob.size, updatedAt: AT,
  });
  return { state, blobKey, hash: await sha256(originalBytes) };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  remote.clear();
  upload.mockClear();
  download.mockClear();
  clearCloudMediaUploadCache();
});

describe("lost local image cache does not make an unverified remote original protected", () => {
  it("recovers an acknowledged immutable original after local cache eviction", async () => {
    const { state, blobKey, hash } = await fixture();
    const first = await uploadCloudMedia(client, "owner-A", state, guard);
    await deleteQuestionAttachmentBlobs([blobKey]);
    clearCloudMediaUploadCache(); // fresh-page / reload-equivalent
    const recovered = await uploadCloudMedia(client, "owner-A", state, guard, first);
    expect(recovered).toEqual(first);
    expect(upload).toHaveBeenCalledTimes(1);
    const bytes = await downloadCloudMediaAsset(client, "owner-A", recovered[0]);
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(originalBytes);
    expect(remote.has("owner-A/" + hash)).toBe(true);
  });

  it("refuses protection when the previously acknowledged remote original has disappeared", async () => {
    const { state, blobKey, hash } = await fixture();
    const first = await uploadCloudMedia(client, "owner-A", state, guard);
    await deleteQuestionAttachmentBlobs([blobKey]);
    remote.delete("owner-A/" + hash); // synthetic server fault, never real account data
    clearCloudMediaUploadCache();
    await expect(uploadCloudMedia(client, "owner-A", state, guard, first))
      .rejects.toThrow();
    expect(remote.size).toBe(0);
  });

  it("refuses protection when same-size bytes at the acknowledged remote path are corrupted", async () => {
    const { state, blobKey, hash } = await fixture();
    const first = await uploadCloudMedia(client, "owner-A", state, guard);
    await deleteQuestionAttachmentBlobs([blobKey]);
    remote.set("owner-A/" + hash, new Blob([alteredBytes], { type: "image/png" }));
    expect(alteredBytes.byteLength).toBe(originalBytes.byteLength);
    clearCloudMediaUploadCache();
    await expect(uploadCloudMedia(client, "owner-A", state, guard, first))
      .rejects.toThrow();
  });

  it("does not let another account reuse an old account's image index without its own original", async () => {
    const { state, blobKey, hash } = await fixture();
    const firstA = await uploadCloudMedia(client, "owner-A", state, guard);
    await deleteQuestionAttachmentBlobs([blobKey]);
    clearCloudMediaUploadCache();
    expect(remote.has("owner-A/" + hash)).toBe(true);
    expect(remote.has("owner-B/" + hash)).toBe(false);
    // Deliberately simulate an incorrect previous-index handoff. The media
    // boundary must refuse to certify a different account's nonexistent copy.
    await expect(uploadCloudMedia(client, "owner-B", state, guard, firstA))
      .rejects.toThrow();
  });
});
