// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, compressText, decompressText, sha256 } from "../compressedText";
import { makeSeed } from "../seed";
import { getQuestionAttachmentBlob, putQuestionAttachmentBlob } from "../questionAttachments";
import { snapshotWorkspace } from "./workspaceSnapshot";
import { prepareCloudSnapshot, decodeCloudSnapshot } from "./cloudSnapshot";
import { CONTENT_BUCKET, clearCloudContentCache, hydrateCloudContent, splitCloudContent, uploadCloudContent } from "./cloudContent";
import { MEDIA_BUCKET, uploadCloudMedia, validateWorkspaceMedia } from "./cloudMedia";
import { installCloudMediaCache, saveCloudMediaIndex } from "./cloudMediaCache";
import type { NoctyriumState } from "../types";

const operation = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../account/supabase", () => ({ accountOperationClient: async () => operation.current }));
const objects = new Map<string, Blob>();
const upload = vi.fn(async (bucket: string, path: string, blob: Blob) => {
  const key = `${bucket}/${path}`;
  if (objects.has(key)) return { error: { statusCode: "409" } };
  objects.set(key, blob);
  return { error: null };
});
const download = vi.fn(async (bucket: string, path: string) => ({ data: objects.get(`${bucket}/${path}`), error: null }));
const client = { storage: { from: (bucket: string) => ({ upload: (path: string, blob: Blob) => upload(bucket, path, blob), download: (path: string) => download(bucket, path) }) } } as unknown as SupabaseClient;
const guard = vi.fn(async () => undefined);
let dispose: (() => void) | undefined;

function fixture(): NoctyriumState {
  const state = makeSeed();
  state.questions = [{ id: "q1", stem: "Source question", options: [{ key: "A", text: "Answer" }], source: "manual", correctKey: "A", status: "unseen", tags: [], attempts: [], notes: "Private learner note", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }];
  state.documents = [{ id: "source1", title: "Source", fileName: "source.txt", fileType: "text/plain", uploadedAt: "2026-10-01T00:00:00.000Z", sizeBytes: 180000, rawText: "Source material. ".repeat(10000), tags: [], linkedQuestionSetIds: [], libraryOnly: false }];
  return state;
}
beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  objects.clear(); upload.mockClear(); download.mockClear(); guard.mockClear();
  operation.current = { client, userId: "account-a", assertCurrent: guard };
});
afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllGlobals(); });

