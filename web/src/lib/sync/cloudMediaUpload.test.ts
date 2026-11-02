// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { putQuestionAttachmentBlob } from "../questionAttachments";
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
});
