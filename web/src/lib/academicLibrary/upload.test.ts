import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "../question-content/assets";
import { academicAssetPath, assertAcademicFigureBudget, academicCollectionId, prepareAcademicUpload, uploadAcademicCourse, type AcademicUpload } from "./upload";

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

async function untemplatedBankFixture() {
  const f = await fixture();
  f.catalog.templates = [];
  const sourceHash = "a".repeat(64);
  const bank = { pkg: { manifest: {
    schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 },
    bank: { id: "example-goer-bank", title: "Demonstration questions", discipline: "Example" },
    source: { filename: "illustrative.txt", sourceWeekDeclared: false, axomAssignedWeek: 2 },
    questionsFile: "questions.json", assetsDirectory: "assets",
  }, questions: [{
    id: "synthetic-q1", source: { filename: "illustrative.txt", questionNumber: 1 },
    stem: [{ type: "text", text: "Which labeled item is first?" }],
    choices: [
      { id: "a", label: "A", blocks: [{ type: "text", text: "First choice" }] },
      { id: "b", label: "B", blocks: [{ type: "text", text: "Second choice" }] },
    ],
    correctAnswer: { labels: ["A"], evidence: "printed-key" },
    assets: [], provenance: { method: "authored", sourceChecksum: `sha256:${sourceHash}` },
  }] }, issues: [], sourceText: { rawText: "Synthetic educational fixture." }, sourceBytes: 30, notes: [] };
  f.catalog.sources.push({ id: "synthetic-source", name: "illustrative.txt",
    sourcePath: "illustrative.txt", checksum: sourceHash, module: "GOER",
    status: "prepared", reason: "Reviewed", ready: 1, review: 0,
    bankFile: "banks/sample/bank.json" });
  f.files.delete("templates/plan.txt");
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(bank)));
  f.files.set("catalog.json", encode(JSON.stringify(f.catalog)));
  return { ...f, bank };
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
  const rpc = vi.fn(async (method: string): Promise<{
    data: { collection_id: string; revision_id: string } | null;
    error: { code: string; message: string } | null;
  }> => method === "academic_create_revision"
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

it("maps figures for both root-level and nested prepared banks without malformed paths", () => {
  expect(academicAssetPath("bank.json", "figure.png")).toBe("assets/figure.png");
  expect(academicAssetPath("banks/week2/bank.json", "figure.png")).toBe("banks/week2/assets/figure.png");
  expect(() => academicAssetPath("bank.json", "../secret.png")).toThrow(/Unsafe/);
  expect(() => academicAssetPath("../bank.json", "figure.png")).toThrow(/Unsafe/);
});

it("enforces the local installer's per-question image count and aggregate byte budget", () => {
  const make = (count: number) => [{ assets: Array.from({ length: count }, (_, i) =>
    ({ filename: `figure-${i}.png`, checksum: "a".repeat(64) })) }];
  expect(() => assertAcademicFigureBudget(make(11))).toThrow(/10-figure attachment limit/);
  const four = make(4);
  const oversized = new Map(four[0].assets.map(asset => [asset.filename, 8 * 1024 * 1024]));
  expect(() => assertAcademicFigureBudget(four, oversized)).toThrow(/30 MiB total/);
  expect(() => assertAcademicFigureBudget(make(3), oversized)).not.toThrow();
});

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

it("accepts verified private question collections without fabricating an official weekly course plan", async () => {
  const f = await untemplatedBankFixture();
  const scope = { term: "Term 5", module: "GOER", title: "GOER — demonstration bank", evidence: "source-metadata" } as const;
  await expect(prepareAcademicUpload(f.read)).rejects.toThrow(/verified term, module/);
  const prepared = await prepareAcademicUpload(f.read, scope);
  expect(prepared.template).toBe("");
  expect(prepared.metadata).toMatchObject({
    term: "Term 5", module: "GOER", title: scope.title, ready_questions: 1, review_questions: 0,
  });
  expect(prepared.provenance).toMatchObject({ scopeEvidence: "source-metadata", weekAssignment: "unassigned" });
  expect(prepared.files.map(item => item.path)).toEqual(["banks/sample/bank.json", "catalog.json"]);
  expect((await prepareAcademicUpload(f.read, scope)).hash).toBe(prepared.hash);
  const bank = JSON.parse(new TextDecoder().decode(prepared.files[0].bytes));
  expect(bank.pkg.questions[0].id).toBe("synthetic-q1");
  expect(bank.pkg.manifest.source.sourceWeekDeclared).toBe(false);
  const accountId = "account-a";
  const backend = mockedStorage(prepared, await academicCollectionId(accountId, prepared.catalogId));
  await expect(uploadAcademicCourse(backend.client, accountId, prepared, () => {}, () => {}))
    .resolves.toMatchObject({ status: "active", revision_id: "revision" });
  expect(backend.rpc).toHaveBeenCalledWith("academic_create_revision", expect.objectContaining({
    metadata: expect.objectContaining({ term: "Term 5", ready_questions: 1 }),
    template: "", provenance: expect.objectContaining({ weekAssignment: "unassigned" }),
  }));
});

it("fails closed when a reviewed collection claims inflated ready or incorrect source SHA", async () => {
  const f = await untemplatedBankFixture();
  const scope = { term: "Term 5", module: "GOER", evidence: "human-reviewed" } as const;
  f.catalog.sources[0] = { ...(f.catalog.sources[0] as object), ready: 0, review: 1 };
  f.files.set("catalog.json", encode(JSON.stringify(f.catalog)));
  await expect(prepareAcademicUpload(f.read, scope)).rejects.toThrow(/claimed ready\/review counts differ/);
  f.catalog.sources[0] = { ...(f.catalog.sources[0] as object), ready: 1, review: 0 };
  f.bank.pkg.questions[0].provenance.sourceChecksum = "sha256:" + "b".repeat(64);
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  f.files.set("catalog.json", encode(JSON.stringify(f.catalog)));
  await expect(prepareAcademicUpload(f.read, scope)).rejects.toThrow(/different original source checksum/);
});

it("refuses a figure whose bytes do not match its declared image type", async () => {
  const f = await untemplatedBankFixture();
  const invalidPng = encode("not really a PNG image");
  const digest = await sha256(invalidPng);
  const question = f.bank.pkg.questions[0] as unknown as {
    assets: Array<Record<string, unknown>>;
    stem: Array<Record<string, unknown>>;
  };
  question.assets.push({ id: "fig-1", filename: "figure.png", mimeType: "image/png",
    role: "question", questionId: "synthetic-q1", checksum: digest });
  question.stem.push({ type: "image", assetId: "fig-1", role: "question", alt: "Diagram" });
  f.files.set("banks/sample/assets/figure.png", invalidPng);
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  await expect(prepareAcademicUpload(f.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  })).rejects.toThrow(/image content does not match/);
});

