// @vitest-environment node
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceDocument } from "../library";
import { sha256Hex } from "../checksum";
import { saveSourceOriginal, readSourceOriginal, deleteSourceOriginal } from "../decode/sources";
import { readOriginalFile } from "../sourceOriginal";
import { ORIGINALS_BUCKET, downloadCloudOriginal, repairMissingCloudOriginals, uploadCloudOriginals } from "./cloudOriginals";
import { makeSeed } from "../seed";

const mock = vi.hoisted(() => ({
  blobs: new Map<string, Blob>(),
  resumableUploads: 0,
  resumed: false,
  failTus: false,
  pauseTus: false,
  aborted: 0,
  prior: [] as { uploadUrl?: string; creationTime?: string }[],
}));
vi.mock("tus-js-client", () => ({
  Upload: class {
    constructor(private blob: Blob, private options: {
      metadata: { objectName: string };
      onBeforeRequest: () => Promise<void>;
      onSuccess: () => void;
      onError: (error: Error) => void;
    }) {}
    async findPreviousUploads() { return mock.prior; }
    resumeFromPreviousUpload(_previous: { uploadUrl?: string }) { mock.resumed = true; }
    abort() { mock.aborted++; return Promise.resolve(); }
    start() {
      mock.resumableUploads += 1;
      void this.options.onBeforeRequest().then(() => {
        if (mock.pauseTus) return;
        if (mock.failTus) { this.options.onError(new Error("interrupted")); return; }
        mock.blobs.set(`${ORIGINALS_BUCKET}/${this.options.metadata.objectName}`, this.blob);
        this.options.onSuccess();
      }).catch(this.options.onError);
    }
  },
}));

const upload = vi.fn(async (bucket: string, path: string, blob: Blob) => {
  const key = `${bucket}/${path}`;
  if (mock.blobs.has(key)) return { error: { statusCode: "409" } };
  mock.blobs.set(key, blob);
  return { error: null };
});
const download = vi.fn(async (bucket: string, path: string) => {
  const data = mock.blobs.get(`${bucket}/${path}`) ?? null;
  return { data, error: data ? null : { statusCode: "404" } };
});
const info = vi.fn(async (bucket: string, path: string) => {
  const data = mock.blobs.get(`${bucket}/${path}`);
  return data ? { data: { size: data.size }, error: null }
    : { data: null, error: { statusCode: "404" } };
});
const client = { storage: { from: (bucket: string) => ({
  upload: (path: string, blob: Blob) => upload(bucket, path, blob),
  download: (path: string) => download(bucket, path),
  info: (path: string) => info(bucket, path),
}) } } as unknown as SupabaseClient;
const guard = vi.fn(async () => undefined);
const url = "https://example.storage.supabase.co/storage/v1/upload/resumable";
const resumable = { endpoint: url, headers: { authorization: "Bearer token", apikey: "public-key" } };

async function source(bytes: Blob, id = crypto.randomUUID()) {
  const checksum = await sha256Hex(await bytes.arrayBuffer());
  if (!checksum) throw new Error("SHA-256 unavailable in test environment");
  const doc: SourceDocument = {
    id, title: "Source", fileName: "source.pdf", fileType: "application/pdf", uploadedAt: "2026-10-14T00:00:00Z",
    sizeBytes: bytes.size, checksum, rawText: "", tags: [], linkedQuestionSetIds: [], libraryOnly: false,
    originalFile: { version: 1, sha256: checksum, byteSize: bytes.size, mimeType: "application/pdf" },
  };
  await saveSourceOriginal(doc, bytes);
  const state = makeSeed();
  state.documents = [doc];
  state.questions = [];
  return { doc, state };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  mock.blobs.clear(); mock.resumableUploads = 0; mock.resumed = false; mock.failTus = false; mock.pauseTus = false; mock.aborted = 0; mock.prior = [];
  guard.mockClear(); upload.mockClear(); download.mockClear(); info.mockClear();
});

