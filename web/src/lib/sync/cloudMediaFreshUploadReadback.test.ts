// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { putQuestionAttachmentBlob } from "../questionAttachments";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { clearCloudMediaUploadCache, uploadCloudMedia } from "./cloudMedia";

/**
 * A successful upload HTTP acknowledgment is not a byte-level recovery receipt.
 * Synthetic storage may acknowledge while omitting or changing the object.
 * No actual provider or learner account is accessed.
 */
const AT = "2026-11-08T00:00:00.000Z";
const ORIGINAL = new Uint8Array([137, 80, 78, 71, 65, 88, 79, 77, 11, 12, 13]);
const TAMPERED = new Uint8Array([137, 80, 78, 71, 65, 88, 79, 77, 11, 12, 14]);
const ACCOUNT = "synthetic-fresh-upload-owner";
type StorageMode = "intact" | "missing" | "altered";
let mode: StorageMode = "intact";
let accountCurrent = true;
let revokeOnDownload = false;
const remote = new Map<string, Blob>();
const upload = vi.fn(async (path: string, blob: Blob) => {
  if (mode === "intact") remote.set(path, blob);
  if (mode === "altered") remote.set(path, new Blob([TAMPERED], { type: "image/png" }));
  // All three paths intentionally acknowledge successfully.
  return { error: null };
});
const download = vi.fn(async (path: string) => {
  if (revokeOnDownload) accountCurrent = false;
  return {
    data: remote.get(path) ?? null,
    error: remote.has(path) ? null : { statusCode: "404", message: "Synthetic missing original" },
  };
});
const client = { storage: { from: () => ({ upload, download }) } } as unknown as SupabaseClient;
const assertCurrent = async () => {
  if (!accountCurrent) throw new Error("The account changed during cloud protection.");
};

async function fixture(): Promise<{ state: NoctyriumState; hash: string }> {
  const state = makeSeed();
  const blobKey = "synthetic-fresh-upload-" + crypto.randomUUID();
  const blob = new Blob([ORIGINAL], { type: "image/png" });
  state.questions = [{
    id: "synthetic-fresh-upload-question",
    source: "manual",
    stem: "A new cloud image receipt must prove the stored bytes.",
    options: [{ key: "A", text: "A" }],
    correctKey: "A",
    status: "unseen",
    tags: [],
    attempts: [],
    notes: "",
    attachments: [{
      id: "synthetic-fresh-upload-attachment",
      blobKey,
      fileName: "synthetic.png",
      mimeType: "image/png",
      byteSize: blob.size,
      altText: "Synthetic source",
      createdAt: AT,
      updatedAt: AT,
    }],
    createdAt: AT,
    updatedAt: AT,
  }];
  state.documents = [];
  await putQuestionAttachmentBlob(blobKey, {
    questionId: "synthetic-fresh-upload-question",
    blob,
    mimeType: "image/png",
    byteSize: blob.size,
    updatedAt: AT,
  });
  return { state, hash: await sha256(ORIGINAL) };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  clearCloudMediaUploadCache();
  remote.clear();
  upload.mockClear();
  download.mockClear();
  mode = "intact";
  accountCurrent = true;
  revokeOnDownload = false;
});

describe("new upload must verify actual account-storage bytes before a protected receipt", () => {
  it("accepts an intact new upload only after same-account byte readback", async () => {
    const { state, hash } = await fixture();
    const manifest = await uploadCloudMedia(client, ACCOUNT, state, assertCurrent);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].hash).toBe(hash);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(ACCOUNT + "/" + hash);
    expect(remote.has(ACCOUNT + "/" + hash)).toBe(true);
  });

  it("fails closed when storage acknowledges an upload but no object is present", async () => {
    const { state } = await fixture();
    mode = "missing";
    await expect(uploadCloudMedia(client, ACCOUNT, state, assertCurrent)).rejects.toThrow();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("fails closed on same-size changed bytes despite successful upload acknowledgment", async () => {
    const { state } = await fixture();
    expect(ORIGINAL.byteLength).toBe(TAMPERED.byteLength);
    mode = "altered";
    await expect(uploadCloudMedia(client, ACCOUNT, state, assertCurrent)).rejects.toThrow();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("rejects an account transition while fresh upload readback is in flight", async () => {
    const { state } = await fixture();
    revokeOnDownload = true;
    await expect(uploadCloudMedia(client, ACCOUNT, state, assertCurrent)).rejects.toThrow(/account changed/i);
    expect(download).toHaveBeenCalledTimes(1);
  });
});

/**
 * A failed first protection must not poison the per-account confirmed-hash
 * cache. When storage initially acknowledges without retaining bytes, a later
 * healthy retry of the SAME original must upload again and verify the bytes.
 * This models a transient storage fault with an isolated synthetic account.
 */
describe("retry after an acknowledged-but-missing first upload", () => {
  it("leaves protection pending, then retries and certifies only a verified original", async () => {
    const { state, hash } = await fixture();
    mode = "missing";
    await expect(uploadCloudMedia(client, ACCOUNT, state, assertCurrent))
      .rejects.toThrow();
    expect(remote.size).toBe(0);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);

    mode = "intact";
    const recovered = await uploadCloudMedia(client, ACCOUNT, state, assertCurrent);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ hash, byteSize: ORIGINAL.byteLength });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledTimes(2);
    const original = remote.get(ACCOUNT + "/" + hash);
    expect(original).toBeDefined();
    expect(new Uint8Array(await original!.arrayBuffer())).toEqual(ORIGINAL);
  });
});