it("holds an otherwise valid figure that exceeds the installer 8 MiB attachment ceiling", async () => {
  const f = await untemplatedBankFixture();
  const largePng = new Uint8Array(8 * 1024 * 1024 + 1);
  const header = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXnkAAAAASUVORK5CYII=", "base64"));
  largePng.set(header);
  const digest = await sha256(largePng);
  const q = f.bank.pkg.questions[0] as unknown as { assets: Array<Record<string, unknown>>; stem: Array<Record<string, unknown>> };
  q.assets.push({ id: "oversize-png", filename: "large.png", mimeType: "image/png",
    role: "question", questionId: "synthetic-q1", checksum: digest });
  q.stem.push({ type: "image", assetId: "oversize-png", role: "question", alt: "One-pixel figure" });
  f.files.set("banks/sample/assets/large.png", largePng);
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  await expect(prepareAcademicUpload(f.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  })).rejects.toThrow(/8 MiB|8 MB|attachment limit/i);
});

it("rejects case-equivalent figure names with conflicting bytes before accepting cloud upload", async () => {
  const f = await untemplatedBankFixture();
  const p1 = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXnkAAAAASUVORK5CYII=", "base64"));
  const p2 = new Uint8Array(p1);
  p2[p2.length - 7] ^= 1;
  const q = f.bank.pkg.questions[0] as unknown as { assets: Array<Record<string, unknown>>; stem: Array<Record<string, unknown>> };
  for (const [index, filename, bytes] of [[1, "Sample.png", p1], [2, "sample.png", p2]] as const) {
    q.assets.push({ id: `fig-${index}`, filename, mimeType: "image/png",
      role: "question", questionId: "synthetic-q1", checksum: await sha256(bytes) });
    q.stem.push({ type: "image", assetId: `fig-${index}`, role: "question", alt: "Small figure" });
    f.files.set(`banks/sample/assets/${filename}`, bytes);
  }
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  await expect(prepareAcademicUpload(f.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  })).rejects.toThrow(/different images|collid|same name/i);
});

it("rejects a misleading ready count when the canonical importer cannot score a multiple-answer item", async () => {
  const f = await untemplatedBankFixture();
  f.bank.pkg.questions[0].correctAnswer.labels = ["A", "B"];
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  await expect(prepareAcademicUpload(f.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  })).rejects.toThrow(/canonical.*import|saveable|scored/i);
});

