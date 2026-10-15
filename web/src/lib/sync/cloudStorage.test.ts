// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compressText, decompressText, sha256 } from "../compressedText";
import { workspaceDigest } from "./workspaceDigest";
import { makeSeed } from "../seed";
import { deleteQuestionAttachmentBlobs, getQuestionAttachmentBlob, putQuestionAttachmentBlob } from "../questionAttachments";
import { snapshotWorkspace } from "./workspaceSnapshot";
import { prepareCloudSnapshot, decodeCloudSnapshot } from "./cloudSnapshot";
import { CONTENT_BUCKET, clearCloudContentCache, hydrateCloudContent, splitCloudContent, uploadCloudContent } from "./cloudContent";
import { MEDIA_BUCKET, uploadCloudMedia, validateWorkspaceMedia, workspaceMedia } from "./cloudMedia";
import { installCloudMediaCache, saveCloudMediaIndex } from "./cloudMediaCache";
import type { NoctyriumState } from "../types";
import { deferContent } from "./deferredContent";
import { materializeState, retainDownloadedContent } from "./contentDownloads";
import { parseImport } from "../backup";

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
  it("opens a verified metadata checkpoint without source I/O, then downloads one selected question with its learner state", async () => {
    const original = fixture();
    const envelope = await prepareCloudSnapshot(await snapshotWorkspace(original, { accountUserId: "account-a", deviceId: "d", baseRevision: 0, reason: "manual" }));
    await uploadCloudContent(client, "account-a", envelope.contentObjects!, [], guard);
    clearCloudContentCache(); download.mockClear();
    const decoded = await decodeCloudSnapshot(envelope.packed);
    const deferred = deferContent(decoded.payload, "account-a", decoded.sources!, []);
    expect(deferred.questions).toEqual([]);
    expect(deferred.documents).toEqual([]);
    expect(download).not.toHaveBeenCalled();
    const reopened = parseImport(JSON.stringify(deferred));
    expect(reopened.deferredContent).toEqual(deferred.deferredContent);
    const unchanged = await prepareCloudSnapshot(await snapshotWorkspace(deferred, { accountUserId: "account-a", deviceId: "d", baseRevision: 1, reason: "automatic" }));
    expect(unchanged.contentHash).toBe(envelope.contentHash);
    expect(unchanged.contentObjects).toEqual([]);
    const selected = await materializeState(deferred, { questionIds: ["q1"] });
    expect(download).toHaveBeenCalledTimes(1);
    expect(selected.questions).toEqual(original.questions);
    expect(selected.documents).toEqual([]);
    expect(selected.deferredContent?.documents).toHaveLength(1);
    const next = await prepareCloudSnapshot(await snapshotWorkspace(selected, { accountUserId: "account-a", deviceId: "d", baseRevision: 1, reason: "automatic" }));
    expect(next.contentHash).toBe(envelope.contentHash);
    const complete = await materializeState(selected);
    expect(complete.questions).toEqual(original.questions);
    expect(complete.documents).toEqual(original.documents);
    expect(complete.deferredContent).toBeUndefined();
  });

  it("keeps references through failure, denies another account, and keeps private source caches account-bound", async () => {
    const original = fixture();
    const split = await splitCloudContent(original);
    await uploadCloudContent(client, "account-a", split.objects, [], guard);
    clearCloudContentCache();
    const deferred = deferContent(split.workspace, "account-a", split.references, []);
    operation.current = { client, userId: "account-b", assertCurrent: guard };
    await expect(materializeState(deferred)).rejects.toThrow(/Sign in to the account/);
    operation.current = { client, userId: "account-a", assertCurrent: guard };
    await materializeState(deferred);
    operation.current = { client, userId: "account-b", assertCurrent: guard };
    const other = deferContent(split.workspace, "account-b", split.references, []);
    await expect(materializeState(other)).rejects.toThrow(/downloaded or verified/);
    expect(deferred.deferredContent?.sources).toEqual(split.references);
  });

  it("retains local source bytes when remote notes change, without fetching or overriding the remote learner overlay", async () => {
    const original = fixture();
    const edited = { ...original, questions: [{ ...original.questions[0], notes: "Saved on phone" }] };
    const split = await splitCloudContent(edited);
    const remote = deferContent(split.workspace, "account-a", split.references, []);
    download.mockClear();
    const retained = await retainDownloadedContent(remote, original);
    expect(retained.questions).toEqual(edited.questions);
    expect(retained.documents).toEqual(edited.documents);
    expect(retained.deferredContent).toBeUndefined();
    expect(download).not.toHaveBeenCalled();
  });

  it("keeps bootstrap bytes bounded when source text grows a hundredfold", async () => {
    const state = fixture();
    async function size(value: NoctyriumState) {
      const prepared = await prepareCloudSnapshot(await snapshotWorkspace(value, { deviceId: "d", baseRevision: 0, reason: "manual" }));
      return prepared.payloadBytes;
    }
    const before = await size(state);
    const after = await size({ ...state, documents: [{ ...state.documents[0], rawText: state.documents[0].rawText.repeat(100) }] });
    expect(Math.abs(after - before)).toBeLessThan(20);
  });
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
    expect((await workspaceDigest(restored)).hash).toBe(envelope.contentHash);
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

  it("reconstructs one checksum-addressed object for two question-local references on a fresh device", async () => {
    const state = fixture();
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 4, 5, 6])], { type: "image/png" });
    const hash = await sha256(new Uint8Array(await blob.arrayBuffer()));
    const blobKey = `private-library:sha256:${hash}`;
    const first = {
      id: "source-page-one", assetId: "source-page-one", blobKey,
      fileName: "shared-source-page.png", mimeType: "image/png" as const,
      byteSize: blob.size, altText: "Shared source page", role: "question" as const,
      createdAt: state.questions[0].createdAt, updatedAt: state.questions[0].updatedAt,
    };
    const second = { ...first, id: "source-page-two", assetId: "source-page-two" };
    state.questions = [
      { ...state.questions[0], id: "q1", attachments: [first] },
      { ...state.questions[0], id: "q2", attachments: [second] },
    ];
    await putQuestionAttachmentBlob(blobKey, {
      blob, mimeType: "image/png", byteSize: blob.size,
      questionId: "q1", updatedAt: first.updatedAt,
    });

    expect(workspaceMedia(state).size).toBe(1);
    const manifest = await uploadCloudMedia(client, "account-a", state, guard);
    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({ blobKey, hash, byteSize: blob.size });
    expect(upload.mock.calls.filter(([bucket]) => bucket === MEDIA_BUCKET)).toHaveLength(1);

    await deleteQuestionAttachmentBlobs([blobKey]);
    await saveCloudMediaIndex("account-a", manifest);
    dispose = installCloudMediaCache("account-a", () => state);
    const restored = await getQuestionAttachmentBlob(blobKey);
    expect(await restored!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer());
    expect(restored!.questionId).toBe("q2");
    expect(state.questions.map(question => question.attachments?.[0])).toEqual([
      expect.objectContaining({ id: "source-page-one", assetId: "source-page-one", blobKey }),
      expect.objectContaining({ id: "source-page-two", assetId: "source-page-two", blobKey }),
    ]);
    expect(await getQuestionAttachmentBlob(blobKey)).toStrictEqual(restored);
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
