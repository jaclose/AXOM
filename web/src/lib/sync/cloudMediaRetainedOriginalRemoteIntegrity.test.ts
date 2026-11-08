// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { putQuestionAttachmentBlob } from "../questionAttachments";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { clearCloudMediaUploadCache, downloadCloudMediaAsset, uploadCloudMedia } from "./cloudMedia";

/**
 * Independent negative acceptance for a *retained* local original whose
 * previously acknowledged account-storage object changes after upload.
 *
 * Unlike cache-eviction coverage, the local image remains available and its
 * local hash still agrees with the old manifest. A storage object's matching
 * path and byte count cannot prove its actual bytes remain intact.
 *
 * Entirely synthetic fake IndexedDB + mock Storage. No account login, real
 * cloud calls, deletion, real question edits, or production mutations.
 */
const AT = "2026-11-08T00:00:00.000Z";
const sourceBytes = new Uint8Array([137, 80, 78, 71, 11, 12, 13]);
const alteredBytes = new Uint8Array([137, 80, 78, 71, 11, 12, 14]);
const remote = new Map<string, Blob>();

const upload = vi.fn(async (path: string, blob: Blob) => {
  if (remote.has(path)) return { error: { statusCode: "409" } };
  remote.set(path, blob);
  return { error: null };
});
const download = vi.fn(async (path: string) => ({
  data: remote.get(path) ?? null,
  error: remote.has(path) ? null : { statusCode: "404", message: "Synthetic object absent" },
}));
const client = { storage: { from: () => ({ upload, download }) } } as unknown as SupabaseClient;
const assertCurrent = async () => {};

async function fixture(): Promise<{ state: NoctyriumState; hash: string; blobKey: string }> {
  const state = makeSeed();
  const blobKey = "synthetic-retained-original-" + crypto.randomUUID();
  const blob = new Blob([sourceBytes], { type: "image/png" });
  state.questions = [{
    id: "synthetic-retained-original-question",
    source: "manual",
    stem: "A previously protected figure must remain retrievable as its exact original.",
    options: [{ key: "A", text: "A" }],
    correctKey: "A",
    status: "unseen",
    tags: [],
    attempts: [],
    notes: "",
    attachments: [{
      id: "synthetic-retained-original-attachment",
      blobKey,
      fileName: "original.png",
      mimeType: "image/png",
      byteSize: blob.size,
      altText: "Original integrity fixture",
      createdAt: AT,
      updatedAt: AT,
    }],
    createdAt: AT,
    updatedAt: AT,
  }];
  state.documents = [];
  await putQuestionAttachmentBlob(blobKey, {
    questionId: "synthetic-retained-original-question",
    blob,
    mimeType: "image/png",
    byteSize: blob.size,
    updatedAt: AT,
  });
  return { state, hash: await sha256(sourceBytes), blobKey };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  remote.clear();
  upload.mockClear();
  download.mockClear();
  clearCloudMediaUploadCache();
});

describe("retained-local original does not certify changed account-storage bytes", () => {
  it("accepts an unchanged verified remote original on repeated protection", async () => {
    const { state, hash } = await fixture();
    const original = await uploadCloudMedia(client, "synthetic-owner", state, assertCurrent);
    const repeated = await uploadCloudMedia(client, "synthetic-owner", state, assertCurrent, original);
    expect(repeated).toEqual(original);
    const recovered = await downloadCloudMediaAsset(client, "synthetic-owner", repeated[0]);
    expect(new Uint8Array(await recovered.arrayBuffer())).toEqual(sourceBytes);
    expect(remote.has("synthetic-owner/" + hash)).toBe(true);
  });

  it("rejects a previously indexed remote original changed to different same-size bytes while local bytes remain", async () => {
    const { state, hash, blobKey } = await fixture();
    const original = await uploadCloudMedia(client, "synthetic-owner", state, assertCurrent);
    expect(original[0].blobKey).toBe(blobKey);
    expect(alteredBytes.byteLength).toBe(sourceBytes.byteLength);
    remote.set("synthetic-owner/" + hash, new Blob([alteredBytes], { type: "image/png" }));
    clearCloudMediaUploadCache(); // eliminate module-level positive cache as a confounder
    await expect(uploadCloudMedia(client, "synthetic-owner", state, assertCurrent, original))
      .rejects.toThrow();
  });

  it("does not trust an in-process confirmed-upload hash after its remote original changes", async () => {
    const { state, hash } = await fixture();
    const first = await uploadCloudMedia(client, "synthetic-owner", state, assertCurrent);
    expect(first[0].hash).toBe(hash);
    // Do not clear the module-level confirmed-upload set; prove it is not
    // itself authority for a later revision when previous=[].
    remote.set("synthetic-owner/" + hash, new Blob([alteredBytes], { type: "image/png" }));
    await expect(uploadCloudMedia(client, "synthetic-owner", state, assertCurrent, []))
      .rejects.toThrow();
  });
});
