// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "../question-content/assets";
import { academicLibraryReader } from "./client";
import { accountOperationClient, loadSupabase } from "../account/supabase";
import { academicCollectionId, uploadAcademicCourse, type AcademicUpload } from "./upload";
import { academicReconciliationLedger, uploadAcademicBatch, verifyAcademicCourseReadback } from "./batch";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn(), loadSupabase: vi.fn() }));
vi.mock("./client", () => ({ academicLibraryReader: vi.fn() }));
vi.mock("./upload", async importOriginal => ({
  // Keep the real installer-compatibility validation in readback tests; mock
  // only network writes and the deterministic account/collection ID.
  ...(await importOriginal<typeof import("./upload")>()),
  academicCollectionId: vi.fn(), uploadAcademicCourse: vi.fn(),
}));
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const owner = "user-owner";
const collection = "33333333-3333-4333-8333-333333333333";
const revision = "44444444-4444-4444-8444-444444444444";
const S = "a".repeat(64);
const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXnkAAAAASUVORK5CYII=", "base64",
));

async function fixture({ withImage = false, largeImage = false, ambiguousAnswer = false, catalogId = "fixture" } = {}) {
  const image = largeImage ? new Uint8Array(8 * 1024 * 1024 + 1) : png;
  if (largeImage) image.set(png);
  const checksum = await sha256(image);
  const asset = { id: "figure", questionId: "question-1", filename: "figure.png",
    checksum, mimeType: "image/png", role: "question" };
  const bank = {
    pkg: {
      manifest: { schemaVersion: 1, course: { name: "Demo", term: 1, week: 1 },
        bank: { id: "demo", title: "Synthetic verification", discipline: "Example" },
        source: { filename: "illustrative.pdf", sourceWeekDeclared: false }, questionsFile: "questions.json", assetsDirectory: "assets" },
      questions: [{
        id: "question-1", source: { filename: "illustrative.pdf", questionNumber: 1 },
        stem: [{ type: "text", text: "Which label is first?" },
          ...(withImage ? [{ type: "image", assetId: "figure", role: "question", alt: "Synthetic figure" }] : [])],
        choices: [
          { id: "a", label: "A", blocks: [{ type: "text", text: "Label A" }] },
          { id: "b", label: "B", blocks: [{ type: "text", text: "Label B" }] },
        ],
        correctAnswer: { labels: ambiguousAnswer ? ["A", "B"] : ["A"], evidence: "printed-key" },
        assets: withImage ? [asset] : [],
        provenance: { method: "authored", sourceChecksum: `sha256:${S}` },
      }],
    }, issues: [], sourceText: { rawText: "Synthetic, made-up teaching example." }, sourceBytes: 32, notes: [],
  };
  const catalog = {
    format: "axom-private-library", schemaVersion: 1, id: catalogId, version: "1", templates: [],
    sources: [{ id: "source-1", name: "illustrative.pdf", sourcePath: "illustrative.pdf", checksum: S,
      status: "prepared", reason: "Reviewed synthetic source", ready: 1, review: 0, bankFile: "banks/demo/bank.json" }],
  };
  const data = new Map<string, { mime: string; bytes: Uint8Array }>([
    ["catalog.json", { mime: "application/json", bytes: encode(catalog) }],
    ["banks/demo/bank.json", { mime: "application/json", bytes: encode(bank) }],
    ...(withImage ? [["banks/demo/assets/figure.png", { mime: "image/png", bytes: image }] as const] : []),
  ]);
  const files = await Promise.all([...data.entries()].map(async ([path, item]) => ({
    path, sha256: (await sha256(item.bytes)).slice(7), byte_size: item.bytes.length,
    mime_type: item.mime, bytes: item.bytes,
  })));
  const upload: AcademicUpload = {
    catalogId, hash: "c".repeat(64), metadata: { ready_questions: 1, review_questions: 0 },
    provenance: { sourceChecksums: [S], scopeEvidence: "human-reviewed", weekAssignment: "unassigned" },
    files, localOnlyOriginals: [], template: "",
  };
  const cloudManifest = files.map(file => ({
    path: file.path, sha256: file.sha256, byte_size: file.byte_size,
    mime_type: file.mime_type, object_path: `${collection}/${file.sha256}`,
  }));
  const read = Object.assign(async (path: string) => {
    const entry = data.get(path);
    if (!entry) throw new Error("Missing server asset");
    return entry.bytes;
  }, { files: cloudManifest });
  const saved = { status: "active" as const, collection_id: collection, revision_id: revision };
  return { upload, saved, read, data, cloudManifest };
}

