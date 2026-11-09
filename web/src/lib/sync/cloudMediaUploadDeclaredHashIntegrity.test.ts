// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { putQuestionAttachmentBlob } from "../questionAttachments";
import { setQuestionAttachmentAccount } from "../questionAttachmentScope";
import { makeSeed } from "../seed";
import type { QuestionRecord } from "../questions";
import type { NoctyriumState } from "../types";
import { clearCloudMediaUploadCache, uploadCloudMedia } from "./cloudMedia";

/**
 * The push path must enforce a package's declared image checksum before
 * returning an image manifest. Restore-time validation alone cannot prevent
 * a cloud revision from being marked protected with the wrong source image.
 *
 * Synthetic local IndexedDB and mocked Supabase Storage only: no login,
 * production connection, network upload, or existing image mutation.
 */
const AT = "2026-11-02T00:00:00.000Z";
const bytes = new Uint8Array([137, 80, 78, 71, 31]);
const differentBytes = new Uint8Array([137, 80, 78, 71, 32]);
const remote = new Map<string, Blob>();
const upload = vi.fn(async (path: string, blob: Blob) => {
  remote.set(path, blob);
  return { error: null };
});
const download = vi.fn(async (path: string) => ({
  data: remote.get(path) ?? null,
  error: remote.has(path) ? null : { statusCode: "404", message: "Synthetic original is absent" },
}));
const client = { storage: { from: () => ({ upload, download }) } } as unknown as SupabaseClient;
const assertCurrent = async () => {};

async function fixture(declaredChecksum?: string): Promise<{
  state: NoctyriumState;
  actualHash: string;
  question: QuestionRecord;
}> {
  const state = makeSeed();
  const blobKey = `synthetic-declared-hash-${crypto.randomUUID()}`;
  const blob = new Blob([bytes], { type: "image/png" });
  const question: QuestionRecord = {
    id: "synthetic-source-figure",
    source: "manual",
    stem: "Keep the source figure exact.",
    options: [{ key: "A", text: "A" }, { key: "B", text: "B" }],
    correctKey: "A",
    status: "unseen",
    tags: [],
    attempts: [],
    notes: "",
    attachments: [{
      id: "synthetic-attachment", assetId: "asset-figure",
      blobKey, fileName: "figure.png", mimeType: "image/png",
      byteSize: bytes.byteLength, altText: "Source image",
      createdAt: AT, updatedAt: AT,
    }],
    content: {
      id: "synthetic-source-package",
      source: { filename: "synthetic-source.pdf" },
      stem: [{ type: "image", assetId: "asset-figure" }],
      choices: [],
      assets: [{
        id: "asset-figure",
        filename: "figure.png",
        mimeType: "image/png",
        role: "stem",
        questionId: "synthetic-source-package",
        ...(declaredChecksum ? { checksum: `sha256:${declaredChecksum}` } : {}),
      }],
      provenance: { method: "authored" },
    },
    createdAt: AT,
    updatedAt: AT,
  };
  state.questions = [question];
  state.documents = [];
  await putQuestionAttachmentBlob(blobKey, {
    questionId: question.id, blob, mimeType: "image/png",
    byteSize: blob.size, updatedAt: AT,
  });
  return { state, actualHash: await sha256(bytes), question };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  clearCloudMediaUploadCache();
  remote.clear();
  upload.mockClear();
  download.mockClear();
});

describe("source-declared checksums at cloud image push", () => {
  it("rejects an initial upload whose actual bytes contradict its declared source SHA-256", async () => {
    setQuestionAttachmentAccount("synthetic-owner-fresh");
    const wrongHash = await sha256(differentBytes);
    const { state, actualHash } = await fixture(wrongHash);
    expect(actualHash).not.toBe(wrongHash);
    await expect(uploadCloudMedia(client, "synthetic-owner-fresh", state, assertCurrent))
      .rejects.toThrow();
  });

  it("rejects reuse of an old manifest if the declared source hash changes without attachment timestamp changes", async () => {
    setQuestionAttachmentAccount("synthetic-owner-reuse");
    const actualHash = await sha256(bytes);
    const wrongHash = await sha256(differentBytes);
    const { state, question } = await fixture(actualHash);
    const protectedIndex = await uploadCloudMedia(client, "synthetic-owner-reuse", state, assertCurrent);
    expect(protectedIndex[0].hash).toBe(actualHash);
    if (!question.content) throw new Error("Missing synthetic source content");
    question.content.assets[0].checksum = `sha256:${wrongHash}`;
    await expect(uploadCloudMedia(client, "synthetic-owner-reuse", state, assertCurrent, protectedIndex))
      .rejects.toThrow();
  });

  it("accepts an exact matching source checksum and keeps the original hash", async () => {
    setQuestionAttachmentAccount("synthetic-owner-match");
    const hash = await sha256(bytes);
    const { state } = await fixture(hash);
    const manifest = await uploadCloudMedia(client, "synthetic-owner-match", state, assertCurrent);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].hash).toBe(hash);
    expect(download).toHaveBeenCalledWith(`synthetic-owner-match/${hash}`);
  });

  it("preserves legacy checksum-less source compatibility", async () => {
    setQuestionAttachmentAccount("synthetic-owner-legacy");
    const { state, actualHash } = await fixture();
    const manifest = await uploadCloudMedia(client, "synthetic-owner-legacy", state, assertCurrent);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].hash).toBe(actualHash);
  });
});
