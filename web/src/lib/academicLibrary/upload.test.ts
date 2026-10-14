import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "../question-content/assets";
import { academicCollectionId, prepareAcademicUpload, uploadAcademicCourse, type AcademicUpload } from "./upload";

const tus = vi.hoisted(() => ({
  blobs: new Map<string, Blob>(),
  calls: 0,
  resumed: false,
  fail: false,
  prior: [] as { uploadUrl?: string }[],
}));
vi.mock("tus-js-client", () => ({
  Upload: class {
    constructor(private blob: Blob, private options: {
      metadata: { bucketName: string; objectName: string };
      onBeforeRequest: () => Promise<void>;
      onError: (error: Error) => void;
      onSuccess: () => void;
    }) {}
    async findPreviousUploads() { return tus.prior; }
    resumeFromPreviousUpload(_previous: { uploadUrl?: string }) { tus.resumed = true; }
    start() {
      tus.calls++;
      void this.options.onBeforeRequest().then(() => {
        if (tus.fail) { this.options.onError(new Error("interrupted")); return; }
        tus.blobs.set(`${this.options.metadata.bucketName}/${this.options.metadata.objectName}`, this.blob);
        this.options.onSuccess();
      }).catch(this.options.onError);
    }
  },
}));

const encode = (text: string) => new TextEncoder().encode(text);
async function fixture() {
  const bytes = encode("T1 - SAMPLE - Lectures:\nWeek 1:\nLecture 1 Sample [Lecture]");
  const catalog = { format: "axom-private-library", schemaVersion: 1, id: "sample-course", version: "1",
    attempts: ["private answer"], accountId: "private account",
    templates: [{ name: "plan.txt", file: "templates/plan.txt", checksum: (await sha256(bytes)).slice(7) }], sources: [] as object[] };
  const files = new Map([["catalog.json", encode(JSON.stringify(catalog))], ["templates/plan.txt", bytes]]);
  const read = async (path: string) => { const bytes = files.get(path); if (!bytes) throw new Error("Missing fixture"); return bytes; };
  return { read, files, catalog };
}

function mockedStorage(upload: AcademicUpload, collection: string) {
  const blobs = tus.blobs;
  const bucket = {
    upload: vi.fn(async (path: string, bytes: Uint8Array) => {
      const key = `academic-content/${path}`;
      if (blobs.has(key)) return { error: { statusCode: "409" } };
      blobs.set(key, new Blob([new Uint8Array(bytes)]));
      return { error: null };
    }),
    download: vi.fn(async (path: string) => {
      const data = blobs.get(`academic-content/${path}`) ?? null;
      return { data, error: data ? null : { statusCode: "404" } };
    }),
  };
  const receipt = { status: "ready", collection_id: collection, content_hash: upload.hash };
  const current = { current_revision_id: "revision" };
  const count = { count: upload.files.length, error: null };
  const rpc = vi.fn(async (method: string) => method === "academic_create_revision"
    ? { data: { collection_id: collection, revision_id: "revision" }, error: null }
    : { data: null, error: null });
  const from = vi.fn((table: string) => ({
    select: (_fields: string, options?: { head?: boolean }) => ({
      eq: (_field: string, _value: string) => options?.head
        ? Promise.resolve(count)
        : { single: async () => ({ data: table === "academic_revisions" ? receipt : current, error: null }) },
    }),
  }));
  const client = { rpc, from, storage: { from: () => bucket } } as unknown as SupabaseClient;
  return { client, bucket, rpc, from, receipt, current, count };
}
beforeEach(() => { tus.blobs.clear(); tus.calls = 0; tus.resumed = false; tus.fail = false; tus.prior = []; });

it("prepares only referenced academic files and omits unrelated learner fields", async () => {
  const f = await fixture(); f.files.set("private-backup.json", encode("private workspace"));
  const upload = await prepareAcademicUpload(f.read);
  expect(upload.metadata).toMatchObject({ module: "SAMPLE", term: "Term 1" });
  expect(upload.files.map(file => file.path)).toEqual(["catalog.json", "templates/plan.txt"]);
  expect(new TextDecoder().decode(upload.files[0].bytes)).not.toMatch(/attempts|accountId|private answer/);
  expect((await prepareAcademicUpload(f.read)).hash).toBe(upload.hash);
  expect(await academicCollectionId("account-a", upload.catalogId)).toBe(await academicCollectionId("account-a", upload.catalogId));
  expect(await academicCollectionId("account-b", upload.catalogId)).not.toBe(await academicCollectionId("account-a", upload.catalogId));
});

it("refuses altered source bytes before registering an upload", async () => {
  const f = await fixture(); f.files.set("templates/plan.txt", encode("changed"));
  await expect(prepareAcademicUpload(f.read)).rejects.toThrow("integrity");
});

it("cancels before registration without creating a remote revision or changing local prepared bytes", async () => {
  const upload = await prepareAcademicUpload((await fixture()).read);
  const backend = mockedStorage(upload, await academicCollectionId("account-a", upload.catalogId));
  const controller = new AbortController();
  controller.abort();
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}, undefined, controller.signal))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(backend.rpc).not.toHaveBeenCalled();
  expect(backend.bucket.upload).not.toHaveBeenCalled();
  expect(upload.files.length).toBeGreaterThan(0);
});

