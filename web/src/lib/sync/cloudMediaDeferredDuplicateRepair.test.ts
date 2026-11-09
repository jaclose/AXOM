// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { deleteQuestionAttachmentBlobs, putQuestionAttachmentBlob } from "../questionAttachments";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { splitCloudContent } from "./cloudContent";
import { clearCloudMediaUploadCache, uploadCloudMedia } from "./cloudMedia";
import { deferContent } from "./deferredContent";

/**
 * Independent R14 deferred/private recovery gate.
 *
 * A lazily restored question may have an authenticated private cloud receipt
 * but no device-local Blob. When a different, newly added private attachment
 * has byte-for-byte identical contents, its verified immutable upload restores
 * the same account-private object. The retained deferred reference must not
 * become a permanently failed revision solely because its 404 happened while
 * the new copy was uploading.
 *
 * All accounts, IndexedDB entries and storage objects are synthetic. Never
 * contacts AXOM or any Supabase project.
 */
const OWNER = "synthetic-r14-deferred-owner";
const DATE = "2026-11-08T00:00:00.000Z";
const BYTES = new Uint8Array([137, 80, 78, 71, 82, 49, 52, 65, 88, 79, 77, 11, 22, 33]);
const remote = new Map<string, Blob>();
let concurrentMissing = false;
let first404 = false;
let uploadStarted: Promise<void> = Promise.resolve();
let saw404: Promise<void> = Promise.resolve();
let signalUpload: () => void = () => {};
let signal404: () => void = () => {};

const upload = vi.fn(async (path: string, blob: Blob) => {
  if (concurrentMissing) {
    signalUpload();
    await saw404;
  }
  if (remote.has(path)) return { error: { statusCode: "409" } };
  remote.set(path, blob);
  return { error: null };
});
const download = vi.fn(async (path: string) => {
  if (concurrentMissing && !first404) {
    first404 = true;
    // Deterministically deliver the old 404 while the fresh private upload
    // has started but before its immutable object becomes visible.
    await uploadStarted;
    signal404();
    return { data: null, error: { statusCode: "404", message: "missing original" } };
  }
  const data = remote.get(path) ?? null;
  return { data, error: data ? null : { statusCode: "404", message: "missing original" } };
});
const client = { storage: { from: () => ({ upload, download }) } } as unknown as SupabaseClient;
const assertCurrent = async () => {};

async function deferredFixture(): Promise<{
  state: NoctyriumState;
  hash: string;
  oldKey: string;
}> {
  const state = makeSeed();
  state.documents = [];
  const oldKey = "r14-deferred-old-" + crypto.randomUUID();
  const originalBlob = new Blob([BYTES], { type: "image/png" });
  const original = {
    id: "r14-original-question",
    source: "manual" as const,
    stem: "A protected question remains deferred after a cloud reload.",
    options: [{ key: "A", text: "A" }],
    correctKey: "A",
    status: "unseen" as const,
    tags: [],
    attempts: [],
    notes: "",
    attachments: [{
      id: "r14-original-image",
      blobKey: oldKey,
      fileName: "same.png",
      mimeType: "image/png" as const,
      byteSize: originalBlob.size,
      altText: "Original image",
      createdAt: DATE,
      updatedAt: DATE,
    }],
    createdAt: DATE,
    updatedAt: DATE,
  };
  state.questions = [original];
  await putQuestionAttachmentBlob(oldKey, {
    questionId: original.id,
    blob: originalBlob,
    mimeType: "image/png",
    byteSize: originalBlob.size,
    updatedAt: DATE,
  });
  const protectedOriginal = await uploadCloudMedia(client, OWNER, state, assertCurrent);
  expect(protectedOriginal).toHaveLength(1);
  // Produce a legitimate lazy source checkpoint, not an invented media receipt.
  const split = await splitCloudContent(state);
  const deferred = deferContent(split.workspace, OWNER, split.references, protectedOriginal);
  expect(deferred.questions).toHaveLength(0);
  expect(deferred.deferredContent?.questions).toHaveLength(1);
  expect(deferred.deferredContent?.media).toEqual(protectedOriginal);

  // The original is now available only via its authenticated account receipt.
  await deleteQuestionAttachmentBlobs([oldKey]);
  const newKey = "r14-current-new-" + crypto.randomUUID();
  const newBlob = new Blob([BYTES], { type: "image/png" });
  deferred.questions.push({
    ...original,
    id: "r14-new-local-question",
    stem: "Another locally created question contains exactly the same image bytes.",
    attachments: [{
      ...original.attachments[0],
      id: "r14-new-local-image",
      blobKey: newKey,
    }],
  });
  await putQuestionAttachmentBlob(newKey, {
    questionId: "r14-new-local-question",
    blob: newBlob,
    mimeType: "image/png",
    byteSize: newBlob.size,
    updatedAt: DATE,
  });
  clearCloudMediaUploadCache(); // Reloaded device starts with no remembered success.
  return { state: deferred, hash: await sha256(BYTES), oldKey };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  clearCloudMediaUploadCache();
  remote.clear();
  // Each negative control changes mock behavior; call-history clearing alone leaks
  // a previous test's 403/corruption response into the next fixture setup.
  upload.mockReset();
  download.mockReset();
  concurrentMissing = false;
  first404 = false;
  uploadStarted = Promise.resolve();
  saw404 = Promise.resolve();
  signalUpload = () => {};
  signal404 = () => {};
});

