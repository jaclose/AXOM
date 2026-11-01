import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "../question-content/assets";
import { academicAssetPath, assertAcademicFigureBudget, assertAcademicStoredFigureBudget, academicCollectionId, academicUploadHash, prepareAcademicUpload, uploadAcademicCourse, type AcademicUpload } from "./upload";
import { planPublication, publicationJobs, readPublicationInventory } from "./publication";
import { library } from "./publicationFixture.testing";

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

async function templateBackedBankFixture(template = "T5 - GOER - Lectures:\nWeek 1:\nLecture 1 Sample [Lecture]") {
  const f = await untemplatedBankFixture();
  const bytes = encode(template);
  f.catalog.templates = [{ name: "plan.txt", file: "templates/plan.txt", checksum: (await sha256(bytes)).slice(7) }];
  f.files.set("templates/plan.txt", bytes);
  f.files.set("catalog.json", encode(JSON.stringify(f.catalog)));
  return f;
}

function writeFixtureCatalog(f: Awaited<ReturnType<typeof untemplatedBankFixture>>) {
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  f.files.set("catalog.json", encode(JSON.stringify(f.catalog)));
}

function stubSuccessfulBrowserDecode(width = 1, height = 1) {
  const decode = vi.fn(async (_blob: Blob) => ({ width, height, close: vi.fn() }));
  vi.stubGlobal("createImageBitmap", decode);
  return decode;
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
afterEach(() => vi.unstubAllGlobals());

it("maps figures for both root-level and nested prepared banks without malformed paths", () => {
  expect(academicAssetPath("bank.json", "figure.png")).toBe("assets/figure.png");
  expect(academicAssetPath("banks/week2/bank.json", "figure.png")).toBe("banks/week2/assets/figure.png");
  expect(() => academicAssetPath("bank.json", "../secret.png")).toThrow(/Unsafe/);
  expect(() => academicAssetPath("../bank.json", "figure.png")).toThrow(/Unsafe/);
});

it("enforces the local installer's per-question image count and aggregate byte budget", () => {
  const make = (count: number) => [{ assets: Array.from({ length: count }, (_, i) =>
    ({ filename: `figure-${i}.png`, checksum: "a".repeat(64) })) }];
  expect(() => assertAcademicFigureBudget(make(10))).not.toThrow();
  expect(() => assertAcademicFigureBudget(make(11))).toThrow(/10-figure attachment limit/);
  expect(() => assertAcademicStoredFigureBudget(make(64))).not.toThrow();
  expect(() => assertAcademicStoredFigureBudget(make(65))).toThrow(/64-figure source limit/);
  const four = make(4);
  const oversized = new Map(four[0].assets.map(asset => [asset.filename, 8 * 1024 * 1024]));
  expect(() => assertAcademicFigureBudget(four, oversized)).toThrow(/30 MiB total/);
  expect(() => assertAcademicStoredFigureBudget(four, oversized)).toThrow(/30 MiB total/);
  expect(() => assertAcademicFigureBudget(make(3), oversized)).not.toThrow();
  expect(() => assertAcademicStoredFigureBudget(make(1), new Map([["figure-0.png", 8 * 1024 * 1024 + 1]]))).toThrow(/8 MiB/);
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
  expect(bank.pkg.manifest.course).toEqual({ name: "GOER", term: 5, week: 2 });
  expect(bank.reviewedFiling).toEqual({
    term: "Term 5", module: "GOER", evidence: "source-metadata", weekAssignment: "unassigned",
  });
  const accountId = "account-a";
  const backend = mockedStorage(prepared, await academicCollectionId(accountId, prepared.catalogId));
  await expect(uploadAcademicCourse(backend.client, accountId, prepared, () => {}, () => {}))
    .resolves.toMatchObject({ status: "active", revision_id: "revision" });
  expect(backend.rpc).toHaveBeenCalledWith("academic_create_revision", expect.objectContaining({
    metadata: expect.objectContaining({ term: "Term 5", ready_questions: 1 }),
    template: "", provenance: expect.objectContaining({ weekAssignment: "unassigned" }),
  }));
});

it("requires bank-specific human review to correct one stale source scope", async () => {
  const f = await untemplatedBankFixture();
  await expect(prepareAcademicUpload(f.read, {
    term: "Term 4", module: "FTCM", evidence: "source-metadata",
  })).rejects.toThrow(/catalog module does not match/);

  (f.catalog.sources[0] as { module: string }).module = "FTCM";
  writeFixtureCatalog(f);
  await expect(prepareAcademicUpload(f.read, {
    term: "Term 4", module: "FTCM", evidence: "human-reviewed",
  })).rejects.toThrow(/bank's reviewed filing does not match/);
  (f.bank as typeof f.bank & { reviewedFiling: object }).reviewedFiling = {
    term: "Term 4", module: "FTCM", evidence: "human-reviewed", weekAssignment: "unassigned",
  };
  writeFixtureCatalog(f);

  const corrected = await prepareAcademicUpload(f.read, {
    term: "Term 4", module: "FTCM", evidence: "human-reviewed",
  });
  const bank = JSON.parse(new TextDecoder().decode(
    corrected.files.find(file => file.path === "banks/sample/bank.json")!.bytes,
  ));
  expect(bank.reviewedFiling).toEqual({
    term: "Term 4", module: "FTCM", evidence: "human-reviewed", weekAssignment: "unassigned",
  });
  expect(bank.pkg.manifest.course).toEqual({ name: "GOER", term: 5, week: 2 });
  const backend = mockedStorage(corrected, await academicCollectionId("account-a", corrected.catalogId));
  await expect(uploadAcademicCourse(backend.client, "account-a", corrected, () => {}, () => {}))
    .resolves.toMatchObject({ status: "active" });
});

it("requires a bank-specific human review before a source-only Unfiled collection is prepared", async () => {
  const f = await untemplatedBankFixture();
  f.bank.pkg.manifest.course = { name: "Unfiled", term: 0, week: 0 };
  const question = f.bank.pkg.questions[0] as typeof f.bank.pkg.questions[0] & { course?: string; term?: number };
  question.course = "Unfiled";
  question.term = 0;
  const scope = { term: "Term 5", module: "GOER", evidence: "human-reviewed" } as const;
  writeFixtureCatalog(f);
  await expect(prepareAcademicUpload(f.read, scope)).rejects.toThrow(/own exact human-reviewed filing/);

  (f.bank as typeof f.bank & { reviewedFiling?: object }).reviewedFiling = {
    ...scope, weekAssignment: "unassigned",
  };
  writeFixtureCatalog(f);
  const prepared = await prepareAcademicUpload(f.read, scope);
  expect(prepared).toMatchObject({ template: "", metadata: { term: "Term 5", module: "GOER", ready_questions: 1 },
    provenance: { scopeEvidence: "human-reviewed" } });
  const backend = mockedStorage(prepared, await academicCollectionId("account-a", prepared.catalogId));
  await expect(uploadAcademicCourse(backend.client, "account-a", prepared, () => {}, () => {}))
    .resolves.toMatchObject({ status: "active" });
  const forged = { ...prepared, provenance: { ...prepared.provenance, scopeEvidence: undefined } };
  const rejected = mockedStorage(forged, await academicCollectionId("account-a", forged.catalogId));
  await expect(uploadAcademicCourse(rejected.client, "account-a", forged, () => {}, () => {}))
    .rejects.toThrow(/source-only direct upload needs/i);
  expect(rejected.rpc).not.toHaveBeenCalled();
});

it("preflights a mixed source-only course with separate bank-level filing evidence", async () => {
  const input = await library();
  const source = input.catalog.sources.find(item => item.name === "unfiled-pq.pdf")!;
  const bank = JSON.parse(new TextDecoder().decode(input.files.get(source.bankFile!)!));
  bank.pkg.questions[0].course = "Unfiled";
  bank.pkg.questions[0].term = 0;
  bank.reviewedFiling = { term: "Term 4", module: "NCRS", evidence: "human-reviewed", weekAssignment: "unassigned" };
  source.module = "NCRS";
  input.files.set(source.bankFile!, encode(JSON.stringify(bank)));
  input.files.set("catalog.json", encode(JSON.stringify(input.catalog)));
  const inventory = await readPublicationInventory(input.read);
  const course = planPublication(inventory).courses.find(item => item.term === "Term 4" && item.moduleKey === "ncrs")!;
  const prepared = await publicationJobs(input.read, inventory, [course]).jobs[0].prepare();
  const stored = (path: string) => JSON.parse(new TextDecoder().decode(prepared.files.find(file => file.path === path)!.bytes));
  const ordinarySource = input.catalog.sources.find(item => item.name === "ncrs-pq.pdf")!;
  expect(stored(ordinarySource.bankFile!).reviewedFiling.evidence).toBe("source-metadata");
  expect(stored(source.bankFile!).reviewedFiling.evidence).toBe("human-reviewed");
  const backend = mockedStorage(prepared, await academicCollectionId("account-a", prepared.catalogId));
  await expect(uploadAcademicCourse(backend.client, "account-a", prepared, () => {}, () => {}))
    .resolves.toMatchObject({ status: "active" });
});

it("rejects an incoming bank filing that conflicts with the source-only course", async () => {
  const f = await untemplatedBankFixture();
  (f.bank as typeof f.bank & { reviewedFiling: object }).reviewedFiling = {
    term: "Term 1", module: "MSK", evidence: "human-reviewed", weekAssignment: "unassigned",
  };
  writeFixtureCatalog(f);
  await expect(prepareAcademicUpload(f.read)).rejects.toThrow(/verified term, module/);
  await expect(prepareAcademicUpload(f.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  })).rejects.toThrow(/bank's reviewed filing does not match/);
});

it("proves a template owns every source, bank and question scope before it bypasses manual review", async () => {
  const valid = await templateBackedBankFixture();
  await expect(prepareAcademicUpload(valid.read)).resolves.toMatchObject({
    metadata: expect.objectContaining({ module: "GOER", term: "Term 5" }),
  });

  const sourceMismatch = await templateBackedBankFixture();
  (sourceMismatch.catalog.sources[0] as { module: string }).module = "NCRS";
  writeFixtureCatalog(sourceMismatch);
  await expect(prepareAcademicUpload(sourceMismatch.read)).rejects.toThrow(/source module.*course plan/i);

  const bankMismatch = await templateBackedBankFixture();
  bankMismatch.bank.pkg.manifest.course.name = "NCRS";
  writeFixtureCatalog(bankMismatch);
  await expect(prepareAcademicUpload(bankMismatch.read)).rejects.toThrow(/bank's module or term/i);

  const questionMismatch = await templateBackedBankFixture();
  (questionMismatch.bank.pkg.questions[0] as typeof questionMismatch.bank.pkg.questions[0] & { course: string }).course = "NCRS";
  writeFixtureCatalog(questionMismatch);
  await expect(prepareAcademicUpload(questionMismatch.read)).rejects.toThrow(/question's module or term/i);

  const termMismatch = await templateBackedBankFixture();
  termMismatch.bank.pkg.manifest.course.term = 4;
  writeFixtureCatalog(termMismatch);
  await expect(prepareAcademicUpload(termMismatch.read)).rejects.toThrow(/bank's module or term/i);

  const mixedContract = await templateBackedBankFixture();
  (mixedContract.bank as typeof mixedContract.bank & { reviewedFiling: object }).reviewedFiling = {
    term: "Term 5", module: "GOER", evidence: "human-reviewed", weekAssignment: "unassigned",
  };
  writeFixtureCatalog(mixedContract);
  await expect(prepareAcademicUpload(mixedContract.read)).rejects.toThrow(/cannot also carry a manual reviewed filing/i);
});

it("accepts only a human-reviewed uniform Unfiled bank matching its course plan", async () => {
  const f = await templateBackedBankFixture();
  f.bank.pkg.manifest.course = { name: "Unfiled", term: 0, week: 0 };
  const question = f.bank.pkg.questions[0] as typeof f.bank.pkg.questions[0] & { course?: string; term?: number };
  question.course = "Unfiled";
  question.term = 0;
  (f.bank as typeof f.bank & { reviewedFiling?: object }).reviewedFiling = {
    term: "Term 5", module: "GOER", evidence: "human-reviewed", weekAssignment: "unassigned",
  };
  writeFixtureCatalog(f);

  const prepared = await prepareAcademicUpload(f.read);
  const stored = JSON.parse(new TextDecoder().decode(prepared.files.find(file => file.path === "banks/sample/bank.json")!.bytes));
  expect(stored.reviewedFiling).toMatchObject({ term: "Term 5", module: "GOER", evidence: "human-reviewed" });
  expect(stored.pkg.manifest.course).toEqual({ name: "Unfiled", term: 0, week: 0 });
  expect(stored.pkg.questions[0]).toMatchObject({ course: "Unfiled", term: 0 });
  const backend = mockedStorage(prepared, await academicCollectionId("account-a", prepared.catalogId));
  await expect(uploadAcademicCourse(backend.client, "account-a", prepared, () => {}, () => {}))
    .resolves.toMatchObject({ status: "active" });

  (f.bank as typeof f.bank & { reviewedFiling?: object }).reviewedFiling = {
    term: "Term 4", module: "NCRS", evidence: "human-reviewed", weekAssignment: "unassigned",
  };
  writeFixtureCatalog(f);
  await expect(prepareAcademicUpload(f.read)).rejects.toThrow(/reviewed filing does not match its course plan/);
});

it("accepts a documented module alias but rejects an unowned original-only source", async () => {
  const alias = await templateBackedBankFixture("T2 - NB Block 2 - Lectures:\nWeek 1:\nLecture 1 Sample [Lecture]");
  (alias.catalog.sources[0] as { module: string }).module = "NB2";
  alias.bank.pkg.manifest.course = { name: "NB2", term: 2, week: 1 };
  writeFixtureCatalog(alias);
  await expect(prepareAcademicUpload(alias.read)).resolves.toMatchObject({
    metadata: expect.objectContaining({ module: "NB Block 2", term: "Term 2" }),
  });

  const unowned = await templateBackedBankFixture();
  const original = encode("synthetic original");
  unowned.catalog.sources.push({ id: "unowned", name: "unowned.txt", sourcePath: "unowned.txt",
    checksum: (await sha256(original)).slice(7), status: "reference/template-only", reason: "Synthetic",
    ready: 0, review: 0, originalFile: "sources/unowned.txt" });
  unowned.files.set("sources/unowned.txt", original);
  writeFixtureCatalog(unowned);
  await expect(prepareAcademicUpload(unowned.read)).rejects.toThrow(/must name the module owned/);
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

it("rejects package-declared image size or dimensions that disagree with decoded bytes", async () => {
  stubSuccessfulBrowserDecode();
  const f = await untemplatedBankFixture();
  const png = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXnkAAAAASUVORK5CYII=", "base64",
  ));
  const question = f.bank.pkg.questions[0] as unknown as {
    assets: Array<Record<string, unknown>>; stem: Array<Record<string, unknown>>;
  };
  question.assets.push({ id: "declared", filename: "declared.png", mimeType: "image/png",
    width: 2, height: 1, byteSize: png.length + 1,
    role: "question", questionId: "synthetic-q1", checksum: await sha256(png) });
  question.stem.push({ type: "image", assetId: "declared", role: "question", alt: "Declared figure" });
  f.files.set("banks/sample/assets/declared.png", png);
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  await expect(prepareAcademicUpload(f.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  })).rejects.toThrow(/declared MIME, byte-size or dimensions/);
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
  stubSuccessfulBrowserDecode();
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
  stubSuccessfulBrowserDecode();
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

it("rejects a header-only GIF with a matching SHA before registering any private course", async () => {
  const f = await untemplatedBankFixture();
  const complete = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
  const headerOnly = complete.subarray(0, 12);
  const q = f.bank.pkg.questions[0] as unknown as { assets: Array<Record<string, unknown>>; stem: Array<Record<string, unknown>> };
  q.assets.push({ id: "broken", filename: "header.gif", mimeType: "image/gif",
    role: "question", questionId: "synthetic-q1", checksum: await sha256(headerOnly) });
  q.stem.push({ type: "image", assetId: "broken", role: "question", alt: "Invalid header-only GIF" });
  f.files.set("banks/sample/assets/header.gif", headerOnly);
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  await expect(prepareAcademicUpload(f.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  })).rejects.toThrow(/truncated|fully decoded/);
});

it("guards direct upload calls against undecodable or SHA-mismatched GIFs before any cloud RPC", async () => {
  const upload = await prepareAcademicUpload((await fixture()).read);
  const tiny = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
  const bytes = tiny.subarray(0, 12);
  const asset = {
    path: "assets/figure.gif", sha256: (await sha256(bytes)).slice(7),
    byte_size: bytes.length, mime_type: "image/gif", bytes,
  };
  upload.files.push(asset);
  const backend = mockedStorage(upload, await academicCollectionId("account-a", upload.catalogId));
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/truncated|fully decoded/);
  expect(backend.rpc).not.toHaveBeenCalled();
  expect(backend.bucket.upload).not.toHaveBeenCalled();

  // A decodable GIF is still untrusted when its immutable manifest lies.
  asset.bytes = tiny;
  asset.byte_size = tiny.length;
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/SHA-256/);
  expect(backend.rpc).not.toHaveBeenCalled();
});

const truncatedPng = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXnkAAAAASUVORK5CYII=", "base64",
)).subarray(0, 24);
const sniffableWebp = new Uint8Array(30);
sniffableWebp.set(Buffer.from("RIFF"), 0);
sniffableWebp.set(Buffer.from("WEBP"), 8);
sniffableWebp.set(Buffer.from("VP8X"), 12);
const headerOnlyFormats = [
  { extension: "png", mime: "image/png", bytes: truncatedPng },
  { extension: "jpg", mime: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 1, 0, 1, 0]) },
  { extension: "webp", mime: "image/webp", bytes: sniffableWebp },
  { extension: "gif", mime: "image/gif", bytes: Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64")) },
] as const;