it("rejects same-set duplicate question numbers even if both printed answer keys look ready", async () => {
  const f = await untemplatedBankFixture();
  f.bank.pkg.questions.push({
    ...structuredClone(f.bank.pkg.questions[0]), id: "synthetic-q2",
  });
  (f.catalog.sources[0] as { ready: number }).ready = 2;
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  f.files.set("catalog.json", encode(JSON.stringify(f.catalog)));
  await expect(prepareAcademicUpload(f.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  })).rejects.toThrow(/canonical.*import|saveable|scored/i);
});

it("accepts a small genuine GIF because the learner's attachment installer supports it", async () => {
  const f = await untemplatedBankFixture();
  const gif = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
  const q = f.bank.pkg.questions[0] as unknown as { assets: Array<Record<string, unknown>>; stem: Array<Record<string, unknown>> };
  q.assets.push({ id: "gif-1", filename: "mini.gif", mimeType: "image/gif",
    role: "question", questionId: "synthetic-q1", checksum: await sha256(gif) });
  q.stem.push({ type: "image", assetId: "gif-1", role: "question", alt: "Tiny animated illustration" });
  f.files.set("banks/sample/assets/mini.gif", gif);
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  const uploaded = await prepareAcademicUpload(f.read, { term: "Term 5", module: "GOER", evidence: "human-reviewed" });
  expect(uploaded.files.find(file => file.path === "banks/sample/assets/mini.gif")).toMatchObject({
    mime_type: "image/gif", byte_size: gif.length,
  });
});

it("rejects a GIF upload with actionable guidance when the database migration is not installed", async () => {
  const f = await untemplatedBankFixture();
  const gif = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
  const question = f.bank.pkg.questions[0] as unknown as { assets: Array<Record<string, unknown>>; stem: Array<Record<string, unknown>> };
  question.assets.push({ id: "gif", filename: "figure.gif", mimeType: "image/gif",
    questionId: "synthetic-q1", role: "question", checksum: await sha256(gif) });
  question.stem.push({ type: "image", assetId: "gif", role: "question", alt: "GIF illustration" });
  f.files.set("banks/sample/assets/figure.gif", gif);
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  const prepared = await prepareAcademicUpload(f.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  });
  const backend = mockedStorage(prepared, await academicCollectionId("account-a", prepared.catalogId));
  backend.rpc.mockResolvedValueOnce({ data: null, error: {
    code: "23514", message: 'new row for relation "academic_files" violates check constraint "academic_files_mime_type_check"',
  } });
  await expect(uploadAcademicCourse(backend.client, "account-a", prepared, () => {}, () => {}))
    .rejects.toThrow(/has not enabled GIF figures/);
  expect(backend.bucket.upload).not.toHaveBeenCalled();
});

it("rejects duplicate source paths that claim different immutable hashes", async () => {
  const f = await fixture();
  const original = encode("verified synthetic source");
  const real = (await sha256(original)).slice(7);
  f.catalog.sources.push(
    { id: "source-a", name: "source.txt", sourcePath: "source.txt", checksum: real,
      status: "reference/template-only", reason: "Reference", ready: 0, review: 0,
      originalFile: "sources/source.txt" },
    { id: "source-b", name: "source.txt", sourcePath: "source.txt", checksum: "f".repeat(64),
      status: "reference/template-only", reason: "Conflicting identity", ready: 0, review: 0,
      originalFile: "sources/source.txt" },
  );
  f.files.set("sources/source.txt", original);
  f.files.set("catalog.json", encode(JSON.stringify(f.catalog)));
  await expect(prepareAcademicUpload(f.read)).rejects.toThrow(/Conflicting immutable files share/);
});

it("verifies repeated source-path bytes rather than trusting an earlier identical checksum declaration", async () => {
  const f = await fixture();
  const source = encode("Synthetic source with stable immutable content");
  const sha = (await sha256(source)).slice(7);
  for (const id of ["source-one", "source-two"]) {
    f.catalog.sources.push({
      id, name: "shared.txt", sourcePath: "shared.txt", checksum: sha,
      status: "reference/template-only", reason: "One immutable shared original",
      originalFile: "sources/shared.txt", ready: 0, review: 0,
    });
  }
  f.files.set("sources/shared.txt", source);
  f.files.set("catalog.json", encode(JSON.stringify(f.catalog)));
  const stable = await prepareAcademicUpload(f.read);
  expect(stable.files.filter(file => file.path === "sources/shared.txt")).toHaveLength(1);

  let reads = 0;
  const changedReader = async (file: string) => file === "sources/shared.txt"
    ? ++reads === 1 ? source : encode("A different file returned for the same path")
    : f.read(file);
  await expect(prepareAcademicUpload(changedReader)).rejects
    .toThrow(/Conflicting immutable files share the same academic path/);
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