function session(
  caseData: Awaited<ReturnType<typeof fixture>>,
  extras: { userId?: string; courseCurrent?: string; courseReady?: number; savedRevisionStatus?: string } = {},
) {
  const userId = extras.userId ?? owner;
  const guard = vi.fn(async () => undefined);
  const course = {
    owned: true, current_revision_id: extras.courseCurrent ?? revision,
    ready_questions: extras.courseReady ?? 1, review_questions: 0,
  };
  const row = {
    id: revision, status: extras.savedRevisionStatus ?? "ready",
    collection_id: collection, content_hash: caseData.upload.hash, ready_questions: 1, review_questions: 0,
  };
  const shared = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })) },
  } as unknown as SupabaseClient;
  // Exact SDK behaviour: client created with { accessToken } has an Auth
  // proxy that throws on EVERY auth property. Cloud readback must use the
  // session-owning shared client for identity, not this scoped client.
  const client = {
    get auth() { throw new Error("Supabase accessToken-scoped client blocks auth methods"); },
    rpc: vi.fn(async () => ({ data: course, error: null })),
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }) }) }) })),
  } as unknown as SupabaseClient;
  vi.mocked(loadSupabase).mockResolvedValue(shared);
  vi.mocked(accountOperationClient).mockImplementation(async () => ({
    userId: owner, client, assertCurrent: guard,
    resumable: { endpoint: "https://example.storage.supabase.co/storage/v1/upload/resumable", headers: { authorization: "Bearer mock", apikey: "public-test" } },
  }));
  vi.mocked(academicCollectionId).mockResolvedValue(collection);
  vi.mocked(academicLibraryReader).mockResolvedValue(caseData.read);
  vi.mocked(uploadAcademicCourse).mockResolvedValue(caseData.saved);
  return { client, shared, guard };
}

beforeEach(() => vi.clearAllMocks());