it.each(headerOnlyFormats)("does not prepare $mime for cloud if the browser rejects matching-header bytes", async ({ extension, mime, bytes }) => {
  const f = await untemplatedBankFixture();
  const question = f.bank.pkg.questions[0] as unknown as {
    assets: Array<Record<string, unknown>>; stem: Array<Record<string, unknown>>;
  };
  const filename = `figure.${extension}`;
  question.assets.push({ id: "image", filename, mimeType: mime, role: "question",
    questionId: "synthetic-q1", checksum: await sha256(bytes) });
  question.stem.push({ type: "image", assetId: "image", role: "question", alt: "Test figure" });
  f.files.set(`banks/sample/assets/${filename}`, bytes);
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  const decode = vi.fn(async (_blob: Blob) => { throw new Error("invalid browser image"); });
  vi.stubGlobal("window", {});
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal("Image", undefined);
  await expect(prepareAcademicUpload(f.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  })).rejects.toThrow(/fully decoded/);
  expect(decode).toHaveBeenCalledOnce();
});

it.each(headerOnlyFormats)("rechecks $mime decoded bytes on direct replay before creating any cloud revision", async ({ extension, mime, bytes }) => {
  const upload = await prepareAcademicUpload((await fixture()).read);
  upload.files.push({ path: `assets/replay.${extension}`, mime_type: mime,
    bytes, byte_size: bytes.length, sha256: (await sha256(bytes)).slice(7) });
  const backend = mockedStorage(upload, await academicCollectionId("account-a", upload.catalogId));
  const decode = vi.fn(async (_blob: Blob) => { throw new Error("undecodable on this browser"); });
  vi.stubGlobal("window", {});
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal("Image", undefined);
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/fully decoded/);
  expect(decode).toHaveBeenCalledOnce();
  expect(backend.rpc).not.toHaveBeenCalled();
  expect(backend.bucket.upload).not.toHaveBeenCalled();
});