describe("R14 deferred question with a separate same-byte private upload", () => {
  it("preserves deferred and current references while the prior remote original remains readable", async () => {
    const { state, hash, oldKey } = await deferredFixture();
    const manifest = await uploadCloudMedia(client, OWNER, state, assertCurrent, state.deferredContent!.media);
    expect(manifest).toHaveLength(2);
    expect(new Set(manifest.map(entry => entry.blobKey)).size).toBe(2);
    expect(manifest.some(entry => entry.blobKey === oldKey)).toBe(true);
    expect(manifest.every(entry => entry.hash === hash && !entry.academic)).toBe(true);
    expect(new Uint8Array(await remote.get(OWNER + "/" + hash)!.arrayBuffer())).toEqual(BYTES);
  });

  it("does not abandon a deferred 404 when a concurrent verified private duplicate restores its exact bytes", async () => {
    const { state, hash, oldKey } = await deferredFixture();
    remote.delete(OWNER + "/" + hash);
    uploadStarted = new Promise<void>(resolve => { signalUpload = resolve; });
    saw404 = new Promise<void>(resolve => { signal404 = resolve; });
    concurrentMissing = true;

    const manifest = await uploadCloudMedia(client, OWNER, state, assertCurrent, state.deferredContent!.media);
    expect(first404).toBe(true);
    expect(manifest).toHaveLength(2);
    expect(manifest.some(entry => entry.blobKey === oldKey)).toBe(true);
    expect(manifest.every(entry => entry.hash === hash && !entry.academic)).toBe(true);
    // Receipt may be accepted only after the now-present account object is
    // downloaded and byte-verified. No cross-account or academic shortcuts.
    expect(new Uint8Array(await remote.get(OWNER + "/" + hash)!.arrayBuffer())).toEqual(BYTES);
    expect(download.mock.calls.length).toBeGreaterThanOrEqual(3);
  }, 10_000);
});

/** R15 independent negative controls for the newly introduced deferred-404 retry.
 * A matching private hash may be retried only after verified same-account bytes.
 * RLS denial, different bytes, and corrupted upload receipts stay fail-closed.
 */
describe("R15 deferred missing-original repair fail-closed boundaries", () => {
  it("refuses a forbidden 403 private original even with a same-byte local candidate", async () => {
    const { state, hash } = await deferredFixture();
    remote.delete(OWNER + "/" + hash);
    // A 403 is not a missing object; no same-hash receipt may promote it.
    download.mockImplementation(async (_path: string) => ({
      data: null, error: { statusCode: "403", message: "synthetic RLS denied" },
    }));
    await expect(uploadCloudMedia(client, OWNER, state, assertCurrent, state.deferredContent!.media))
      .rejects.toThrow(/could not be verified/i);
  });

  it("does not use a newly verified but different SHA to heal the deferred old 404", async () => {
    const { state, hash } = await deferredFixture();
    remote.delete(OWNER + "/" + hash);
    const newQuestion = state.questions[0];
    const newKey = newQuestion.attachments![0].blobKey;
    const different = new Uint8Array(BYTES);
    different[different.length - 1] ^= 1; // same byte count, different SHA-256
    await deleteQuestionAttachmentBlobs([newKey]);
    await putQuestionAttachmentBlob(newKey, {
      questionId: newQuestion.id, blob: new Blob([different], { type: "image/png" }),
      mimeType: "image/png", byteSize: different.length, updatedAt: DATE,
    });
    await expect(uploadCloudMedia(client, OWNER, state, assertCurrent, state.deferredContent!.media))
      .rejects.toThrow(/missing from cloud storage/i);
    expect(remote.has(OWNER + "/" + hash)).toBe(false);
  });

  it("rejects an acknowledged same-byte upload when readback has same-size corruption", async () => {
    const { state, hash } = await deferredFixture();
    remote.delete(OWNER + "/" + hash);
    upload.mockImplementation(async (path: string, _blob: Blob) => {
      const corrupted = new Uint8Array(BYTES);
      corrupted[corrupted.length - 1] ^= 1; // same size, SHA mismatch
      remote.set(path, new Blob([corrupted], { type: "image/png" }));
      return { error: null };
    });
    await expect(uploadCloudMedia(client, OWNER, state, assertCurrent, state.deferredContent!.media))
      .rejects.toThrow(/failed its integrity check/i);
    expect(remote.has(OWNER + "/" + hash)).toBe(true);
    expect(download.mock.calls.length).toBeGreaterThan(0);
  });
});


