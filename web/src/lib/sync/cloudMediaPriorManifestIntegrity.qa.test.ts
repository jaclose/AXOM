// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../compressedText";
import { deleteQuestionAttachmentBlobs, putQuestionAttachmentBlob } from "../questionAttachments";
import { makeSeed } from "../seed";
import { MEDIA_BUCKET, clearCloudMediaUploadCache, uploadCloudMedia } from "./cloudMedia";

/**
 * Independent QA RED acceptance. Synthetic account, bytes and cloud storage only.
 * A previously verified image manifest is not proof that the referenced object
 * is still restorable. Never certify a new protected version if BOTH local and
 * remote source image bytes have disappeared.
 */
const objects = new Map<string, Blob>();
const upload = vi.fn(async (path: string, blob: Blob) => {
  objects.set(path, blob);
  return { error: null };
});
const download = vi.fn(async (path: string) => ({
  data: objects.get(path) ?? null,
  error: objects.has(path) ? null : { statusCode: "404" },
}));
const client = { storage: { from: (bucket: string) => {
  expect(bucket).toBe(MEDIA_BUCKET);
  return { upload, download };
} } } as unknown as SupabaseClient;

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  objects.clear();
  upload.mockClear();
  download.mockClear();
  clearCloudMediaUploadCache();
});

describe("independent QA: prior image manifest must not conceal remote loss", () => {
  it("rejects protection when the previous image object and local original are both missing", async () => {
    const at = "2026-11-10T00:00:00.000Z";
    const owner = "synthetic-prior-manifest-owner";
    const state = makeSeed();
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 123, 45])], { type: "image/png" });
    const blobKey = `qa-prior-image-${crypto.randomUUID()}`;
    const attachment = {
      id: blobKey, blobKey, fileName: "qa.png", mimeType: "image/png" as const,
      byteSize: blob.size, altText: "Synthetic original", createdAt: at, updatedAt: at,
    };
    await putQuestionAttachmentBlob(blobKey, { ...attachment, questionId: "qa-question", blob });
    state.questions = [{
      id: "qa-question", stem: "Synthetic source", options: [{ key: "A", text: "A" }],
      source: "manual", correctKey: "A", status: "unseen", tags: [],
      attempts: [], notes: "", attachments: [attachment], createdAt: at, updatedAt: at,
    }];
    state.documents = [];

    const guard = vi.fn(async () => undefined);
    const originalManifest = await uploadCloudMedia(client, owner, state, guard);
    const hash = await sha256(new Uint8Array(await blob.arrayBuffer()));
    expect(originalManifest).toHaveLength(1);
    expect(originalManifest[0].hash).toBe(hash);
    expect(objects.has(`${owner}/${hash}`)).toBe(true);

    // Simulated out-of-band object loss, plus lost local device bytes. Never
    // mutate real Supabase buckets, account records, or protected images.
    objects.delete(`${owner}/${hash}`);
    await deleteQuestionAttachmentBlobs([blobKey]);
    clearCloudMediaUploadCache();

    // Current candidate reuses matching blobKey/size/updatedAt without checking
    // either source; this assertion should be RED until fail-closed repair.
    await expect(uploadCloudMedia(client, owner, state, guard, originalManifest))
      .rejects.toThrow(/image|missing|verify|protected|restor/i);
  });
});