describe("immutable private original-file cloud storage", () => {
  it("uploads once per account/hash, verifies server bytes and skips acknowledged originals on replay", async () => {
    const { doc, state } = await source(new Blob(["exact document bytes"], { type: "application/pdf" }));
    state.documents.push({ ...doc, id: crypto.randomUUID() });
    await uploadCloudOriginals(client, "owner", state, undefined, guard);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
    expect(mock.blobs.has(`${ORIGINALS_BUCKET}/owner/${doc.checksum}`)).toBe(true);
    await uploadCloudOriginals(client, "owner", state, JSON.stringify({ documents: state.documents }), guard);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge upload callbacks unless the object matches the original checksum", async () => {
    const { doc, state } = await source(new Blob(["private original"], { type: "application/pdf" }));
    mock.blobs.set(`${ORIGINALS_BUCKET}/owner/${doc.checksum}`, new Blob(["wrong checksum!!"]));
    await expect(uploadCloudOriginals(client, "owner", state, undefined, guard)).rejects.toThrow(/verified/);
    expect(await readSourceOriginal(doc.id, doc.checksum)).toBeInstanceOf(Blob);
    expect(upload).toHaveBeenCalledTimes(1); // SDK got a conflict, never overwrote
  });

  it("retains local bytes when upload fails and retries idempotently after a lost response", async () => {
    const { doc, state } = await source(new Blob(["original"], { type: "application/pdf" }));
    upload.mockImplementationOnce(async () => ({ error: { statusCode: "503" } }));
    await expect(uploadCloudOriginals(client, "owner", state, undefined, guard)).rejects.toMatchObject({ statusCode: "503" });
    expect(await readSourceOriginal(doc.id, doc.checksum)).toBeInstanceOf(Blob);
    mock.blobs.set(`${ORIGINALS_BUCKET}/owner/${doc.checksum}`, await readSourceOriginal(doc.id, doc.checksum) as Blob);
    await uploadCloudOriginals(client, "owner", state, undefined, guard);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("rejects forged and mismatched file identities before cloud IO", async () => {
    const { state } = await source(new Blob(["bytes"], { type: "application/pdf" }));
    state.documents[0].originalFile = { version: 1, sha256: "a".repeat(64), byteSize: 5, mimeType: "application/pdf" };
    expect(() => readOriginalFile(state.documents[0])).toThrow(/invalid identity/);
    await expect(uploadCloudOriginals(client, "owner", state, undefined, guard)).rejects.toThrow(/invalid identity/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("restores verified originals on a new device and refuses missing objects from another account", async () => {
    const { doc, state } = await source(new Blob(["persist across devices"], { type: "application/pdf" }));
    await uploadCloudOriginals(client, "owner", state, undefined, guard);
    await deleteSourceOriginal(doc.id);
    expect(await readSourceOriginal(doc.id, doc.checksum)).toBeUndefined();
    await expect(downloadCloudOriginal(client, "different-owner", doc, guard)).rejects.toThrow(/not available offline/);
    expect(await readSourceOriginal(doc.id, doc.checksum)).toBeUndefined();
    await downloadCloudOriginal(client, "owner", doc, guard);
    expect(await (await readSourceOriginal(doc.id, doc.checksum))?.text()).toBe("persist across devices");
  });

  it("uses resumable tus for larger originals, resumes only the same endpoint and can retry interruption", async () => {
    const bytes = new Blob([new Uint8Array(6 * 1024 * 1024 + 1)], { type: "application/pdf" });
    const { doc, state } = await source(bytes);
    mock.prior = [{ uploadUrl: "https://another-host.test/storage/v1/upload/resumable/forged" },
      { uploadUrl: url + "/safe-resume" }];
    mock.failTus = true;
    await expect(uploadCloudOriginals(client, "owner", state, undefined, guard, resumable)).rejects.toThrow(/interrupted/);
    expect(mock.resumableUploads).toBe(1);
    expect(mock.resumed).toBe(true);
    expect(await readSourceOriginal(doc.id, doc.checksum)).toBeInstanceOf(Blob);
    mock.failTus = false;
    await uploadCloudOriginals(client, "owner", state, undefined, guard, resumable);
    expect(mock.resumableUploads).toBe(2);
    expect(upload).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("ignores an expired resumable URL and starts a new upload under the original immutable key", async () => {
    const bytes = new Blob([new Uint8Array(6 * 1024 * 1024 + 1)], { type: "application/pdf" });
    const { doc, state } = await source(bytes);
    mock.prior = [{ uploadUrl: url + "/expired", creationTime: new Date(Date.now() - 25 * 60 * 60 * 1000).toString() }];
    await uploadCloudOriginals(client, "owner", state, undefined, guard, resumable);
    expect(mock.resumed).toBe(false);
    expect(mock.resumableUploads).toBe(1);
    expect(mock.blobs.has(`${ORIGINALS_BUCKET}/owner/${doc.checksum}`)).toBe(true);
  });

  it("cancels an in-flight resumable upload, preserving its local file and unfinished retry fingerprint", async () => {
    const bytes = new Blob([new Uint8Array(6 * 1024 * 1024 + 1)], { type: "application/pdf" });
    const { doc, state } = await source(bytes);
    const cancel = new AbortController();
    mock.pauseTus = true;
    const pending = uploadCloudOriginals(client, "owner", state, undefined, guard, resumable, cancel.signal);
    await vi.waitFor(() => expect(mock.resumableUploads).toBe(1));
    cancel.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.aborted).toBe(1);
    expect(await readSourceOriginal(doc.id, doc.checksum)).toBeInstanceOf(Blob);
    expect(mock.blobs.size).toBe(0);
  });

  it("repairs a vanished prior original only after an explicit server rejection", async () => {
    const { doc, state } = await source(new Blob(["exact prior bytes"], { type: "application/pdf" }));
    await uploadCloudOriginals(client, "owner", state, undefined, guard);
    const acknowledged = JSON.stringify({ documents: state.documents });
    const previousUploads = upload.mock.calls.length;
    await uploadCloudOriginals(client, "owner", state, acknowledged, guard);
    expect(upload).toHaveBeenCalledTimes(previousUploads);
    expect(info).not.toHaveBeenCalled(); // Ordinary cloud sync remains O(0) probes for prior originals.
    mock.blobs.delete(`${ORIGINALS_BUCKET}/owner/${doc.checksum}`);
    expect(await repairMissingCloudOriginals(client, "owner", state, guard)).toBe(1);
    expect(await (await mock.blobs.get(`${ORIGINALS_BUCKET}/owner/${doc.checksum}`))?.text()).toBe("exact prior bytes");
    expect(upload).toHaveBeenCalledTimes(previousUploads + 1);
    expect(await repairMissingCloudOriginals(client, "owner", state, guard)).toBe(0);
    expect(upload).toHaveBeenCalledTimes(previousUploads + 1);
  });

  it("repairs from an identical surviving local mirror if the older document's cache was cleared", async () => {
    const { doc, state } = await source(new Blob(["duplicated-source"], { type: "application/pdf" }));
    const alternate = { ...doc, id: crypto.randomUUID() };
    await saveSourceOriginal(alternate, await readSourceOriginal(doc.id, doc.checksum) as Blob);
    state.documents.push(alternate);
    await deleteSourceOriginal(doc.id);
    const repaired = await repairMissingCloudOriginals(client, "owner", state, guard);
    expect(repaired).toBe(1);
    expect(await (await mock.blobs.get(`${ORIGINALS_BUCKET}/owner/${doc.checksum}`))?.text()).toBe("duplicated-source");
  });

  it("refuses corrupted immutable metadata and non-404 Storage errors without overwriting anything", async () => {
    const { doc, state } = await source(new Blob(["verified-bytes"], { type: "application/pdf" }));
    mock.blobs.set(`${ORIGINALS_BUCKET}/owner/${doc.checksum}`, new Blob(["wrong size"]));
    await expect(repairMissingCloudOriginals(client, "owner", state, guard)).rejects.toThrow(/inconsistent server metadata/);
    expect(upload).not.toHaveBeenCalled();
    mock.blobs.delete(`${ORIGINALS_BUCKET}/owner/${doc.checksum}`);
    info.mockResolvedValueOnce({ data: null, error: { statusCode: "401" } });
    await expect(repairMissingCloudOriginals(client, "owner", state, guard)).rejects.toMatchObject({ statusCode: "401" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("preserves local work and refuses cloud success if the vanished original is not present on any device cache", async () => {
    const { doc, state } = await source(new Blob(["source-version"], { type: "application/pdf" }));
    await deleteSourceOriginal(doc.id);
    await expect(repairMissingCloudOriginals(client, "owner", state, guard)).rejects.toThrow(/verified backup/);
    expect(upload).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("refuses an expired operation guard without persisting or reporting success", async () => {
    const { state } = await source(new Blob(["guard"], { type: "application/pdf" }));
    guard.mockRejectedValueOnce(new Error("account switched"));
    await expect(uploadCloudOriginals(client, "owner", state, undefined, guard)).rejects.toThrow(/account switched/);
    expect(upload).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
});
