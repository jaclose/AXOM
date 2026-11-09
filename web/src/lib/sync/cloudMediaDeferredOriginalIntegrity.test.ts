// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { clearCloudMediaUploadCache, MEDIA_BUCKET, uploadCloudMedia } from "./cloudMedia";

/**
 * Independent synthetic acceptance for deferred question figures.
 * Deferred source metadata can retain an image manifest even when the
 * question body and its attachment metadata have not been downloaded.
 * It must not be possible to certify a new protected workspace from that
 * historical manifest without checking the current account's original.
 *
 * Only in-memory storage is used: no production sessions, credentials,
 * learner questions, uploaded files, remote mutation, or account switching.
 */
const AT = "2026-11-08T00:00:00.000Z";
const expectedBytes = new Uint8Array([137, 80, 78, 71, 101, 102, 103]);
const tamperedBytes = new Uint8Array([137, 80, 78, 71, 101, 102, 104]);
const originals = new Map<string, Blob>();

const upload = vi.fn(async () => ({ error: { statusCode: "403", message: "No local media should be uploaded" } }));
const download = vi.fn(async (path: string) => {
  const data = originals.get(path);
  return { data: data ?? null, error: data ? null : { statusCode: "404", message: "Synthetic original not found" } };
});
const client = { storage: { from: (bucket: string) => {
  if (bucket !== MEDIA_BUCKET) throw new Error("Unexpected storage bucket");
  return { upload, download };
} } } as unknown as SupabaseClient;
const assertCurrent = async () => {};

async function deferredFixture(accountId = "synthetic-current-owner") {
  const hash = await sha256(expectedBytes);
  const image = { blobKey: "synthetic-deferred-image", hash, byteSize: expectedBytes.byteLength, updatedAt: AT };
  const state = makeSeed();
  state.questions = [];
  state.documents = [];
  state.deferredContent = {
    accountId,
    // The actual question fields/attachments are intentionally not on device.
    questions: [{ id: "synthetic-deferred-question" }],
    documents: [],
    sources: [{ collection: "questions", id: "synthetic-deferred-question", hash: "a".repeat(64),
      byteSize: 1, expandedBytes: 1 }],
    media: [image],
  };
  return { state: state as NoctyriumState, image, hash };
}

beforeEach(() => {
  originals.clear();
  upload.mockClear();
  download.mockClear();
  clearCloudMediaUploadCache();
});

describe("deferred question-image manifest requires current account remote-byte authority", () => {
  it("preserves a complete deferred manifest when the exact remote original exists", async () => {
    const { state, image, hash } = await deferredFixture();
    originals.set("synthetic-current-owner/" + hash, new Blob([expectedBytes], { type: "image/png" }));
    const manifest = await uploadCloudMedia(client, "synthetic-current-owner", state, assertCurrent);
    expect(manifest).toEqual([image]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not certify a deferred image whose remote original has disappeared", async () => {
    const { state } = await deferredFixture();
    await expect(uploadCloudMedia(client, "synthetic-current-owner", state, assertCurrent))
      .rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not certify a deferred image when the remote original has same-size changed bytes", async () => {
    const { state, hash } = await deferredFixture();
    expect(tamperedBytes.byteLength).toBe(expectedBytes.byteLength);
    originals.set("synthetic-current-owner/" + hash, new Blob([tamperedBytes], { type: "image/png" }));
    await expect(uploadCloudMedia(client, "synthetic-current-owner", state, assertCurrent))
      .rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });

  it("never treats another account's intact original as current-account protection", async () => {
    const { state, hash } = await deferredFixture("synthetic-previous-owner");
    originals.set("synthetic-previous-owner/" + hash, new Blob([expectedBytes], { type: "image/png" }));
    await expect(uploadCloudMedia(client, "synthetic-current-owner", state, assertCurrent))
      .rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });
});
