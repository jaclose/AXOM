// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { putQuestionAttachmentBlob } from "../questionAttachments";
import { setQuestionAttachmentAccount } from "../questionAttachmentScope";
import { makeSeed } from "../seed";
import type { NoctyriumState } from "../types";
import { clearCloudMediaUploadCache, uploadCloudMedia } from "./cloudMedia";

/**
 * Independent R12 integration gate. Two distinct local blobKeys legitimately
 * have identical bytes, but only one carries a previous private cloud receipt.
 * The second attachment starts an immutable upload while the first observes a
 * missing remote original. A failed 404 memo must not poison post-upload
 * verification or produce a falsely protected image manifest.
 *
 * All accounts and remote objects here are synthetic; never contacts Supabase.
 */
const OWNER = "synthetic-r12-overlap-owner";
const AT = "2026-11-08T00:00:00.000Z";
const BYTES = new Uint8Array([137, 80, 78, 71, 65, 88, 79, 77, 19, 38, 57, 76]);
const remote = new Map<string, Blob>();
let raceMode = false;
let firstMissingIssued = false;
let startedUpload: Promise<void> = Promise.resolve();
let missingObserved: Promise<void> = Promise.resolve();
let signalUpload: () => void = () => {};
let signalMissing: () => void = () => {};

const upload = vi.fn(async (path: string, blob: Blob) => {
  if (raceMode) {
    signalUpload();
    // Hold the new image's upload until the old receipt has observed 404.
    await missingObserved;
  }
  if (remote.has(path)) return { error: { statusCode: "409" } };
  remote.set(path, blob);
  return { error: null };
});
const download = vi.fn(async (path: string) => {
  if (raceMode && !firstMissingIssued) {
    firstMissingIssued = true;
    // The 404 must be read while a new-hash upload is already in flight.
    // This removes reliance on IndexedDB or worker scheduler timing.
    await startedUpload;
    signalMissing();
    return { data: null, error: { statusCode: "404", message: "missing original" } };
  }
  const data = remote.get(path) ?? null;
  return { data, error: data ? null : { statusCode: "404", message: "missing original" } };
});
const client = { storage: { from: () => ({ upload, download }) } } as unknown as SupabaseClient;
const guard = async () => {};

async function fixture(): Promise<{ state: NoctyriumState; hash: string }> {
  const state = makeSeed();
  const blob = new Blob([BYTES], { type: "image/png" });
  const originalKey = "r12-old-" + crypto.randomUUID();
  state.questions = [{
    id: "r12-original-question", source: "manual",
    stem: "A protected original has a retained private manifest.",
    options: [{ key: "A", text: "A" }], correctKey: "A", status: "unseen",
    tags: [], attempts: [], notes: "",
    attachments: [{
      id: "r12-original-image", blobKey: originalKey, fileName: "same.png",
      mimeType: "image/png", byteSize: blob.size, altText: "Original image",
      createdAt: AT, updatedAt: AT,
    }],
    createdAt: AT, updatedAt: AT,
  }];
  state.documents = [];
  await putQuestionAttachmentBlob(originalKey, {
    questionId: "r12-original-question", blob, mimeType: "image/png",
    byteSize: blob.size, updatedAt: AT,
  });
  return { state, hash: await sha256(BYTES) };
}

async function prependNewSameByteQuestion(state: NoctyriumState): Promise<void> {
  const first = state.questions[0];
  const secondKey = "r12-new-" + crypto.randomUUID();
  const newQuestion = {
    ...first,
    id: "r12-new-question",
    stem: "A new image uses the same bytes but has no prior cloud receipt.",
    attachments: [{
      ...first.attachments![0],
      id: "r12-new-image",
      blobKey: secondKey,
    }],
  };
  state.questions.unshift(newQuestion);
  const blob = new Blob([BYTES], { type: "image/png" });
  await putQuestionAttachmentBlob(secondKey, {
    questionId: "r12-new-question", blob, mimeType: "image/png",
    byteSize: blob.size, updatedAt: AT,
  });
}

beforeEach(() => {
  setQuestionAttachmentAccount(OWNER);
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  clearCloudMediaUploadCache();
  remote.clear(); upload.mockClear(); download.mockClear();
  raceMode = false; firstMissingIssued = false;
  startedUpload = Promise.resolve();
  missingObserved = Promise.resolve();
  signalUpload = () => {}; signalMissing = () => {};
});

describe("R12 mixed old/new private hash overlap", () => {
  it("retains both manifest entries when identical original bytes remain accessible", async () => {
    const { state, hash } = await fixture();
    const previous = await uploadCloudMedia(client, OWNER, state, guard);
    clearCloudMediaUploadCache();
    await prependNewSameByteQuestion(state);

    const protectedMedia = await uploadCloudMedia(client, OWNER, state, guard, previous);
    expect(protectedMedia).toHaveLength(2);
    expect(new Set(protectedMedia.map(entry => entry.blobKey)).size).toBe(2);
    expect(protectedMedia.every(entry => entry.hash === hash && !entry.academic)).toBe(true);
    expect(new Uint8Array(await remote.get(OWNER + "/" + hash)!.arrayBuffer())).toEqual(BYTES);
  });

  it("rechecks bytes and protects both references when an old 404 races a new same-hash upload", async () => {
    const { state, hash } = await fixture();
    const previous = await uploadCloudMedia(client, OWNER, state, guard);
    remote.delete(OWNER + "/" + hash);
    clearCloudMediaUploadCache(); // A reloaded page must not inherit success.
    await prependNewSameByteQuestion(state);

    startedUpload = new Promise<void>(resolve => { signalUpload = resolve; });
    missingObserved = new Promise<void>(resolve => { signalMissing = resolve; });
    raceMode = true;

    const protectedMedia = await uploadCloudMedia(client, OWNER, state, guard, previous);
    expect(firstMissingIssued).toBe(true);
    expect(protectedMedia).toHaveLength(2);
    expect(new Set(protectedMedia.map(entry => entry.blobKey)).size).toBe(2);
    expect(protectedMedia.every(entry => entry.hash === hash && !entry.academic)).toBe(true);
    expect(upload).toHaveBeenCalledTimes(2); // First protection + immutable repair.
    expect(download.mock.calls.length).toBeGreaterThanOrEqual(3); // Initial, 404, new byte proof.
    expect(new Uint8Array(await remote.get(OWNER + "/" + hash)!.arrayBuffer())).toEqual(BYTES);
  }, 10_000);
});