describe("authenticated source-level academic readback", () => {
  it("uses the shared Auth client because the real scoped Supabase SDK disables auth methods", () => {
    const scoped = createClient("http://127.0.0.1:54321", "public-anon-key",
      { accessToken: async () => "not-a-real-token" });
    expect(() => scoped.auth.getUser()).toThrow(/configured with the accessToken option/);
  });

  it("verifies a synthetic question, immutable manifest and actual clinical figure bytes", async () => {
    const f = await fixture({ withImage: true });
    const { client, shared, guard } = session(f);
    const result = await verifyAcademicCourseReadback(f.upload, f.saved, owner);
    expect(result).toMatchObject({
      collectionId: collection, revisionId: revision,
      readyQuestions: 1, reviewQuestions: 0, verifiedFiles: 3,
      sourceReceipts: [{
        sha256: S, questionCount: 1, reviewCount: 0, figureReferences: 1,
        distinctFigureFiles: 1, ownerAuthenticated: true, readbackVerified: true, figureReadbackVerified: true,
      }],
    });
    expect(shared.auth.getUser).toHaveBeenCalledOnce();
    expect(() => client.auth).toThrow(/blocks auth/);
    expect(guard).toHaveBeenCalled();
  });

  it("distinguishes an oversized local-only original from a cloud-verified original", async () => {
    const f = await fixture();
    f.upload.localOnlyOriginals = [{ sourceId: "source-1", sha256: S, byteSize: 180_000_000, reason: "over-limit" }];
    session(f);
    const result = await verifyAcademicCourseReadback(f.upload, f.saved, owner);
    expect(result.sourceReceipts[0]).toMatchObject({
      questionCount: 1, originalFileStatus: "local-only", readyQuestionIds: ["question-1"],
    });
    expect(result.localOnlyOriginals).toHaveLength(1);
    const falseClaim = await fixture();
    falseClaim.upload.localOnlyOriginals = [{ sourceId: "source-1", sha256: "b".repeat(64), byteSize: 180_000_000, reason: "over-limit" }];
    session(falseClaim);
    await expect(verifyAcademicCourseReadback(falseClaim.upload, falseClaim.saved, owner))
      .rejects.toThrow(/local-only original conflicts/);
  });

  it("refuses a figure with a matching name but corrupted bytes", async () => {
    const f = await fixture({ withImage: true });
    session(f);
    const wrong = Object.assign(async (path: string) =>
      path.endsWith("figure.png") ? Uint8Array.from([1, 2, 3, 4]) : f.read(path), { files: f.cloudManifest });
    vi.mocked(academicLibraryReader).mockResolvedValue(wrong);
    await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner))
      .rejects.toThrow(/academic image content|figure failed authenticated byte-level readback/i);
  });

  it("never certifies a server-side 8 MiB+ figure that the learner's installer cannot restore", async () => {
    const f = await fixture({ withImage: true, largeImage: true });
    session(f);
    await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner)).rejects.toThrow(/8 MiB/);
  });

  it("rejects a cloud-stored multi-answer item the canonical scored importer cannot install", async () => {
    const f = await fixture({ ambiguousAnswer: true });
    session(f);
    await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner))
      .rejects.toThrow(/canonical scored importer/);
  });

  it("refuses forged auth, inactive version and wrong server bytes or file metadata", async () => {
    const f = await fixture();
    session(f, { userId: "another-user" });
    await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner)).rejects.toThrow(/Owner identity/);
    session(f, { courseCurrent: "a-newer-revision" });
    await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner)).rejects.toThrow(/current academic course/);
    session(f, { savedRevisionStatus: "uploading" });
    await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner)).rejects.toThrow(/revision record/);
    session(f);
    const tampered = Object.assign(async (path: string) => {
      if (path === "catalog.json") return encode({ unrelated: true });
      return f.read(path);
    }, { files: f.cloudManifest });
    vi.mocked(academicLibraryReader).mockResolvedValue(tampered);
    await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner)).rejects.toThrow(/supported AXOM private library/);
    session(f);
    vi.mocked(academicLibraryReader).mockResolvedValue(
      Object.assign(f.read, { files: f.cloudManifest.map(file => file.path === "catalog.json" ? { ...file, sha256: "0".repeat(64) } : file) }),
    );
    await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner)).rejects.toThrow(/manifest/);
  });

  it("denies a falsified active pointer and a cancelled or superseded verification", async () => {
    const f = await fixture();
    session(f);
    await expect(verifyAcademicCourseReadback(f.upload, { ...f.saved, status: "superseded", active_revision_id: "other" }, owner))
      .rejects.toThrow(/superseded/);
    const controller = new AbortController(); controller.abort();
    await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    await expect(verifyAcademicCourseReadback(f.upload, { ...f.saved, collection_id: "wrong" }, owner))
      .rejects.toThrow(/collection ID/);
  });
});