it("rejects a direct-replay PNG whose bytes or MIME disagree with its immutable manifest", async () => {
  const upload = await prepareAcademicUpload((await fixture()).read);
  const asset = headerOnlyFormats[0];
  const preparedFile = {
    path: "assets/replay.png", mime_type: "image/png", bytes: asset.bytes,
    byte_size: asset.bytes.length, sha256: (await sha256(asset.bytes)).slice(7),
  };
  upload.files.push(preparedFile);
  const backend = mockedStorage(upload, await academicCollectionId("account-a", upload.catalogId));
  preparedFile.byte_size++;
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/byte size|SHA-256/);
  preparedFile.byte_size--;
  preparedFile.sha256 = "b".repeat(64);
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/SHA-256/);
  preparedFile.sha256 = (await sha256(asset.bytes)).slice(7);
  preparedFile.path = "assets/replay.jpg";
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/path.*MIME type/);
  expect(backend.rpc).not.toHaveBeenCalled();
});

it("revalidates package asset declarations on direct replay before any cloud RPC", async () => {
  stubSuccessfulBrowserDecode();
  const f = await untemplatedBankFixture();
  const png = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXnkAAAAASUVORK5CYII=", "base64",
  ));
  const question = f.bank.pkg.questions[0] as unknown as {
    assets: Array<Record<string, unknown>>; stem: Array<Record<string, unknown>>;
  };
  question.assets.push({ id: "replay", filename: "replay.png", mimeType: "image/png",
    role: "question", questionId: "synthetic-q1", checksum: await sha256(png) });
  question.stem.push({ type: "image", assetId: "replay", role: "question", alt: "Replay figure" });
  f.files.set("banks/sample/assets/replay.png", png);
  f.files.set("banks/sample/bank.json", encode(JSON.stringify(f.bank)));
  const upload = await prepareAcademicUpload(f.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  });
  const bankFile = upload.files.find(file => file.path === "banks/sample/bank.json")!;
  const bank = JSON.parse(new TextDecoder().decode(bankFile.bytes));
  bank.pkg.questions[0].assets[0].byteSize++;
  bankFile.bytes = encode(JSON.stringify(bank));
  bankFile.byte_size = bankFile.bytes.length;
  bankFile.sha256 = (await sha256(bankFile.bytes)).slice(7);
  const backend = mockedStorage(upload, await academicCollectionId("account-a", upload.catalogId));
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/declared MIME, byte-size or dimensions/);
  expect(backend.rpc).not.toHaveBeenCalled();
  expect(backend.bucket.upload).not.toHaveBeenCalled();
});

