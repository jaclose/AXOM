// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "../question-content/assets";
import { academicLibraryReader } from "./client";
import { accountOperationClient, loadSupabase } from "../account/supabase";
import { academicCollectionId, prepareAcademicUpload, uploadAcademicCourse, type AcademicUpload } from "./upload";
import { academicReconciliationLedger, uploadAcademicBatch, verifyAcademicCourseReadback } from "./batch";
import { planPublication, publicationJobs, readPublicationInventory } from "./publication";
import { library } from "./publicationFixture.testing";

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
const gif = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXnkAAAAASUVORK5CYII=", "base64",
));
const jpegHeader = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 1, 0, 1, 0]);
const webpHeader = new Uint8Array(30);
webpHeader.set(Buffer.from("RIFF"), 0);
webpHeader.set(Buffer.from("WEBP"), 8);
webpHeader.set(Buffer.from("VP8X"), 12);

async function fixture({ withImage = false, largeImage = false, brokenGif = false,
  imageFormat = "png", ambiguousAnswer = false, heldFigureCount = 0, catalogId = "fixture",
}: { withImage?: boolean; largeImage?: boolean; brokenGif?: boolean;
  imageFormat?: "png" | "jpg" | "webp" | "gif"; ambiguousAnswer?: boolean; heldFigureCount?: number; catalogId?: string } = {}) {
  const image = brokenGif ? gif.subarray(0, 12) : largeImage ? new Uint8Array(8 * 1024 * 1024 + 1)
    : imageFormat === "gif" ? gif : imageFormat === "jpg" ? jpegHeader
    : imageFormat === "webp" ? webpHeader : png;
  if (largeImage) image.set(png);
  const checksum = await sha256(image);
  const filename = brokenGif ? "figure.gif" : `figure.${imageFormat}`;
  const mimeType = brokenGif || imageFormat === "gif" ? "image/gif"
    : imageFormat === "jpg" ? "image/jpeg" : imageFormat === "webp" ? "image/webp" : "image/png";
  const asset = { id: "figure", questionId: "question-1", filename,
    checksum, mimeType, byteSize: image.length, width: 1, height: 1, role: "question" };
  const assets = Array.from({ length: heldFigureCount || Number(withImage) }, (_, index) => ({
    ...asset, id: index ? `figure-${index + 1}` : "figure",
    filename: index ? `figure-${index + 1}.${imageFormat}` : filename,
  }));
  const bank = {
    pkg: {
      manifest: { schemaVersion: 1, course: { name: "Demo", term: 1, week: 1 },
        bank: { id: "demo", title: "Synthetic verification", discipline: "Example" },
        source: { filename: "illustrative.pdf", sourceWeekDeclared: false }, questionsFile: "questions.json", assetsDirectory: "assets" },
      questions: [{
        id: "question-1", source: { filename: "illustrative.pdf", questionNumber: 1 },
        stem: [{ type: "text", text: "Which label is first?" },
          ...assets.map(figure => ({ type: "image", assetId: figure.id, role: "question", alt: "Synthetic figure" }))],
        choices: [
          { id: "a", label: "A", blocks: [{ type: "text", text: "Label A" }] },
          { id: "b", label: "B", blocks: [{ type: "text", text: "Label B" }] },
        ],
        ...(heldFigureCount ? {} : { correctAnswer: { labels: ambiguousAnswer ? ["A", "B"] : ["A"], evidence: "printed-key" } }),
        assets,
        provenance: { method: "authored", sourceChecksum: `sha256:${S}` },
      }],
    }, issues: [], sourceText: { rawText: "Synthetic, made-up teaching example." }, sourceBytes: 32, notes: [],
  };
  const catalog = {
    format: "axom-private-library", schemaVersion: 1, id: catalogId, version: "1", templates: [],
    sources: [{ id: "source-1", name: "illustrative.pdf", sourcePath: "illustrative.pdf", checksum: S,
      status: "prepared", reason: "Reviewed synthetic source", ready: heldFigureCount ? 0 : 1,
      review: heldFigureCount ? 1 : 0, bankFile: "banks/demo/bank.json" }],
  };
  const data = new Map<string, { mime: string; bytes: Uint8Array }>([
    ["catalog.json", { mime: "application/json", bytes: encode(catalog) }],
    ["banks/demo/bank.json", { mime: "application/json", bytes: encode(bank) }],
    ...assets.map(figure => [`banks/demo/assets/${figure.filename}`, { mime: mimeType, bytes: image }] as const),
  ]);
  const files = await Promise.all([...data.entries()].map(async ([path, item]) => ({
    path, sha256: (await sha256(item.bytes)).slice(7), byte_size: item.bytes.length,
    mime_type: item.mime, bytes: item.bytes,
  })));
  const upload: AcademicUpload = {
    catalogId, hash: "c".repeat(64), metadata: {
      ready_questions: heldFigureCount ? 0 : 1, review_questions: heldFigureCount ? 1 : 0,
    },
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
    ready_questions: extras.courseReady ?? caseData.upload.metadata.ready_questions,
    review_questions: caseData.upload.metadata.review_questions,
  };
  const row = {
    id: revision, status: extras.savedRevisionStatus ?? "ready",
    collection_id: collection, content_hash: caseData.upload.hash,
    ready_questions: caseData.upload.metadata.ready_questions, review_questions: caseData.upload.metadata.review_questions,
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
afterEach(() => vi.unstubAllGlobals());

function stubSuccessfulBrowserDecode(width = 1, height = 1) {
  const decode = vi.fn(async (_blob: Blob) => ({ width, height, close: vi.fn() }));
  vi.stubGlobal("createImageBitmap", decode);
  return decode;
}

describe("authenticated source-level academic readback", () => {
  it("uses the shared Auth client because the real scoped Supabase SDK disables auth methods", () => {
    const scoped = createClient("http://127.0.0.1:54321", "public-anon-key",
      { accessToken: async () => "not-a-real-token" });
    expect(() => scoped.auth.getUser()).toThrow(/configured with the accessToken option/);
  });

  it("verifies a synthetic question, immutable manifest and actual clinical figure bytes", async () => {
    stubSuccessfulBrowserDecode();
    const f = await fixture({ withImage: true });
    const { client, shared, guard } = session(f);
    const result = await verifyAcademicCourseReadback(f.upload, f.saved, owner);
    expect(result).toMatchObject({
      collectionId: collection, revisionId: revision,
      readyQuestions: 1, reviewQuestions: 0, verifiedFiles: 3,
      sourceReceipts: [{
        sha256: S, questionCount: 1, reviewCount: 0, figureReferences: 1,
        distinctFigureFiles: 1, ownerAuthenticated: true, bankReadbackVerified: true,
        figureReadbackVerified: true, originalReadbackVerified: false,
      }],
    });
    expect(shared.auth.getUser).toHaveBeenCalledOnce();
    expect(() => client.auth).toThrow(/blocks auth/);
    expect(guard).toHaveBeenCalled();
  });

  it("verifies a held source's 11 figures without claiming they are learner attachments", async () => {
    stubSuccessfulBrowserDecode();
    const f = await fixture({ heldFigureCount: 11 });
    session(f);
    const result = await verifyAcademicCourseReadback(f.upload, f.saved, owner);
    expect(result).toMatchObject({ readyQuestions: 0, reviewQuestions: 1, verifiedFiles: 13 });
    expect(result.sourceReceipts[0]).toMatchObject({
      questionCount: 0, reviewCount: 1, figureReferences: 0, distinctFigureFiles: 11,
      figureReadbackVerified: true, bankReadbackVerified: true, readyQuestionIds: [],
    });
  });

  it("prepares and reads back an explicitly reviewed Unfiled source without changing its original scope", async () => {
    const f = await fixture();
    const bank = JSON.parse(new TextDecoder().decode(f.data.get("banks/demo/bank.json")!.bytes));
    bank.pkg.manifest.course = { name: "Unfiled", term: 0, week: 0 };
    bank.pkg.questions[0].course = "Unfiled";
    bank.pkg.questions[0].term = 0;
    bank.reviewedFiling = { term: "Term 5", module: "GOER", evidence: "human-reviewed", weekAssignment: "unassigned" };
    f.data.set("banks/demo/bank.json", { mime: "application/json", bytes: encode(bank) });
    const catalog = JSON.parse(new TextDecoder().decode(f.data.get("catalog.json")!.bytes));
    catalog.sources[0].module = "GOER";
    f.data.set("catalog.json", { mime: "application/json", bytes: encode(catalog) });
    const prepared = await prepareAcademicUpload(async path => f.data.get(path)!.bytes,
      { term: "Term 5", module: "GOER", evidence: "human-reviewed" });
    const storedBank = JSON.parse(new TextDecoder().decode(prepared.files.find(file => file.path === "banks/demo/bank.json")!.bytes));
    expect(storedBank.pkg.manifest.course).toEqual({ name: "Unfiled", term: 0, week: 0 });
    expect(storedBank.pkg.questions[0]).toMatchObject({ course: "Unfiled", term: 0 });
    expect(storedBank.reviewedFiling).toMatchObject({ term: "Term 5", module: "GOER", evidence: "human-reviewed" });

    f.upload = prepared;
    f.data.clear();
    for (const file of prepared.files) f.data.set(file.path, { mime: file.mime_type, bytes: file.bytes });
    f.read.files = prepared.files.map(file => ({ path: file.path, sha256: file.sha256, byte_size: file.byte_size,
      mime_type: file.mime_type, object_path: `${collection}/${file.sha256}` }));
    session(f);
    const result = await verifyAcademicCourseReadback(prepared, f.saved, owner);
    expect(result).toMatchObject({ readyQuestions: 1, reviewQuestions: 0,
      sourceReceipts: [{ questionCount: 1, readyQuestionIds: ["question-1"], bankReadbackVerified: true }] });
  });

  it("preserves each bank's filing evidence when a reviewed Unfiled bank joins an ordinary source", async () => {
    const input = await library();
    const reviewedSource = input.catalog.sources.find(source => source.name === "unfiled-pq.pdf")!;
    const ordinarySource = input.catalog.sources.find(source => source.name === "ncrs-pq.pdf")!;
    const reviewedBank = JSON.parse(new TextDecoder().decode(input.files.get(reviewedSource.bankFile!)!));
    reviewedBank.pkg.questions[0].course = "Unfiled";
    reviewedBank.pkg.questions[0].term = 0;
    reviewedBank.reviewedFiling = { term: "Term 4", module: "NCRS", evidence: "human-reviewed", weekAssignment: "unassigned" };
    reviewedSource.module = "NCRS";
    input.files.set(reviewedSource.bankFile!, encode(reviewedBank));
    input.files.set("catalog.json", encode(input.catalog));

    const inventory = await readPublicationInventory(input.read);
    const course = planPublication(inventory).courses.find(item => item.term === "Term 4" && item.moduleKey === "ncrs")!;
    expect(course.sourceIds).toEqual(expect.arrayContaining([ordinarySource.id, reviewedSource.id]));
    const prepared = await publicationJobs(input.read, inventory, [course]).jobs[0].prepare();
    expect(prepared.provenance.scopeEvidence).toBe("human-reviewed");
    const stored = (path: string) => JSON.parse(new TextDecoder().decode(prepared.files.find(file => file.path === path)!.bytes));
    const ordinaryBank = stored(ordinarySource.bankFile!);
    const filedBank = stored(reviewedSource.bankFile!);
    expect(ordinaryBank.reviewedFiling).toEqual({
      term: "Term 4", module: "NCRS", evidence: "source-metadata", weekAssignment: "unassigned",
    });
    expect(ordinaryBank.pkg.manifest.course).toMatchObject({ name: "NCRS", term: 4 });
    expect(filedBank.reviewedFiling).toEqual({
      term: "Term 4", module: "NCRS", evidence: "human-reviewed", weekAssignment: "unassigned",
    });
    expect(filedBank.pkg.manifest.course).toMatchObject({ name: "Unfiled", term: 0 });
    expect(filedBank.pkg.questions[0]).toMatchObject({ course: "Unfiled", term: 0 });

    const cloud = await fixture();
    cloud.upload = prepared;
    cloud.data.clear();
    for (const file of prepared.files) cloud.data.set(file.path, { mime: file.mime_type, bytes: file.bytes });
    cloud.read.files = prepared.files.map(file => ({ path: file.path, sha256: file.sha256, byte_size: file.byte_size,
      mime_type: file.mime_type, object_path: `${collection}/${file.sha256}` }));
    session(cloud);
    const result = await verifyAcademicCourseReadback(prepared, cloud.saved, owner);
    expect(result).toMatchObject({ readyQuestions: 2, reviewQuestions: 0 });
    expect(result.sourceReceipts).toHaveLength(2);
    expect(result.sourceReceipts.every(receipt => receipt.bankReadbackVerified && receipt.ownerAuthenticated)).toBe(true);
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

  it("emits zero-question receipts and truthful original counters for bankless sources", async () => {
    const f = await fixture();
    const catalogEntry = f.data.get("catalog.json")!;
    const catalog = JSON.parse(new TextDecoder().decode(catalogEntry.bytes));
    const cloudOriginal = new TextEncoder().encode("synthetic cloud-verified original");
    const cloudSha = (await sha256(cloudOriginal)).slice(7);
    const localSha = "b".repeat(64);
    const absentSha = "d".repeat(64);
    catalog.sources.push(
      { id: "cloud-original", name: "cloud.txt", sourcePath: "cloud.txt", checksum: cloudSha,
        status: "reference/template-only", reason: "Synthetic original only", ready: 0, review: 0,
        originalFile: "sources/cloud.txt" },
      { id: "local-original", name: "local.pdf", sourcePath: "local.pdf", checksum: localSha,
        status: "reference/template-only", reason: "Synthetic local-only original", ready: 0, review: 0 },
      { id: "no-original", name: "missing.pdf", sourcePath: "missing.pdf", checksum: absentSha,
        status: "reference/template-only", reason: "Synthetic source receipt", ready: 0, review: 0 },
    );
    const replaceCloudFile = async (path: string, mime: string, bytes: Uint8Array) => {
      const digest = (await sha256(bytes)).slice(7);
      f.data.set(path, { mime, bytes });
      const uploadFile = f.upload.files.find(file => file.path === path);
      const manifestFile = f.cloudManifest.find(file => file.path === path);
      if (uploadFile) Object.assign(uploadFile, { bytes, byte_size: bytes.length, sha256: digest, mime_type: mime });
      else f.upload.files.push({ path, bytes, byte_size: bytes.length, sha256: digest, mime_type: mime });
      if (manifestFile) Object.assign(manifestFile, { sha256: digest, byte_size: bytes.length,
        mime_type: mime, object_path: `${collection}/${digest}` });
      else f.cloudManifest.push({ path, sha256: digest, byte_size: bytes.length,
        mime_type: mime, object_path: `${collection}/${digest}` });
    };
    await replaceCloudFile("sources/cloud.txt", "text/plain", cloudOriginal);
    await replaceCloudFile("catalog.json", "application/json", encode(catalog));
    f.upload.provenance.sourceChecksums.push(cloudSha, localSha, absentSha);
    f.upload.localOnlyOriginals.push({
      sourceId: "local-original", sha256: localSha, byteSize: 180_000_000, reason: "over-limit",
    });
    session(f);

    const report = await uploadAcademicBatch([{ key: "mixed-originals", prepare: async () => f.upload }]);
    expect(report).toMatchObject({
      verified: 1, verifiedReadyQuestions: 1, reviewRequired: 0,
      cloudVerifiedOriginals: 1, localOnlyOriginals: 1, originalsNotProvided: 2,
    });
    const outcome = report.outcomes[0];
    expect(outcome.state).toBe("verified");
    if (outcome.state !== "verified") throw new Error("Expected verified synthetic receipt");
    expect(outcome.receipt.sourceReceipts.filter(source => source.questionCount === 0)).toEqual([
      expect.objectContaining({ sha256: cloudSha, reviewCount: 0, originalFileStatus: "cloud-verified",
        originalReadbackVerified: true, bankReadbackVerified: false,
        readyQuestionIds: [], figureReferences: 0, distinctFigureFiles: 0 }),
      expect.objectContaining({ sha256: localSha, reviewCount: 0, originalFileStatus: "local-only",
        originalReadbackVerified: false, bankReadbackVerified: false,
        readyQuestionIds: [], figureReferences: 0, distinctFigureFiles: 0 }),
      expect.objectContaining({ sha256: absentSha, reviewCount: 0, originalFileStatus: "not-provided",
        originalReadbackVerified: false, bankReadbackVerified: false,
        readyQuestionIds: [], figureReferences: 0, distinctFigureFiles: 0 }),
    ]);
    expect(academicReconciliationLedger(report).sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sha256: cloudSha, bankReadbackVerified: false,
        originalFileStatus: "cloud-verified", originalReadbackVerified: true }),
      expect.objectContaining({ sha256: localSha, bankReadbackVerified: false,
        originalFileStatus: "local-only", originalReadbackVerified: false }),
      expect.objectContaining({ sha256: absentSha, bankReadbackVerified: false,
        originalFileStatus: "not-provided", originalReadbackVerified: false }),
    ]));
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

  it("does not certify a downloaded GIF header-only object even when its SHA, byte count and MIME match Storage", async () => {
    const f = await fixture({ withImage: true, brokenGif: true });
    session(f);
    const gifFile = f.cloudManifest.find(file => file.path.endsWith(".gif"));
    expect(gifFile).toMatchObject({ byte_size: 12, mime_type: "image/gif" });
    await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner))
      .rejects.toThrow(/truncated|fully decoded/);
  });

  it("does not issue a production image receipt in pure Node without a real decoder", async () => {
    const f = await fixture({ withImage: true });
    const sessionInfo = session(f);
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("createImageBitmap", undefined);
    vi.stubGlobal("Image", undefined);
    await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner))
      .rejects.toThrow(/fully decoded/);
    expect(sessionInfo.shared.auth.getUser).toHaveBeenCalledOnce();
  });

  it("rejects restored image declarations that disagree with verified decoded bytes", async () => {
    stubSuccessfulBrowserDecode();
    const f = await fixture({ withImage: true });
    const bankEntry = f.data.get("banks/demo/bank.json")!;
    const bank = JSON.parse(new TextDecoder().decode(bankEntry.bytes));
    bank.pkg.questions[0].assets.push({ ...bank.pkg.questions[0].assets[0], id: "figure-reuse", width: 2 });
    bankEntry.bytes = encode(bank);
    const digest = (await sha256(bankEntry.bytes)).slice(7);
    const uploadFile = f.upload.files.find(file => file.path === "banks/demo/bank.json")!;
    uploadFile.bytes = bankEntry.bytes;
    uploadFile.byte_size = bankEntry.bytes.length;
    uploadFile.sha256 = digest;
    const manifestFile = f.cloudManifest.find(file => file.path === "banks/demo/bank.json")!;
    manifestFile.byte_size = bankEntry.bytes.length;
    manifestFile.sha256 = digest;
    manifestFile.object_path = `${collection}/${digest}`;
    session(f);
    await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner))
      .rejects.toThrow(/declared MIME, byte-size or dimensions/);
  });

  it.each(["png", "jpg", "webp", "gif"] as const)(
    "does not certify owner cloud-readback of $0 when the browser decoder rejects real downloaded bytes",
    async (imageFormat) => {
      const f = await fixture({ withImage: true, imageFormat });
      const sessionInfo = session(f);
      const bitmap = vi.fn(async (_blob: Blob) => { throw new Error("browser cannot decode stored bytes"); });
      vi.stubGlobal("window", {});
      vi.stubGlobal("createImageBitmap", bitmap);
      vi.stubGlobal("Image", undefined);
      await expect(verifyAcademicCourseReadback(f.upload, f.saved, owner))
        .rejects.toThrow(/fully decoded/);
      expect(bitmap).toHaveBeenCalledOnce();
      expect(sessionInfo.shared.auth.getUser).toHaveBeenCalledOnce();
    },
  );

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
    stubSuccessfulBrowserDecode();
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
      cloudVerifiedOriginals: 0, localOnlyOriginals: 0, originalsNotProvided: 1,
    });
    expect(report.outcomes[0]).toMatchObject({ key: "first", state: "verified" });
    expect(report.outcomes[1]).toEqual({ key: "duplicate", state: "duplicate-input", duplicateOf: "first" });
    expect(prepared).toHaveBeenCalledTimes(2);
    expect(uploadAcademicCourse).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it("does not double-count one source SHA across differently named collections", async () => {
    const first = await fixture({ catalogId: "b4-source" });
    const second = await fixture({ catalogId: "b5-crosswalk" });
    session(first);
    // The second collection is rejected before upload/readback because it
    // repeats the first verified source SHA. Do not leave an unused queued
    // reader result that can leak into the next test.
    vi.mocked(academicLibraryReader).mockResolvedValueOnce(first.read);
    const report = await uploadAcademicBatch([
      { key: "b4", prepare: async () => first.upload },
      { key: "b5", prepare: async () => second.upload },
    ]);
    expect(report).toMatchObject({
      expected: 2, processed: 2, verified: 1, failed: 1,
      verifiedReadyQuestions: 1, reviewRequired: 0,
    });
    expect(report.outcomes.map(outcome => outcome.state)).toEqual(["verified", "failed"]);
    expect(report.outcomes[1]).toMatchObject({ state: "failed", category: "validation" });
    expect(uploadAcademicCourse).toHaveBeenCalledTimes(1);
  });

  it("exports distinct bank, figure, and original evidence and rejects duplicate SHA claims", async () => {
    stubSuccessfulBrowserDecode();
    const f = await fixture({ withImage: true });
    session(f);
    const report = await uploadAcademicBatch([{ key: "ready-source", prepare: async () => f.upload }]);
    expect(academicReconciliationLedger(report)).toEqual({ sources: [{
      sha256: S, questionCount: 1, reviewCount: 0,
      bankReadbackVerified: true, ownerAuthenticated: true,
      figureReferences: 1, figureReadbackVerified: true,
      originalFileStatus: "not-provided", originalReadbackVerified: false,
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
