// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { deleteQuestionAttachmentBlobs, putQuestionAttachmentBlob } from "../questionAttachments";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { clearCloudMediaUploadCache, uploadCloudMedia } from "./cloudMedia";

/**
 * A historically verified private original is not permanently durable: a
 * remote 404 with intact local bytes needs an immutable retry and fresh
 * readback, not a stale success or an endless fail-closed-only loop.
 * Synthetic isolated storage and account epoch only; not live Supabase.
 */
const OWNER = "synthetic-remote-repair-owner";
const AT = "2026-11-08T00:00:00.000Z";
const ORIGINAL = new Uint8Array([137, 80, 78, 71, 65, 88, 79, 77, 31, 32, 33]);
const WRONG = new Uint8Array([137, 80, 78, 71, 65, 88, 79, 77, 31, 32, 34]);
const remote = new Map<string, Blob>();
let forbidden = false;
let revokeDuringReadback = false;
let current = true;
const upload = vi.fn(async (path: string, blob: Blob) => {
  if (remote.has(path)) return { error: { statusCode: "409" } };
  remote.set(path, blob);
  return { error: null };
});
const download = vi.fn(async (path: string) => {
  if (revokeDuringReadback) current = false;
  if (forbidden) return { data: null, error: { statusCode: "403", message: "RLS denies readback" } };
  const data = remote.get(path) ?? null;
  return { data, error: data ? null : { statusCode: "404", message: "Missing original" } };
});
const client = { storage: { from: () => ({ upload, download }) } } as unknown as SupabaseClient;
const guard = async () => { if (!current) throw new Error("Synthetic account changed during recovery."); };

async function fixture(): Promise<{ state: NoctyriumState; hash: string; blobKey: string }> {
  const state = makeSeed();
  const blob = new Blob([ORIGINAL], { type: "image/png" });
  const blobKey = "synthetic-repair-" + crypto.randomUUID();
  state.questions = [{
    id: "synthetic-repair-question",
    source: "manual",
    stem: "Protected image recovery must prove live account originals.",
    options: [{ key: "A", text: "A" }],
    correctKey: "A",
    status: "unseen",
    tags: [],
    attempts: [],
    notes: "",
    attachments: [{
      id: "synthetic-repair-attachment",
      blobKey,
      fileName: "synthetic.png",
      mimeType: "image/png",
      byteSize: blob.size,
      altText: "Synthetic original",
      createdAt: AT,
      updatedAt: AT,
    }],
    createdAt: AT,
    updatedAt: AT,
  }];
  state.documents = [];
  await putQuestionAttachmentBlob(blobKey, {
    questionId: "synthetic-repair-question", blob,
    mimeType: "image/png", byteSize: blob.size, updatedAt: AT,
  });
  return { state, hash: await sha256(ORIGINAL), blobKey };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  clearCloudMediaUploadCache();
  remote.clear(); upload.mockClear(); download.mockClear();
  forbidden = false; revokeDuringReadback = false; current = true;
});

describe("repair a missing, previously verified account-private original", () => {
  it("reuploads and rechecks after a same-revision protected-manifest remote 404", async () => {
    const { state, hash } = await fixture();
    const first = await uploadCloudMedia(client, OWNER, state, guard);
    expect(upload).toHaveBeenCalledTimes(1);
    remote.delete(OWNER + "/" + hash);

    const repaired = await uploadCloudMedia(client, OWNER, state, guard, first);
    expect(repaired).toEqual(first);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledTimes(3);
    expect(new Uint8Array(await remote.get(OWNER + "/" + hash)!.arrayBuffer())).toEqual(ORIGINAL);
  });

  it("repairs a historical confirmed-hash cache hit even without a prior manifest", async () => {
    const { state, hash } = await fixture();
    await uploadCloudMedia(client, OWNER, state, guard);
    remote.delete(OWNER + "/" + hash);
    const repaired = await uploadCloudMedia(client, OWNER, state, guard);
    expect(repaired[0].hash).toBe(hash);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledTimes(3);
  });

  it("repairs a previously protected hash with changed attachment timestamp", async () => {
    const { state, hash } = await fixture();
    const first = await uploadCloudMedia(client, OWNER, state, guard);
    remote.delete(OWNER + "/" + hash);
    state.questions[0].attachments![0].updatedAt = new Date(Date.parse(AT) + 60_000).toISOString();
    const repaired = await uploadCloudMedia(client, OWNER, state, guard, first);
    expect(repaired[0].updatedAt).not.toBe(first[0].updatedAt);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledTimes(3);
  });

  it("does not repair a 403 or infer authorization from a missing private object", async () => {
    const { state, hash } = await fixture();
    const first = await uploadCloudMedia(client, OWNER, state, guard);
    remote.delete(OWNER + "/" + hash);
    forbidden = true;
    await expect(uploadCloudMedia(client, OWNER, state, guard, first)).rejects.toThrow();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite same-length corrupt remote originals", async () => {
    const { state, hash } = await fixture();
    const first = await uploadCloudMedia(client, OWNER, state, guard);
    expect(WRONG.byteLength).toBe(ORIGINAL.byteLength);
    remote.set(OWNER + "/" + hash, new Blob([WRONG], { type: "image/png" }));
    await expect(uploadCloudMedia(client, OWNER, state, guard, first)).rejects.toThrow(/integrity check/);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("cannot certify a missing remote original without intact local image bytes", async () => {
    const { state, hash, blobKey } = await fixture();
    const first = await uploadCloudMedia(client, OWNER, state, guard);
    remote.delete(OWNER + "/" + hash);
    await deleteQuestionAttachmentBlobs([blobKey]);
    await expect(uploadCloudMedia(client, OWNER, state, guard, first)).rejects.toThrow();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("never retries an upload after account identity changes during the remote check", async () => {
    const { state, hash } = await fixture();
    const first = await uploadCloudMedia(client, OWNER, state, guard);
    remote.delete(OWNER + "/" + hash);
    revokeDuringReadback = true;
    await expect(uploadCloudMedia(client, OWNER, state, guard, first)).rejects.toThrow(/account changed/);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