it("rejects unsafe, duplicate, oversized or noncanonical direct replay manifests before registration", async () => {
  const original = await prepareAcademicUpload((await fixture()).read);
  const backend = mockedStorage(original, await academicCollectionId("account-a", original.catalogId));
  const catalog = original.files.find(file => file.path === "catalog.json")!;

  const duplicate: AcademicUpload = { ...original, files: [...original.files, { ...catalog }] };
  await expect(uploadAcademicCourse(backend.client, "account-a", duplicate, () => {}, () => {}))
    .rejects.toThrow(/duplicate or case-conflicting/);

  const unsafe: AcademicUpload = { ...original, files: original.files.map(file => ({ ...file })) };
  unsafe.files[0].path = "../catalog.json";
  await expect(uploadAcademicCourse(backend.client, "account-a", unsafe, () => {}, () => {}))
    .rejects.toThrow(/unsafe/i);

  const tooMany: AcademicUpload = {
    ...original,
    files: Array.from({ length: 1501 }, (_, index) => ({ ...catalog, path: `files/${index}.json` })),
  };
  await expect(uploadAcademicCourse(backend.client, "account-a", tooMany, () => {}, () => {}))
    .rejects.toThrow(/1–1500/);

  const changedMetadata: AcademicUpload = { ...original, metadata: { ...original.metadata, title: "Mutated after preparation" } };
  await expect(uploadAcademicCourse(backend.client, "account-a", changedMetadata, () => {}, () => {}))
    .rejects.toThrow(/upload hash.*canonical/i);
  expect(backend.rpc).not.toHaveBeenCalled();
  expect(backend.bucket.upload).not.toHaveBeenCalled();
});