/**
 * R17 independently probes races not exercised by the R15 negatives:
 * a new account epoch invalidating a readback and a conflicting immutable
 * upload whose stored bytes differ despite the 409 acknowledgement.
 * Everything stays within synthetic, device-local fixtures.
 */
describe("R17 concurrent private recovery account and 409 boundaries", () => {
  it("fails closed when the account epoch changes during fresh remote readback", async () => {
    const { state, hash } = await deferredFixture();
    remote.delete(OWNER + "/" + hash);
    let currentEpoch = 1;
    let sawRestoredReadback = false;
    download.mockImplementation(async (path: string) => {
      const data = remote.get(path) ?? null;
      if (data) {
        sawRestoredReadback = true;
        currentEpoch = 2; // Simulate sign-out or identity handoff while bytes travel.
      }
      return { data, error: data ? null : { statusCode: "404", message: "missing original" } };
    });
    const assertSameEpoch = async () => {
      if (currentEpoch !== 1) throw new Error("synthetic account epoch changed");
    };
    await expect(uploadCloudMedia(client, OWNER, state, assertSameEpoch, state.deferredContent!.media))
      .rejects.toThrow(/account epoch changed/i);
    expect(sawRestoredReadback).toBe(true);
  });

  it("rejects a concurrent 409 receipt when its remote bytes have a different SHA", async () => {
    const { state, hash } = await deferredFixture();
    remote.delete(OWNER + "/" + hash);
    const corrupt = new Uint8Array(BYTES);
    corrupt[corrupt.length - 1] ^= 1; // Equal length, different SHA.
    uploadStarted = new Promise<void>(resolve => { signalUpload = resolve; });
    saw404 = new Promise<void>(resolve => { signal404 = resolve; });
    concurrentMissing = true;
    upload.mockImplementation(async (path: string, _blob: Blob) => {
      signalUpload();
      await saw404;
      remote.set(path, new Blob([corrupt], { type: "image/png" }));
      return { error: { statusCode: "409", message: "synthetic immutable conflict" } };
    });
    await expect(uploadCloudMedia(client, OWNER, state, assertCurrent, state.deferredContent!.media))
      .rejects.toThrow(/failed its integrity check/i);
    expect(first404).toBe(true);
    expect(new Uint8Array(await remote.get(OWNER + "/" + hash)!.arrayBuffer())).toEqual(corrupt);
  }, 10_000);
});


/**
 * Independent R19 positive/negative counterbalance to R17: a legitimate
 * immutable conflict is recoverable only after exact stored-byte proof,
 * and an earlier verified receipt cannot make a subsequent network outage
 * look protected. The client and both accounts remain entirely synthetic.
 */
describe("R19 immutable 409 and stale-receipt network boundaries", () => {
  it("accepts a concurrent 409 only when the recovered private original matches SHA-256 byte for byte", async () => {
    const { state, hash, oldKey } = await deferredFixture();
    remote.delete(OWNER + "/" + hash);
    uploadStarted = new Promise<void>(resolve => { signalUpload = resolve; });
    saw404 = new Promise<void>(resolve => { signal404 = resolve; });
    concurrentMissing = true;
    upload.mockImplementation(async (path: string, _blob: Blob) => {
      signalUpload();
      await saw404;
      // Simulate another same-account writer winning the immutable-object
      // race with the EXACT original, not a trusting 409-only shortcut.
      remote.set(path, new Blob([BYTES], { type: "image/png" }));
      return { error: { statusCode: "409", message: "already exists" } };
    });

    const manifest = await uploadCloudMedia(client, OWNER, state, assertCurrent, state.deferredContent!.media);
    expect(first404).toBe(true);
    expect(manifest).toHaveLength(2);
    expect(manifest.some(entry => entry.blobKey === oldKey && entry.hash === hash)).toBe(true);
    expect(manifest.every(entry => entry.hash === hash && !entry.academic)).toBe(true);
    expect(download.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(new Uint8Array(await remote.get(OWNER + "/" + hash)!.arrayBuffer())).toEqual(BYTES);
  }, 10_000);

  it("does not reuse a previously verified private image when a later readback returns transient 503", async () => {
    const { state, hash } = await deferredFixture();
    const previous = await uploadCloudMedia(client, OWNER, state, assertCurrent, state.deferredContent!.media);
    expect(previous).toHaveLength(2);
    expect(remote.has(OWNER + "/" + hash)).toBe(true);
    download.mockClear();
    download.mockImplementation(async (_path: string) => ({
      data: null, error: { statusCode: "503", message: "upstream temporarily unavailable" },
    }));
    await expect(uploadCloudMedia(client, OWNER, state, assertCurrent, previous))
      .rejects.toThrow(/could not be verified/i);
    expect(download).toHaveBeenCalled();
    // No destructive recovery, overwrite, or fabricated certifying bytes.
    expect(new Uint8Array(await remote.get(OWNER + "/" + hash)!.arrayBuffer())).toEqual(BYTES);
  });
});
