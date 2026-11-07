// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { deleteQuestionAttachmentBlobs, putQuestionAttachmentBlob } from "../questionAttachments";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { MEDIA_BUCKET, clearCloudMediaUploadCache, uploadCloudMedia } from "./cloudMedia";

const objects = new Map<string, Blob>();
const defaultUpload = async (path: string, blob: Blob) => {
  if (objects.has(path)) return { error: { statusCode: "409" } };
  objects.set(path, blob);
  return { error: null };
};
const upload = vi.fn(defaultUpload);
const download = vi.fn(async (path: string) => ({ data: objects.get(path), error: null }));
const client = { storage: { from: (bucket: string) => {
  expect(bucket).toBe(MEDIA_BUCKET);
  return { upload, download };
} } } as unknown as SupabaseClient;
const guard = vi.fn(async () => undefined);

async function fixture(count: number): Promise<{ state: NoctyriumState; keys: string[]; hashes: string[] }> {
  const state = makeSeed();
  const at = "2026-11-02T00:00:00.000Z";
  const keys: string[] = [];
  const hashes: string[] = [];
  const attachments = [];
  for (let index = 0; index < count; index += 1) {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, index + 1])], { type: "image/png" });
    const blobKey = `image-${crypto.randomUUID()}`;
    const attachment = { id: blobKey, blobKey, fileName: `${index}.png`, mimeType: "image/png" as const,
      byteSize: blob.size, altText: "Source figure", createdAt: at, updatedAt: at };
    await putQuestionAttachmentBlob(blobKey, { ...attachment, questionId: "q1", blob });
    keys.push(blobKey);
    hashes.push(await sha256(new Uint8Array(await blob.arrayBuffer())));
    attachments.push(attachment);
  }
  state.questions = [{ id: "q1", stem: "Source figure", options: [{ key: "A", text: "A" }], source: "manual",
    correctKey: "A", status: "unseen", tags: [], attempts: [], notes: "", attachments, createdAt: at, updatedAt: at }];
  state.documents = [];
  return { state, keys, hashes };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  clearCloudMediaUploadCache();
  objects.clear(); upload.mockReset(); upload.mockImplementation(defaultUpload); download.mockClear(); guard.mockClear();
});