it("rejects duplicate source SHA claims before creating a cloud revision", async () => {
  const upload = await prepareAcademicUpload((await fixture()).read);
  const sourceSha = "a".repeat(64);
  const catalogFile = upload.files.find(file => file.path === "catalog.json")!;
  const catalog = JSON.parse(new TextDecoder().decode(catalogFile.bytes));
  catalog.sources = ["source-one", "source-two"].map(id => ({
    id, name: `${id}.txt`, sourcePath: `${id}.txt`, checksum: sourceSha,
    module: "SAMPLE", status: "reference/template-only", reason: "Synthetic reference",
    ready: 0, review: 0,
  }));
  catalogFile.bytes = encode(JSON.stringify(catalog));
  catalogFile.byte_size = catalogFile.bytes.length;
  catalogFile.sha256 = (await sha256(catalogFile.bytes)).slice(7);
  upload.provenance.sourceChecksums = [sourceSha, sourceSha];
  const backend = mockedStorage(upload, await academicCollectionId("account-a", upload.catalogId));

  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/duplicate source SHA/);
  expect(backend.rpc).not.toHaveBeenCalled();
  expect(backend.bucket.upload).not.toHaveBeenCalled();
});

it("surfaces the server owner/source identity conflict without uploading bytes", async () => {
  const upload = await prepareAcademicUpload((await fixture()).read);
  const backend = mockedStorage(upload, await academicCollectionId("account-a", upload.catalogId));
  backend.rpc.mockResolvedValueOnce({
    data: null,
    error: {
      code: "23505",
      message: "Academic source is already registered under another collection",
    },
  });

  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/already registered in another private academic collection/i);
  expect(backend.bucket.upload).not.toHaveBeenCalled();
});