describe("bounded reviewed academic batch", () => {
  it("processes one lazy package at a time, skips same-batch duplicates and emits owner-scoped receipts", async () => {
    const f = await fixture({ withImage: true });
    session(f);
    const prepared = vi.fn(async () => f.upload);
    const logged = vi.fn();
    const report = await uploadAcademicBatch([
      { key: "first", prepare: prepared },
      { key: "duplicate", prepare: prepared },
    ], { onOutcome: logged });
    expect(report).toMatchObject({
      expected: 2, processed: 2, verified: 1, duplicateInputs: 1,
      failed: 0, pending: 0, verifiedReadyQuestions: 1, verifiedFigures: 1,
    });
    expect(report.outcomes[0]).toMatchObject({ key: "first", state: "verified" });
    expect(report.outcomes[1]).toEqual({ key: "duplicate", state: "duplicate-input", duplicateOf: "first" });
    expect(prepared).toHaveBeenCalledTimes(2);
    expect(uploadAcademicCourse).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it("exports only owner-verified sources to the existing reconciliation schema and rejects duplicate SHA claims", async () => {
    const f = await fixture({ withImage: true });
    session(f);
    const report = await uploadAcademicBatch([{ key: "ready-source", prepare: async () => f.upload }]);
    expect(academicReconciliationLedger(report)).toEqual({ sources: [{
      sha256: S, questionCount: 1, readbackVerified: true, ownerAuthenticated: true,
      figureReferences: 1, figureReadbackVerified: true,
    }] });
    expect(() => academicReconciliationLedger({
      ...report, verified: 2, serverConfirmed: 2,
      outcomes: [report.outcomes[0], report.outcomes[0]],
    })).toThrow(/same source SHA/);
    expect(() => academicReconciliationLedger({ ...report, serverConfirmed: 0 }))
      .toThrow(/do not reconcile/);
  });

  it("does not treat a failed upload as an already-completed duplicate when an identical job retries", async () => {
    const f = await fixture();
    session(f);
    vi.mocked(uploadAcademicCourse).mockRejectedValueOnce(new Error("network interruption"))
      .mockResolvedValueOnce(f.saved);
    const result = await uploadAcademicBatch([
      { key: "first-attempt", prepare: async () => f.upload },
      { key: "retry-same-source", prepare: async () => f.upload },
    ]);
    expect(result).toMatchObject({ expected: 2, processed: 2, failed: 1, verified: 1, duplicateInputs: 0 });
    expect(result.outcomes.map(outcome => outcome.state)).toEqual(["failed", "verified"]);
    expect(uploadAcademicCourse).toHaveBeenCalledTimes(2);
  });

  it("isolates a failed item and leaves later jobs retryable without claiming cloud receipts", async () => {
    const first = await fixture();
    const second = await fixture({ catalogId: "other" });
    session(first);
    vi.mocked(uploadAcademicCourse).mockImplementation(async (_client, _account, upload) => {
      if (upload.catalogId === "other") throw new Error("503 backend unavailable");
      return first.saved;
    });
    const result = await uploadAcademicBatch([
      { key: "accepted", prepare: async () => first.upload },
      { key: "unavailable", prepare: async () => second.upload },
      { key: "local-failed", prepare: async () => { throw new Error("local source missing"); } },
    ]);
    expect(result).toMatchObject({ expected: 3, verified: 1, failed: 2, pending: 0 });
    expect(result.outcomes.filter(x => x.state === "verified")).toHaveLength(1);
    expect(JSON.stringify(result.outcomes)).not.toContain("503 backend unavailable");
    expect(JSON.stringify(result.outcomes)).not.toContain("local source missing");
  });

  it("stops after a session-change interruption; unattempted jobs remain pending", async () => {
    const f = await fixture();
    const { guard } = session(f);
    vi.mocked(uploadAcademicCourse).mockRejectedValue(new Error("The signed-in account changed."));
    const readNext = vi.fn(async () => f.upload);
    const result = await uploadAcademicBatch([
      { key: "first", prepare: async () => f.upload }, { key: "second", prepare: readNext },
    ]);
    expect(result).toMatchObject({ expected: 2, processed: 1, authBlocked: 1, cancelled: 0, pending: 1 });
    expect(readNext).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalled();
  });

  it("stops an already-cancelled batch before any Auth or upload requests", async () => {
    const f = await fixture();
    const controller = new AbortController(); controller.abort();
    await expect(uploadAcademicBatch([{ key: "aborted", prepare: async () => f.upload }], { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(accountOperationClient).not.toHaveBeenCalled();
    expect(uploadAcademicCourse).not.toHaveBeenCalled();
  });

  it("fails before writes if the owner identity is invalid or jobs are malformed", async () => {
    const f = await fixture();
    const { shared } = session(f, { userId: "attacker" });
    await expect(uploadAcademicBatch([{ key: "x", prepare: async () => f.upload }]))
      .rejects.toThrow(/Owner identity was not verified/);
    expect(uploadAcademicCourse).not.toHaveBeenCalled();
    expect(shared.auth.getUser).toHaveBeenCalledOnce();
    await expect(uploadAcademicBatch([])).rejects.toThrow(/1–100/);
    await expect(uploadAcademicBatch([
      { key: "same", prepare: async () => f.upload }, { key: "same", prepare: async () => f.upload },
    ])).rejects.toThrow(/uniquely identified/);
  });
});