describe("private cloud content and media", () => {
  it("round-trips a source graph, keeps learner notes private, and never reuploads unchanged source content on an answer", async () => {
    const state = fixture();
    const envelope = await snapshotWorkspace(state, { deviceId: "device", baseRevision: 0, reason: "manual" });
    const prepared = await prepareCloudSnapshot(envelope);
    expect(prepared.payloadBytes).toBeLessThan(envelope.payloadBytes / 5);
    expect(prepared.packed?.content).not.toContain("Source material");
    expect(prepared.contentObjects!.every((item) => !item.content.includes("Private learner note"))).toBe(true);
    await uploadCloudContent(client, "account-a", prepared.contentObjects!, [], guard);
    clearCloudContentCache();
    const decoded = await decodeCloudSnapshot(prepared.packed);
    expect(decoded.payload.questions[0].notes).toBe("Private learner note");
    expect(decoded.payload.documents[0].rawText).toBeUndefined();
    const restored = await hydrateCloudContent(client, "account-a", decoded.payload, decoded.sources, guard);
    expect(restored).toEqual(state);
    expect(await sha256(new TextEncoder().encode(canonicalJson(restored)))).toBe(envelope.contentHash);
    const count = upload.mock.calls.length;
    const changed = { ...state, questions: [{ ...state.questions[0], userAnswerKey: "A", notes: "A new private note" }] };
    const split = await splitCloudContent(changed);
    await uploadCloudContent(client, "account-a", split.objects, prepared.packed!.sources, guard);
    expect(upload).toHaveBeenCalledTimes(count);
  });

  it("rejects corrupt source bytes and expansion bombs before returning a workspace", async () => {
    const state = fixture();
    const split = await splitCloudContent(state);
    await uploadCloudContent(client, "account-a", split.objects, [], guard);
    const ref = split.objects[0].reference;
    clearCloudContentCache();
    objects.set(`${CONTENT_BUCKET}/account-a/${ref.hash}`, new Blob(["damaged"]));
    await expect(hydrateCloudContent(client, "account-a", split.workspace, split.objects.map((item) => item.reference), guard)).rejects.toThrow(/verified/);
    const packed = await compressText("x".repeat(100_000));
    await expect(decompressText(packed, 1000)).rejects.toThrow(/safe restore size/);
    expect(await decompressText('{"legacy":true}')).toBe('{"legacy":true}');
  });

  it("uploads identical image bytes once, lazily downloads on another device, then reads offline cache", async () => {
    const state = fixture();
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: "image/png" });
    const attachment = { id: "image-1", blobKey: `upload-${crypto.randomUUID()}`, fileName: "figure.png", mimeType: "image/png" as const, byteSize: blob.size, altText: "Figure", createdAt: state.questions[0].createdAt, updatedAt: state.questions[0].updatedAt };
    const twin = { ...attachment, id: "image-2", blobKey: `${attachment.blobKey}-twin` };
    state.questions[0].attachments = [attachment, twin];
    await putQuestionAttachmentBlob(attachment.blobKey, { ...attachment, questionId: "q1", blob });
    await putQuestionAttachmentBlob(twin.blobKey, { ...twin, questionId: "q1", blob });
    const manifest = await uploadCloudMedia(client, "account-a", state, guard);
    expect(upload.mock.calls.filter(([bucket]) => bucket === MEDIA_BUCKET)).toHaveLength(1);
    expect(manifest[0].hash).toBe(manifest[1].hash);
    // A fresh device has canonical metadata and the verified cloud index, but no bytes.
    const restoredKey = `fresh-${crypto.randomUUID()}`;
    const restored = { ...attachment, blobKey: restoredKey };
    state.questions[0].attachments = [restored];
    await saveCloudMediaIndex("account-a", [{ ...manifest[0], blobKey: restoredKey }]);
    dispose = installCloudMediaCache("account-a", () => state);
    expect(download).not.toHaveBeenCalled();
    expect(await (await getQuestionAttachmentBlob(restoredKey))!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer());
    expect(download).toHaveBeenCalledTimes(1);
    dispose(); dispose = undefined;
    expect(await (await getQuestionAttachmentBlob(restoredKey))!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer());
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("does not use another account's image index or download after sign-out", async () => {
    const state = fixture();
    const key = `isolated-${crypto.randomUUID()}`;
    state.questions[0].attachments = [{ id: key, blobKey: key, fileName: "a.png", mimeType: "image/png", byteSize: 7, altText: "Private", createdAt: state.questions[0].createdAt, updatedAt: state.questions[0].updatedAt }];
    await saveCloudMediaIndex("account-a", [{ blobKey: key, hash: "a".repeat(64), byteSize: 7, updatedAt: state.questions[0].updatedAt }]);
    dispose = installCloudMediaCache("account-b", () => state);
    expect(await getQuestionAttachmentBlob(key)).toBeUndefined();
    expect(download).not.toHaveBeenCalled();
    dispose();
    dispose = installCloudMediaCache("account-a", () => state);
    operation.current = { client, userId: "account-b", assertCurrent: guard };
    expect(await getQuestionAttachmentBlob(key)).toBeUndefined();
    expect(download).not.toHaveBeenCalled();
  });
  it("refuses a protected version with a missing or mismatched image reference", () => {
    const state = fixture();
    const attachment = { id: "a", blobKey: "required-figure", fileName: "figure.png", mimeType: "image/png" as const, byteSize: 7, altText: "Figure", createdAt: state.questions[0].createdAt, updatedAt: state.questions[0].updatedAt };
    state.questions[0].attachments = [attachment];
    expect(() => validateWorkspaceMedia(state, [])).toThrow(/incomplete image index/);
    expect(() => validateWorkspaceMedia(state, [{ blobKey: attachment.blobKey, hash: "a".repeat(64), byteSize: 8, updatedAt: attachment.updatedAt }])).toThrow(/incomplete image index/);
    expect(validateWorkspaceMedia(state, [{ blobKey: attachment.blobKey, hash: "a".repeat(64), byteSize: 7, updatedAt: attachment.updatedAt }])).toHaveLength(1);
  });

});