it("rejects duplicate question identities across banks before creating a cloud revision", async () => {
  const fixtureData = await untemplatedBankFixture();
  const upload = await prepareAcademicUpload(fixtureData.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  });
  const catalogFile = upload.files.find(file => file.path === "catalog.json")!;
  const catalog = JSON.parse(new TextDecoder().decode(catalogFile.bytes));
  const firstBankFile = upload.files.find(file => file.path === "banks/sample/bank.json")!;
  const secondBank = JSON.parse(new TextDecoder().decode(firstBankFile.bytes));
  const secondSourceSha = "b".repeat(64);
  secondBank.pkg.manifest.bank.id = "second-bank";
  secondBank.pkg.questions[0].provenance.sourceChecksum = `sha256:${secondSourceSha}`;
  const secondBankBytes = encode(JSON.stringify(secondBank));
  upload.files.push({
    path: "banks/second/bank.json", bytes: secondBankBytes,
    byte_size: secondBankBytes.length, sha256: (await sha256(secondBankBytes)).slice(7),
    mime_type: "application/json",
  });
  catalog.sources.push({
    ...catalog.sources[0], id: "second-source", checksum: secondSourceSha,
    bankFile: "banks/second/bank.json",
  });
  catalogFile.bytes = encode(JSON.stringify(catalog));
  catalogFile.byte_size = catalogFile.bytes.length;
  catalogFile.sha256 = (await sha256(catalogFile.bytes)).slice(7);
  upload.provenance.sourceChecksums.push(secondSourceSha);
  upload.metadata.ready_questions = 2;
  const backend = mockedStorage(upload, await academicCollectionId("account-a", upload.catalogId));

  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/Duplicate question identities across source collections/);
  expect(backend.rpc).not.toHaveBeenCalled();
  expect(backend.bucket.upload).not.toHaveBeenCalled();
});