it("verifies full server readback and active revision counts, including lost responses", async () => {
  const upload = await prepareAcademicUpload((await fixture()).read);
  const collection = await academicCollectionId("account-a", upload.catalogId);
  const backend = mockedStorage(upload, collection);
  // A successful upload and a lost-response/409 replay are indistinguishable
  // until the client hashes the downloaded server bytes.
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .resolves.toMatchObject({ revision_id: "revision" });
  expect(backend.rpc).toHaveBeenLastCalledWith("academic_finish_revision", { revision: "revision" });
  expect(backend.bucket.download).toHaveBeenCalledTimes(upload.files.length);
  backend.bucket.upload.mockClear();
  await uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {});
  expect(backend.bucket.upload).toHaveBeenCalledTimes(upload.files.length);
  backend.count.count = upload.files.length - 1;
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/file count/);
});

it("does not mark a revision complete if its actual bytes differ or its active status is wrong", async () => {
  const upload = await prepareAcademicUpload((await fixture()).read);
  const collection = await academicCollectionId("account-a", upload.catalogId);
  const backend = mockedStorage(upload, collection);
  backend.bucket.download.mockResolvedValue({ data: new Blob(["wrong bytes"]), error: null });
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/corrupted/);
  expect(backend.rpc).toHaveBeenCalledTimes(1);
  backend.bucket.download.mockRestore();
  backend.bucket.download.mockImplementation(async (path: string) => ({ data: tus.blobs.get(`academic-content/${path}`) ?? null, error: null }));
  backend.receipt.status = "uploading";
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/server revision/);
  backend.receipt.status = "ready";
  backend.current.current_revision_id = "newer-revision";
  const notice = vi.fn();
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, notice))
    .resolves.toMatchObject({
      collection_id: collection, revision_id: "revision", active_revision_id: "newer-revision", status: "superseded",
    });
  expect(notice).toHaveBeenCalledWith(expect.stringMatching(/newer course revision remains active/));
});

it("preserves source provenance and explicit local-only exceptions above the 50 MiB collection-original limit", async () => {
  const f = await fixture();
  const large = new Uint8Array(50 * 1024 * 1024 + 1);
  large[0] = 37; large[1] = 80; large[2] = 68; large[3] = 70;
  const checksum = (await sha256(large)).slice(7);
  f.catalog.sources.push({ id: "oversize-original", name: "original.pdf", sourcePath: "original.pdf", checksum,
    status: "reference/template-only", reason: "Retain source provenance",
    originalFile: "sources/original.pdf", ready: 0, review: 0 });
  f.files.set("sources/original.pdf", large);
  f.files.set("catalog.json", encode(JSON.stringify(f.catalog)));
  const upload = await prepareAcademicUpload(f.read);
  expect(upload.localOnlyOriginals).toEqual([{
    sourceId: "oversize-original", sha256: checksum, byteSize: large.length, reason: "over-limit",
  }]);
  expect(upload.metadata.local_only_originals).toBe(1);
  expect(upload.provenance.sourceChecksums).toContain(checksum);
  expect(upload.files.some(file => file.path === "sources/original.pdf")).toBe(false);
  const savedCatalog = JSON.parse(new TextDecoder().decode(upload.files.find(file => file.path === "catalog.json")!.bytes));
  expect(savedCatalog.sources[0].checksum).toBe(checksum);
  expect(savedCatalog.sources[0].originalFile).toBeUndefined();
  expect(savedCatalog.sources[0].reason).toMatch(/remains local-only/);
});

it("prepares a referenced original larger than 6 MiB and uploads it with resumable tus", async () => {
  const f = await fixture();
  const large = new Uint8Array(6 * 1024 * 1024 + 1);
  large[0] = 37; large[1] = 80; large[2] = 68; large[3] = 70;
  const hash = (await sha256(large)).slice(7);
  f.catalog.sources.push({ id: "big-source", name: "big.pdf", sourcePath: "big.pdf", checksum: hash,
    module: "SAMPLE", status: "reference/template-only", reason: "Original provided for review",
    originalFile: "sources/big.pdf", ready: 0, review: 0 });
  f.files.set("sources/big.pdf", large);
  f.files.set("catalog.json", encode(JSON.stringify(f.catalog)));
  const upload = await prepareAcademicUpload(f.read);
  expect(upload.files.some(file => file.byte_size > 6 * 1024 * 1024)).toBe(true);
  const backend = mockedStorage(upload, await academicCollectionId("account-a", upload.catalogId));
  const resumable = { endpoint: "https://example.storage.supabase.co/storage/v1/upload/resumable", headers: { authorization: "Bearer test" } };
  tus.prior = [{ uploadUrl: resumable.endpoint + "/resume" }];
  await uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}, resumable);
  expect(tus.calls).toBe(1);
  expect(tus.resumed).toBe(true);
  expect(backend.bucket.download).toHaveBeenCalledTimes(upload.files.length);
  // Server readback, not the tus callback, decides whether a retry can pass.
  tus.fail = true;
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}, resumable))
    .resolves.toMatchObject({ revision_id: "revision" });
  tus.blobs.delete(`academic-content/${await academicCollectionId("account-a", upload.catalogId)}/${hash}`);
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}, resumable))
    .rejects.toThrow(/resumable course upload was interrupted/);
});