describe("bounded account image uploads", () => {
  it("runs at most six transfers together and returns the original attachment order", async () => {
    const { state, keys, hashes } = await fixture(9);
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    upload.mockImplementation(async (path, blob) => {
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      objects.set(path, blob);
      active -= 1;
      return { error: null };
    });
    const pending = uploadCloudMedia(client, "owner", state, guard);
    await vi.waitFor(() => expect(active).toBe(6));
    release();
    const manifest = await pending;
    expect(peak).toBe(6);
    expect(upload).toHaveBeenCalledTimes(9);
    expect(manifest.map((entry) => entry.blobKey)).toEqual(keys);
    expect(manifest.map((entry) => entry.hash)).toEqual(hashes);
  });

  it("reuses only account-scoped successful uploads across a retry", async () => {
    const { state } = await fixture(2);
    await uploadCloudMedia(client, "owner", state, guard);
    expect(upload).toHaveBeenCalledTimes(2);
    await uploadCloudMedia(client, "owner", state, guard);
    expect(upload).toHaveBeenCalledTimes(2);
    await uploadCloudMedia(client, "another-owner", state, guard);
    expect(upload).toHaveBeenCalledTimes(4);
  });

  it("does not cache a conflicting object until its bytes match", async () => {
    const { state, hashes } = await fixture(1);
    const path = `owner/${hashes[0]}`;
    objects.set(path, new Blob(["wrong bytes"]));
    await expect(uploadCloudMedia(client, "owner", state, guard)).rejects.toThrow(/verified/);
    expect(upload).toHaveBeenCalledTimes(1);
    const exact = new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: "image/png" });
    objects.set(path, exact);
    await uploadCloudMedia(client, "owner", state, guard);
    expect(upload).toHaveBeenCalledTimes(2);
    await uploadCloudMedia(client, "owner", state, guard);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("never returns a protected image manifest while any source image is missing; exact restoration permits retry", async () => {
    const { state, keys, hashes } = await fixture(2);
    await deleteQuestionAttachmentBlobs([keys[0]]);
    // The second image may already have uploaded concurrently. The important
    // contract is that the complete protected-version manifest is not issued.
    await expect(uploadCloudMedia(client, "owner", state, guard))
      .rejects.toMatchObject({ failure: { kind: "rejected", rejection: "missing-image", status: 0 } });

    const original = new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: "image/png" });
    await putQuestionAttachmentBlob(keys[0], {
      questionId: "q1",
      blob: original,
      mimeType: "image/png",
      byteSize: original.size,
      updatedAt: state.questions[0].attachments![0].updatedAt,
    });
    const protectedManifest = await uploadCloudMedia(client, "owner", state, guard);
    expect(protectedManifest.map((entry) => entry.blobKey)).toEqual(keys);
    expect(protectedManifest.map((entry) => entry.hash)).toEqual(hashes);
    expect(upload.mock.calls.filter(([path]) => path.startsWith("owner/")).length).toBeLessThanOrEqual(2);
  });

  it("reports the first failed upload after a second in-flight upload fails", async () => {
    const { state, hashes } = await fixture(2);
    let releaseLater!: () => void;
    const later = new Promise<void>(resolve => { releaseLater = resolve; });
    upload.mockImplementation(async path => {
      if (path === `owner/${hashes[0]}`) return { error: { statusCode: "503" } };
      await later;
      return { error: { statusCode: "502" } };
    });
    const pending = uploadCloudMedia(client, "owner", state, guard);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    releaseLater();
    await expect(pending).rejects.toMatchObject({ statusCode: "503" });
  });

  it("fails closed when the account epoch changes during a blocked image upload, then writes only to the new account namespace", async () => {
    const { state, hashes } = await fixture(1);
    let signalStarted!: () => void;
    let releaseUpload!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const resume = new Promise<void>((resolve) => { releaseUpload = resolve; });
    upload.mockImplementation(async (path, blob) => {
      signalStarted();
      await resume;
      objects.set(path, blob);
      return { error: null };
    });
    let accountIsCurrent = true;
    const checkEpoch = vi.fn(async () => {
      if (!accountIsCurrent) throw new Error("synthetic account epoch changed");
    });

    const pending = uploadCloudMedia(client, "synthetic-owner-a", state, checkEpoch);
    await started;
    accountIsCurrent = false;
    releaseUpload();
    // Even though the bytes reached the first account bucket, the protected
    // revision must not be acknowledged after its owning session changed.
    await expect(pending).rejects.toThrow("synthetic account epoch changed");
    expect(objects.has(`synthetic-owner-a/${hashes[0]}`)).toBe(true);

    upload.mockImplementation(defaultUpload);
    const restored = await uploadCloudMedia(client, "synthetic-owner-b", state, guard);
    expect(restored).toHaveLength(1);
    expect(restored[0].hash).toBe(hashes[0]);
    expect(objects.has(`synthetic-owner-b/${hashes[0]}`)).toBe(true);
    expect(upload.mock.calls.map(([path]) => path)).toEqual([
      `synthetic-owner-a/${hashes[0]}`,
      `synthetic-owner-b/${hashes[0]}`,
    ]);
  });

  it("deduplicates concurrent identical attachment bytes while retaining both source references", async () => {
    const { state, keys, hashes } = await fixture(2);
    const sameBytes = new Uint8Array([137, 80, 78, 71, 1]);
    await putQuestionAttachmentBlob(keys[1], {
      questionId: "q1",
      blob: new Blob([sameBytes], { type: "image/png" }),
      mimeType: "image/png",
      byteSize: sameBytes.byteLength,
      updatedAt: state.questions[0].attachments![1].updatedAt,
    });

    const manifest = await uploadCloudMedia(client, "synthetic-owner", state, guard);
    expect(manifest.map((row) => row.blobKey)).toEqual(keys);
    expect(manifest.map((row) => row.hash)).toEqual([hashes[0], hashes[0]]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(objects.size).toBe(1);
    expect(objects.has(`synthetic-owner/${hashes[0]}`)).toBe(true);
  });

  it("rejects a 409 collision with a same-size but different image before permitting a repaired retry", async () => {
    const { state, hashes } = await fixture(1);
    const path = `synthetic-owner/${hashes[0]}`;
    const tampered = new Blob([new Uint8Array([137, 80, 78, 71, 2])], { type: "image/png" });
    expect(tampered.size).toBe(state.questions[0].attachments![0].byteSize);
    objects.set(path, tampered);

    await expect(uploadCloudMedia(client, "synthetic-owner", state, guard))
      .rejects.toThrow("An account image could not be verified.");
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(path);

    objects.set(path, new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: "image/png" }));
    const manifest = await uploadCloudMedia(client, "synthetic-owner", state, guard);
    expect(manifest.map((row) => row.hash)).toEqual(hashes);
    // A rejected collision never enters the successful upload cache.
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