it("takes an immutable upload snapshot before an awaited account check can mutate the caller's object", async () => {
  const upload = await prepareAcademicUpload((await fixture()).read);
  const expectedMetadata = structuredClone(upload.metadata);
  const expectedHash = upload.hash;
  const expectedCatalogId = upload.catalogId;
  const expectedFile = upload.files[0];
  const expectedPath = expectedFile.path;
  const expectedSha = expectedFile.sha256;
  const expectedBytes = new Uint8Array(expectedFile.bytes);
  const collection = await academicCollectionId("account-a", expectedCatalogId);
  const backend = mockedStorage(upload, collection);
  let mutated = false;
  const assertCurrent = vi.fn(async () => {
    if (!mutated) {
      mutated = true;
      upload.catalogId = "mutated-catalog";
      upload.hash = "f".repeat(64);
      upload.metadata.title = "Mutated during account verification";
      upload.provenance.sourceChecksums.push("e".repeat(64));
      upload.files[0].path = "mutated.json";
      upload.files[0].sha256 = "d".repeat(64);
      upload.files[0].bytes.fill(0);
      upload.localOnlyOriginals.push({ sourceId: "mutated", sha256: "c".repeat(64),
        byteSize: 50 * 1024 * 1024 + 1, reason: "over-limit" });
    }
    await Promise.resolve();
  });

  await expect(uploadAcademicCourse(backend.client, "account-a", upload, assertCurrent, () => {}))
    .resolves.toMatchObject({ collection_id: collection, revision_id: "revision" });
  expect(backend.rpc).toHaveBeenCalledWith("academic_create_revision", expect.objectContaining({
    collection, content_hash: expectedHash, metadata: expectedMetadata,
    files: expect.arrayContaining([expect.objectContaining({ path: expectedPath, sha256: expectedSha })]),
  }));
  const stored = tus.blobs.get(`academic-content/${collection}/${expectedSha}`);
  expect(stored).toBeDefined();
  expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(expectedBytes);
});

it("rejects unknown replay fields and semantically altered banks before any cloud operation", async () => {
  const strict = await prepareAcademicUpload((await fixture()).read);
  (strict.metadata as Record<string, unknown>).privateWorkspace = "must not cross the boundary";
  const strictBackend = mockedStorage(strict, await academicCollectionId("account-a", strict.catalogId));
  await expect(uploadAcademicCourse(strictBackend.client, "account-a", strict, () => {}, () => {}))
    .rejects.toThrow(/unexpected or missing fields/);
  expect(strictBackend.rpc).not.toHaveBeenCalled();
  expect(strictBackend.bucket.upload).not.toHaveBeenCalled();

  const f = await untemplatedBankFixture();
  const upload = await prepareAcademicUpload(f.read, {
    term: "Term 5", module: "GOER", evidence: "human-reviewed",
  });
  const bankFile = upload.files.find(file => file.path === "banks/sample/bank.json")!;
  const bank = JSON.parse(new TextDecoder().decode(bankFile.bytes));
  delete bank.pkg.questions[0].provenance.sourceChecksum;
  bankFile.bytes = encode(JSON.stringify(bank));
  bankFile.byte_size = bankFile.bytes.length;
  bankFile.sha256 = (await sha256(bankFile.bytes)).slice(7);
  upload.hash = await academicUploadHash(upload);
  const backend = mockedStorage(upload, await academicCollectionId("account-a", upload.catalogId));
  await expect(uploadAcademicCourse(backend.client, "account-a", upload, () => {}, () => {}))
    .rejects.toThrow(/missing or claims a different original source checksum/);
  expect(backend.rpc).not.toHaveBeenCalled();
  expect(backend.bucket.upload).not.toHaveBeenCalled();
});

it("rejects a GIF upload with actionable guidance when the database migration is not installed", async () => {
  stubSuccessfulBrowserDecode();
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
    { id: "source-a", name: "source.txt", sourcePath: "source.txt", checksum: real, module: "SAMPLE",
      status: "reference/template-only", reason: "Reference", ready: 0, review: 0,
      originalFile: "sources/source.txt" },
    { id: "source-b", name: "source.txt", sourcePath: "source.txt", checksum: "f".repeat(64), module: "SAMPLE",
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
      id, name: "shared.txt", sourcePath: "shared.txt", checksum: sha, module: "SAMPLE",
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
  f.catalog.sources.push({ id: "oversize-original", name: "original.pdf", sourcePath: "original.pdf", checksum, module: "SAMPLE",
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

  const tampered: AcademicUpload = {
    ...upload,
    localOnlyOriginals: upload.localOnlyOriginals.map(original => ({ ...original, sha256: "b".repeat(64) })),
  };
  tampered.hash = await academicUploadHash(tampered);
  expect(tampered.hash).not.toBe(upload.hash);
  const backend = mockedStorage(tampered, await academicCollectionId("account-a", tampered.catalogId));
  await expect(uploadAcademicCourse(backend.client, "account-a", tampered, () => {}, () => {}))
    .rejects.toThrow(/local-only original manifest differs/);
  expect(backend.rpc).not.toHaveBeenCalled();
  expect(backend.bucket.upload).not.toHaveBeenCalled();
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

it("uploads every plan section of one module as one course, with a reviewed term when the plan states none", async () => {
  const f = await templateBackedBankFixture("GOER - Lectures:\nWeek 1:\nLecture 1 Sample [Lecture]\n");
  const groups = encode("GOER - Small groups:\nWeek 2:\nSG 01 Sample [Small Group]");
  f.catalog.templates.push({ name: "groups.txt", file: "templates/groups.txt", checksum: (await sha256(groups)).slice(7) });
  f.files.set("templates/groups.txt", groups);
  writeFixtureCatalog(f);
  await expect(prepareAcademicUpload(f.read)).rejects.toThrow(/does not name its term/);
  await expect(prepareAcademicUpload(f.read, { term: "Term 5", module: "GOER", evidence: "human-reviewed" },
    { planTerm: { term: "Term 5", evidence: "human-reviewed" } })).rejects.toThrow(/cannot override its course classification/);

  const planTerm = { term: "Term 5", evidence: "human-reviewed" } as const;
  const upload = await prepareAcademicUpload(f.read, undefined, { planTerm });
  expect(upload.metadata).toMatchObject({ title: "GOER", module: "GOER", term: "Term 5", ready_questions: 1 });
  expect(upload.provenance).toEqual({ sourceChecksums: ["a".repeat(64)], planTermEvidence: "human-reviewed" });
  expect(upload.template.split("\n@@ AXOM course plan section @@\n")).toEqual([
    "GOER - Lectures:\nWeek 1:\nLecture 1 Sample [Lecture]\n", "GOER - Small groups:\nWeek 2:\nSG 01 Sample [Small Group]",
  ]);
  expect(upload.files.map(file => file.path)).toEqual(["banks/sample/bank.json", "catalog.json", "templates/groups.txt", "templates/plan.txt"]);
  expect((await prepareAcademicUpload(f.read, undefined, { planTerm })).hash).toBe(upload.hash);
  // A plan term is a reviewed classification of the course, so it changes the content identity.
  const stated = await templateBackedBankFixture("T5 - GOER - Lectures:\nWeek 1:\nLecture 1 Sample [Lecture]\n");
  expect((await prepareAcademicUpload(stated.read)).provenance).toEqual({ sourceChecksums: ["a".repeat(64)] });

  const accountId = "account-a";
  const backend = mockedStorage(upload, await academicCollectionId(accountId, upload.catalogId));
  await expect(uploadAcademicCourse(backend.client, accountId, upload, () => {}, () => {}))
    .resolves.toMatchObject({ status: "active" });
  expect(backend.rpc).toHaveBeenCalledWith("academic_create_revision", expect.objectContaining({
    template: upload.template, provenance: expect.objectContaining({ planTermEvidence: "human-reviewed" }),
  }));

  // A replay cannot drop the reviewed-term evidence or reclassify the course.
  for (const tamper of [
    (copy: AcademicUpload) => { delete copy.provenance.planTermEvidence; },
    (copy: AcademicUpload) => { copy.metadata.term = "Term 4"; },
  ]) {
    const copy = await prepareAcademicUpload(f.read, undefined, { planTerm });
    tamper(copy);
    copy.hash = await academicUploadHash(copy);
    const rejected = mockedStorage(copy, await academicCollectionId(accountId, copy.catalogId));
    await expect(uploadAcademicCourse(rejected.client, accountId, copy, () => {}, () => {})).rejects.toThrow();
    expect(rejected.rpc).not.toHaveBeenCalled();
  }
});
