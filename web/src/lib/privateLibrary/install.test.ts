// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { useStore } from "../store";
import { closeWorkspace, openEmptyWorkspace, reloadWorkspace } from "../question-content/persistenceHarness.testing";
import { sha256 } from "../question-content/assets";
import { bankFiles, folderLibraryReader, installPrivateLibrary, mergeStoredReview, readCatalog, readPreparedBank, safeLibraryPath } from "./install";
import { PRIVATE_LIBRARY_DOCUMENT, PRIVATE_LIBRARY_FORMAT, PRIVATE_REVIEW_DOCUMENT, type PreparedBank, type PrivateLibraryCatalog } from "./types";
import { privateReviewMedia } from "./media";
import { collectQuestionAttachmentPayloads, deleteQuestionAttachmentBlobs, getQuestionAttachmentBlob, listQuestionAttachmentBlobKeys, restoreQuestionAttachmentPayloads, runQuestionAttachmentMaintenance } from "../questionAttachments";
import { buildCourseBooks } from "../bookshelf/courseBooks";
import { withPreparedCourses, loadPreparedCourse } from "../bookshelf/preparedCourses";
import { academicBindings, academicRecord } from "../academicLibrary/contentReferences";
import { CURRICULA } from "../curricula";

const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
async function bundle() {
  const template = encode("T5 - GOER - Lectures:\nWeek 1:\nLecture 01 Example topic [Lecture]");
  const checksum = (await sha256(template)).slice(7);
  const sourceHash = "a".repeat(64);
  const bank: PreparedBank = { pkg: { manifest: { schemaVersion: 1, course: { name: "GOER", term: 5, week: 1 }, bank: { id: "sample", title: "Sample bank", discipline: "Example" }, source: { filename: "sample.txt", sourceWeekDeclared: true }, questionsFile: "questions.json", assetsDirectory: "assets" }, questions: [
    { id: "sample-1", source: { filename: "sample.txt", questionNumber: 1 }, stem: [{ type: "text", text: "Which sample is labeled first?" }], choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "Sample one" }] }, { id: "b", label: "B", blocks: [{ type: "text", text: "Sample two" }] }], correctAnswer: { labels: ["A"], evidence: "printed-key" }, assets: [], provenance: { method: "authored", sourceChecksum: `sha256:${sourceHash}` } },
  ] }, issues: [], sourceText: { rawText: "Original sample source." }, sourceBytes: 23, notes: [] };
  const catalog: PrivateLibraryCatalog = { format: PRIVATE_LIBRARY_FORMAT, schemaVersion: 1, id: "test", version: "one", templates: [{ file: "templates/test.txt", name: "test.txt", checksum }], sources: [{ id: "test-source", name: "sample.txt", sourcePath: "sample.txt", checksum: sourceHash, status: "prepared", reason: "Validated", ready: 1, review: 0, bankFile: "banks/test/bank.json" }] };
  const files = new Map([["catalog.json", encode(catalog)], ["templates/test.txt", template], ["banks/test/bank.json", encode(bank)]]);
  return { catalog, files, read: async (path: string) => { const file = files.get(path); if (!file) throw new Error("Missing file"); return file; } };
}
function stubSuccessfulImageDecode(width = 1, height = 1) {
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close: vi.fn() })));
}
beforeEach(async () => { await openEmptyWorkspace(); vi.stubGlobal("Blob", NativeBlob); vi.stubGlobal("File", NativeFile); });
afterEach(async () => { await closeWorkspace(); vi.unstubAllGlobals(); });
describe("prepared private library installation", () => {
  it("binds original documents by their verified file checksum, never a filename match", async () => {
    const b = await bundle();
    const original = encode("Verified original document bytes.");
    const hash = (await sha256(original)).slice(7);
    b.catalog.sources = [{ ...b.catalog.sources[0], checksum: hash, bankFile: undefined, originalFile: "sources/original.txt", ready: 0 }];
    b.files.set("catalog.json", encode(b.catalog)); b.files.set("sources/original.txt", original);
    const installation = await installPrivateLibrary(b.read);
    const files = [{ path: "sources/original.txt", sha256: hash, mime_type: "text/plain" }];
    const bound = await academicBindings(useStore.getState(), installation, "11111111-1111-4111-8111-111111111111", files, b.files);
    expect(bound.originals).toEqual([{ documentId: `private-source-${hash}`, asset: { revisionId: "11111111-1111-4111-8111-111111111111", path: "sources/original.txt", sha256: hash } }]);
    expect((await academicBindings(useStore.getState(), installation, "11111111-1111-4111-8111-111111111111", [{ ...files[0], sha256: "f".repeat(64) }], b.files)).originals).toEqual([]);
  });
  it("binds canonical installed questions to immutable shared package content", async () => {
    const b = await bundle();
    const installation = await installPrivateLibrary(b.read);
    const files = await Promise.all([...b.files].map(async ([path, bytes]) => ({ path, sha256: (await sha256(bytes)).slice(7), mime_type: "application/json" })));
    const bound = await academicBindings(useStore.getState(), installation, "11111111-1111-4111-8111-111111111111", files, b.files);
    const question = useStore.getState().questions[0];
    const bank = readPreparedBank(JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json"))));
    const canonical = academicRecord(bank, { adapterVersion: 1, kind: "question", questionId: question.content!.id, reviewedAt: question.extraction!.reviewedAt, revisionId: "11111111-1111-4111-8111-111111111111", path: "banks/test/bank.json", sha256: "a".repeat(64) }) as Record<string, unknown>;
    const mismatch = ["content", "stem", "options", "correctKey", "correctAnswerText", "explanation", "choiceRationales", "analyses", "extraction", "citation"].filter(key => JSON.stringify((question as unknown as Record<string, unknown>)[key]) !== JSON.stringify(canonical[key]));
    expect(mismatch).toEqual([]);
    expect(bound.sources.filter(ref => ref.collection === "questions")).toHaveLength(1);
    const state = useStore.getState();
    const personal = { ...state, questions: [{ ...question, notes: "Private learner note", attempts: [] }] };
    expect((await academicBindings(personal, installation, "11111111-1111-4111-8111-111111111111", files, b.files)).sources.filter(ref => ref.collection === "questions")).toHaveLength(1);
    const edited = { ...personal, questions: [{ ...personal.questions[0], stem: "My corrected source wording" }] };
    expect((await academicBindings(edited, installation, "11111111-1111-4111-8111-111111111111", files, b.files)).sources.filter(ref => ref.collection === "questions")).toHaveLength(0);
  });
  it("does not join a different bundle or adopt delayed files after an account switch", async () => {
    const b = await bundle();
    let current = true;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const read = async (path: string) => { if (path === "templates/test.txt") await waiting; return b.read(path); };
    const pending = installPrivateLibrary(read, undefined, { key: "account-a", assertCurrent: () => { if (!current) throw new Error("Account changed"); } });
    await expect(installPrivateLibrary(b.read, undefined, { key: "account-b", assertCurrent: () => {} })).rejects.toThrow("Another library download");
    current = false; release();
    await expect(pending).rejects.toThrow("Account changed");
    expect(useStore.getState().questions).toHaveLength(0);
    expect(useStore.getState().documents).toHaveLength(0);
    await installPrivateLibrary(b.read);
    expect(useStore.getState().questions).toHaveLength(1);
  });
  it("installs without enrolling, survives reload, and preserves progress on repeated installation and loading", async () => {
    const b = await bundle();
    const trackerBefore = useStore.getState().tracker.length;
    await installPrivateLibrary(b.read);
    await reloadWorkspace();
    expect(useStore.getState().tracker).toHaveLength(trackerBefore);
    expect(useStore.getState().questions).toHaveLength(1);
    const question = useStore.getState().questions[0];
    useStore.getState().updateQuestion(question.id, { notes: "My reasoning", tags: ["my-remediation"], stem: "My clarified question wording?" });
    const books = withPreparedCourses(buildCourseBooks({ terms: [], courses: [], tracker: [], curricula: CURRICULA }), useStore.getState().documents);
    const book = books.find(candidate => candidate.courseCode === "PPM 501" && candidate.module === "GOER")!;
    expect(book.weeks[0].total).toBe(1);
    await expect(loadPreparedCourse(book)).resolves.toEqual({ status: "saved-on-device" });
    const item = useStore.getState().tracker.find(t => t.templateKey)!;
    useStore.getState().updateTrackerItem(item.id, { passes: 2, label: "My personal title" });
    await installPrivateLibrary(b.read);
    await expect(loadPreparedCourse(book)).resolves.toEqual({ status: "nothing-to-save" });
    await reloadWorkspace();
    expect(useStore.getState().questions).toHaveLength(1);
    expect(useStore.getState().questions[0].notes).toBe("My reasoning");
    expect(useStore.getState().questions[0].tags).toEqual(["my-remediation"]);
    expect(useStore.getState().questions[0].stem).toBe("My clarified question wording?");
    expect(useStore.getState().tracker.filter(t => t.templateKey)).toHaveLength(1);
    expect(useStore.getState().tracker.find(t => t.id === item.id)).toMatchObject({ passes: 2, label: "My personal title" });
  });
  it("rejects damaged templates before declaring installation complete, and resumes missing banks", async () => {
    const b = await bundle();
    const original = b.files.get("templates/test.txt")!;
    b.files.set("templates/test.txt", encode("damaged"));
    await expect(installPrivateLibrary(b.read)).rejects.toThrow("integrity");
    expect(useStore.getState().questions).toHaveLength(0);
    b.files.set("templates/test.txt", original);
    const bank = b.files.get("banks/test/bank.json")!;
    b.files.delete("banks/test/bank.json");
    const partial = await installPrivateLibrary(b.read);
    expect(partial).toMatchObject({ status: "partial", questionIds: [] });
    expect(partial.warnings.join(" ")).toMatch(/Missing file/);
    const partialCatalog = useStore.getState().documents.find(document => document.fileType === PRIVATE_LIBRARY_DOCUMENT);
    expect(partialCatalog).toBeTruthy();
    expect(JSON.parse(partialCatalog!.rawText).sources[0]).toMatchObject({ status: "failed", ready: 0 });
    b.files.set("banks/test/bank.json", bank);
    await expect(installPrivateLibrary(b.read)).resolves.toMatchObject({ status: "complete", warnings: [] });
    expect(useStore.getState().questions).toHaveLength(1);
  });
  it("returns a partial receipt with every durable question when a reused filing needs retry", async () => {
    const b = await bundle();
    await expect(installPrivateLibrary(b.read)).resolves.toMatchObject({ status: "complete", questionIds: [expect.any(String)] });
    const bank = JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)) as PreparedBank;
    const released = structuredClone(bank.pkg.questions[0]);
    released.id = "sample-2";
    released.source.questionNumber = 2;
    released.stem = [{ type: "text", text: "Which sample is labeled second?" }];
    bank.pkg.questions.push(released);
    const reviewedBank: PreparedBank = {
      ...bank,
      reviewedFiling: { term: "Term 5", module: "GOER", evidence: "human-reviewed", weekAssignment: "unassigned" },
    };
    b.catalog.sources[0].ready = 2;
    b.files.set("catalog.json", encode(b.catalog));
    b.files.set("banks/test/bank.json", encode(reviewedBank));

    const commitReviewedRefiling = useStore.getState().commitReviewedRefiling;
    const refused = vi.fn(async () => ({ ok: false as const, message: "Synthetic reviewed filing failure", rollbackFailures: [] }));
    useStore.setState({ commitReviewedRefiling: refused });
    let partial: Awaited<ReturnType<typeof installPrivateLibrary>>;
    try {
      partial = await installPrivateLibrary(b.read);
    } finally {
      useStore.setState({ commitReviewedRefiling });
    }

    expect(refused).toHaveBeenCalledTimes(1);
    expect(partial).toMatchObject({ status: "partial" });
    expect(partial.questionIds).toHaveLength(2);
    expect(partial.setIds).toHaveLength(2);
    expect(partial.warnings.join(" ")).toMatch(/2 answer-ready questions remain saved.*Synthetic reviewed filing failure/);
    const questions = useStore.getState().questions;
    expect(questions).toHaveLength(2);
    expect(questions.find(question => question.content?.id === "sample-1")).toMatchObject({ module: "GOER", week: 1 });
    expect(questions.find(question => question.content?.id === "sample-2")).toMatchObject({ module: "GOER", week: undefined });
    const catalog = useStore.getState().documents.find(document => document.fileType === PRIVATE_LIBRARY_DOCUMENT);
    expect(JSON.parse(catalog!.rawText).sources[0]).toMatchObject({ status: "review-required", ready: 2 });
  });
  it("refuses traversal and unsupported library versions", () => {
    for (const path of ["../secret", "/secret", "banks/../../secret", "banks\\secret"]) expect(() => safeLibraryPath(path)).toThrow();
    expect(() => readCatalog({ format: PRIVATE_LIBRARY_FORMAT, schemaVersion: 2 })).toThrow();
  });
  it("accepts only an exact immutable reviewed filing envelope", async () => {
    const b = await bundle();
    const original = JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)) as Record<string, unknown>;
    const valid = readPreparedBank({ ...original, reviewedFiling: {
      term: "Term 5", module: "GOER", evidence: "human-reviewed", weekAssignment: "unassigned",
    } });
    expect(valid.reviewedFiling).toEqual({
      term: "Term 5", module: "GOER", evidence: "human-reviewed", weekAssignment: "unassigned",
    });
    expect(Object.isFrozen(valid.reviewedFiling)).toBe(true);

    expect(readPreparedBank({ ...original, reviewedFiling: {
      term: "Term 5", module: "GOER", evidence: "source-metadata", weekAssignment: "unassigned",
    } }).reviewedFiling?.module).toBe("GOER");

    for (const module of ["FTM-1", "PRE-MIDTERM"]) {
      const matching = structuredClone(original) as { pkg: PreparedBank["pkg"] } & Record<string, unknown>;
      matching.pkg.manifest.course.name = module;
      expect(readPreparedBank({ ...matching, reviewedFiling: {
        term: "Term 5", module, evidence: "source-metadata", weekAssignment: "unassigned",
      } }).reviewedFiling?.module).toBe(module);
    }

    const base = { term: "Term 5", module: "GOER", evidence: "source-metadata", weekAssignment: "unassigned" };
    for (const reviewedFiling of [
      { ...base, term: "Term 0" },
      { ...base, module: " GOER" },
      { ...base, module: "GOER/ER" },
      { ...base, module: "GOER\nER", evidence: "human-reviewed" },
      { ...base, module: "A".repeat(81) },
      { ...base, evidence: "filename-inference" },
      { ...base, weekAssignment: 2 },
      { ...base, week: 2 },
      { ...base, title: "unexpected field" },
    ]) expect(() => readPreparedBank({ ...original, reviewedFiling })).toThrow("invalid reviewed filing");

    expect(() => readPreparedBank({ ...original, reviewedFiling: { ...base, module: "ER" } })).toThrow("must agree");
    const mixed = structuredClone(original) as { pkg: PreparedBank["pkg"] } & Record<string, unknown>;
    mixed.pkg.questions[0].course = "ER";
    expect(() => readPreparedBank({ ...mixed, reviewedFiling: {
      term: "Term 5", module: "GOER", evidence: "human-reviewed", weekAssignment: "unassigned",
    } })).toThrow("cannot collapse several original modules or terms");
  });
  it("preserves only reviewer-editable content while adopting corrected source metadata", async () => {
    const b = await bundle();
    const incoming = readPreparedBank(JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)));
    const stored = structuredClone(incoming);
    const reviewed = stored.pkg.questions[0];
    reviewed.stem = [{ type: "text", text: "Which sample did the reviewer confirm first?" }];
    reviewed.correctAnswer = { labels: ["B"], evidence: "reviewer" };
    reviewed.flags = [{ type: "answer_needs_review", message: "Stale review flag" }];
    reviewed.assets = [{ id: "old-figure", filename: "old.png", mimeType: "image/png", role: "reference", questionId: reviewed.id,
      checksum: `sha256:${"b".repeat(64)}` }];

    const corrected = structuredClone(incoming);
    corrected.pkg.questions[0].source.page = 7;
    corrected.pkg.questions[0].assets = [{ id: "corrected-figure", filename: "corrected.png", mimeType: "image/png", role: "source_page",
      questionId: reviewed.id, sourcePage: 7, checksum: `sha256:${"c".repeat(64)}` }];
    corrected.pkg.questions[0].flags = [{ type: "source_inconsistency", message: "Correction retained as source evidence." }];

    const merged = mergeStoredReview(corrected, stored, `sha256:${"a".repeat(64)}`);
    expect(merged.pkg.questions[0].stem).toEqual(reviewed.stem);
    expect(merged.pkg.questions[0].correctAnswer).toEqual({ labels: ["B"], evidence: "reviewer" });
    expect(merged.pkg.questions[0].source.page).toBe(7);
    expect(merged.pkg.questions[0].assets).toEqual(corrected.pkg.questions[0].assets);
    expect(merged.pkg.questions[0].flags).toEqual(corrected.pkg.questions[0].flags);
  });
  it("refuses to overlay saved review work without one valid matching source checksum", async () => {
    const b = await bundle();
    const incoming = readPreparedBank(JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)));
    const missing = structuredClone(incoming);
    delete missing.pkg.questions[0].provenance.sourceChecksum;
    expect(() => mergeStoredReview(missing, missing)).toThrow("conflicts with saved local review work");

    const changed = structuredClone(incoming);
    changed.pkg.questions[0].provenance.sourceChecksum = `sha256:${"d".repeat(64)}`;
    expect(() => mergeStoredReview(changed, incoming, `sha256:${"a".repeat(64)}`)).toThrow("conflicts with saved local review work");
  });
  it("takes refreshed filing only from the incoming verified package", async () => {
    const b = await bundle();
    const plain = readPreparedBank(JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)));
    const stored = readPreparedBank({ ...structuredClone(plain), reviewedFiling: {
      term: "Term 5", module: "GOER", evidence: "human-reviewed", weekAssignment: "unassigned",
    } });
    expect(mergeStoredReview(plain, stored, `sha256:${"a".repeat(64)}`).reviewedFiling).toBeUndefined();

    const refreshed = readPreparedBank({ ...structuredClone(plain), reviewedFiling: {
      term: "Term 5", module: "PRE-MIDTERM", evidence: "human-reviewed", weekAssignment: "unassigned",
    } });
    expect(mergeStoredReview(refreshed, stored, `sha256:${"a".repeat(64)}`).reviewedFiling)
      .toEqual(refreshed.reviewedFiling);
  });
  it("keeps unreadable rows review-gated without withholding readable siblings", async () => {
    const b = await bundle();
    const bank = JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json"))) as PreparedBank;
    bank.pkg.questions.push({ ...bank.pkg.questions[0], id: "broken-row", stem: [] });
    const parsed = readPreparedBank(bank);
    expect(parsed.pkg.questions).toHaveLength(1);
    expect(parsed.unreadableQuestions).toBe(1);
    expect(parsed.issues).toEqual(expect.arrayContaining([expect.objectContaining({ questionId: "broken-row", severity: "error" })]));
  });
  it("retains held images across reload and the existing portable media export/restore path", async () => {
    stubSuccessfulImageDecode();
    const b = await bundle();
    const bank = JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json"))) as PreparedBank;
    const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
    const checksum = await sha256(png);
    const held = structuredClone(bank.pkg.questions[0]);
    held.id = "held"; held.source.questionNumber = 2; held.correctAnswer = { labels: [] };
    held.assets = [{ id: "figure", filename: "figure.png", mimeType: "image/png", role: "question", questionId: "held", checksum }];
    held.stem.push({ type: "image", assetId: "figure", role: "question", alt: "Sample figure" });
    bank.pkg.questions.push(held);
    b.files.set("banks/test/bank.json", encode(bank)); b.files.set("banks/test/assets/figure.png", png);
    await installPrivateLibrary(b.read); await reloadWorkspace();
    expect(useStore.getState().questions).toHaveLength(1);
    const refs = privateReviewMedia(useStore.getState().documents);
    const collected = await collectQuestionAttachmentPayloads(refs);
    expect(collected.missingBlobKeys).toEqual([]); expect(collected.payloads).toHaveLength(1);
    await runQuestionAttachmentMaintenance(refs);
    await deleteQuestionAttachmentBlobs([`private-library:${checksum}`]);
    expect((await restoreQuestionAttachmentPayloads(collected.payloads, refs)).restored).toBe(1);
    const doc = useStore.getState().documents.find(d => d.fileType === PRIVATE_REVIEW_DOCUMENT)!;
    expect(await bankFiles(readPreparedBank(JSON.parse(doc.rawText)))).toHaveLength(1);
  });
  it("keeps answer-ready siblings when corrupt media belongs only to a held question", async () => {
    const b = await bundle();
    const bank = JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)) as PreparedBank;
    const corrupt = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
    const checksum = await sha256(corrupt);
    const held = structuredClone(bank.pkg.questions[0]);
    held.id = "held-corrupt-media";
    held.source.questionNumber = 2;
    delete held.correctAnswer;
    held.flags = [{ type: "answer_needs_review", message: "Confirm the answer against the original source." }];
    held.assets = [{
      id: "held-corrupt-figure", filename: "held-corrupt.png", mimeType: "image/png",
      role: "question", questionId: held.id, checksum,
    }];
    held.stem.push({ type: "image", assetId: "held-corrupt-figure", role: "question", alt: "Held source figure" });
    bank.pkg.questions.push(held);
    b.catalog.sources[0] = { ...b.catalog.sources[0], review: 1 };
    b.files.set("catalog.json", encode(b.catalog));
    b.files.set("banks/test/bank.json", encode(bank));
    b.files.set("banks/test/assets/held-corrupt.png", corrupt);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("decoder rejected corrupt bytes"); }));
    await deleteQuestionAttachmentBlobs([`private-library:${checksum}`]);

    const result = await installPrivateLibrary(b.read);

    expect(result).toMatchObject({ status: "partial" });
    expect(result.questionIds).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/held-corrupt\.png.*review/i);
    expect(useStore.getState().questions).toHaveLength(1);
    expect(useStore.getState().questions[0].content?.id).toBe("sample-1");
    expect(await getQuestionAttachmentBlob(`private-library:${checksum}`)).toBeUndefined();
    const catalog = useStore.getState().documents.find(document => document.fileType === PRIVATE_LIBRARY_DOCUMENT)!;
    expect(JSON.parse(catalog.rawText).sources[0]).toMatchObject({ status: "review-required", ready: 1, review: 1 });
    const review = useStore.getState().documents.find(document => document.fileType === PRIVATE_REVIEW_DOCUMENT)!;
    expect(JSON.parse(review.rawText).pkg.questions.find((question: { id: string }) => question.id === held.id)?.assets)
      .toEqual(held.assets);
    expect(JSON.parse(review.rawText).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: held.id, severity: "error", code: "missing_required_media" }),
    ]));
  });
  it("still rejects corrupt media required by an answer-ready question", async () => {
    const b = await bundle();
    const bank = JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)) as PreparedBank;
    const corrupt = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
    const checksum = await sha256(corrupt);
    bank.pkg.questions[0].assets = [{
      id: "ready-corrupt-figure", filename: "ready-corrupt.png", mimeType: "image/png",
      role: "question", questionId: "sample-1", checksum,
    }];
    bank.pkg.questions[0].stem.push({ type: "image", assetId: "ready-corrupt-figure", role: "question", alt: "Required source figure" });
    b.files.set("banks/test/bank.json", encode(bank));
    b.files.set("banks/test/assets/ready-corrupt.png", corrupt);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("decoder rejected corrupt bytes"); }));
    await deleteQuestionAttachmentBlobs([`private-library:${checksum}`]);

    const result = await installPrivateLibrary(b.read);

    expect(result).toMatchObject({ status: "partial", questionIds: [] });
    expect(result.warnings.join(" ")).toMatch(/integrity[^.]*: ready-corrupt\.png/i);
    expect(useStore.getState().questions).toHaveLength(0);
    expect(await getQuestionAttachmentBlob(`private-library:${checksum}`)).toBeUndefined();
    const catalog = useStore.getState().documents.find(document => document.fileType === PRIVATE_LIBRARY_DOCUMENT)!;
    expect(JSON.parse(catalog.rawText).sources[0]).toMatchObject({ status: "failed", ready: 0 });
  });
  it("reads only files inside the one browser-selected prepared folder", async () => {
    const file = new File(["catalog"], "catalog.json");
    Object.defineProperty(file, "webkitRelativePath", { value: "prepared/catalog.json" });
    const read = folderLibraryReader([file]);
    expect(new TextDecoder().decode(await read("catalog.json"))).toBe("catalog");
    await expect(read("../outside")).rejects.toThrow("Unsafe");
    await expect(read("banks/missing.json")).rejects.toThrow("Missing");
  });
});

describe("shared image identity in prepared libraries", () => {
  it("resolves root-level bank media beside bank.json", async () => {
    stubSuccessfulImageDecode();
    const b = await bundle();
    const bank = JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)) as PreparedBank;
    const png = new Uint8Array([
      137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,
    ]);
    const checksum = await sha256(png);
    bank.pkg.questions[0].assets = [{
      id: "root-figure", filename: "root-figure.png", mimeType: "image/png",
      role: "question", questionId: "sample-1", checksum,
    }];
    const read = vi.fn(async (path: string) => {
      expect(path).toBe("assets/root-figure.png");
      return png;
    });

    const files = await bankFiles(bank, read, "bank.json");

    expect(files.map(file => file.name)).toEqual(["root-figure.png"]);
    expect(read).toHaveBeenCalledOnce();
  });

  it("materializes a reused source-page image once even when question-local asset IDs differ", async () => {
    stubSuccessfulImageDecode();
    const b = await bundle();
    const bank = JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)) as PreparedBank;
    const png = new Uint8Array([
      137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,
    ]);
    const checksum = await sha256(png);
    const asset = {
      id: "source-page-first", filename: "shared-source-page.png", mimeType: "image/png",
      role: "source_page" as const, questionId: "sample-1", checksum,
    };
    const question = bank.pkg.questions[0];
    bank.pkg.questions = [
      { ...question, assets: [{ ...asset }] },
      { ...question, id: "sample-2", assets: [{ ...asset, id: "source-page-second", questionId: "sample-2" }] },
    ];
    let assetReads = 0;
    const read = async (path: string) => {
      expect(path).toBe("banks/test/assets/shared-source-page.png");
      assetReads += 1;
      return png;
    };
    const files = await bankFiles(bank, read, "banks/test/prepared-bank.json");
    expect(files.map(file => file.name)).toEqual(["shared-source-page.png"]);
    expect(assetReads).toBe(1);
    // A second question may attach the SAME source bytes using its own ID.
    const { matchNamedImages } = await import("../questionImportImages");
    expect(matchNamedImages(["shared-source-page.png"], files)[0].file).toBe(files[0]);
    const conflicting = structuredClone(bank);
    conflicting.pkg.questions[1].assets[0].checksum = "sha256:" + "f".repeat(64);
    await expect(bankFiles(conflicting, read, "banks/test/prepared-bank.json"))
      .rejects.toThrow(/two different images are named/i);
  });

  it("installs shared verified bytes once while retaining attachment metadata for both ready questions", async () => {
    stubSuccessfulImageDecode();
    const b = await bundle();
    const bank = JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)) as PreparedBank;
    const png = new Uint8Array([
      137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,
    ]);
    const checksum = await sha256(png);
    const blobKey = `private-library:${checksum}`;
    const first = bank.pkg.questions[0];
    const sharedAsset = {
      id: "shared-page-one", filename: "shared-page.png", mimeType: "image/png",
      role: "source_page" as const, questionId: first.id, checksum,
      byteSize: png.byteLength, width: 1, height: 1,
    };
    bank.pkg.questions = [
      { ...first, stem: [...first.stem, { type: "image", assetId: sharedAsset.id, role: "source_page" }], assets: [sharedAsset] },
      {
        ...structuredClone(first),
        id: "sample-2",
        source: { ...first.source, questionNumber: 2 },
        stem: [
          { type: "text", text: "Which sample is labeled second?" },
          { type: "image", assetId: "shared-page-two", role: "source_page" },
        ],
        assets: [{ ...sharedAsset, id: "shared-page-two", questionId: "sample-2" }],
      },
    ];
    b.catalog.sources[0].ready = 2;
    b.files.set("catalog.json", encode(b.catalog));
    b.files.set("banks/test/bank.json", encode(bank));
    b.files.set("banks/test/assets/shared-page.png", png);
    await deleteQuestionAttachmentBlobs([blobKey]);
    try {
      await installPrivateLibrary(b.read);
      await reloadWorkspace();
      const questions = useStore.getState().questions;
      expect(questions).toHaveLength(2);
      const attachments = questions.flatMap((question) => question.attachments ?? []);
      expect(attachments).toHaveLength(2);
      expect(new Set(attachments.map((attachment) => attachment.id)).size).toBe(2);
      expect(new Set(attachments.map((attachment) => attachment.blobKey))).toEqual(new Set([blobKey]));
      expect((await listQuestionAttachmentBlobKeys()).filter((key) => key === blobKey)).toEqual([blobKey]);
      expect(await getQuestionAttachmentBlob(blobKey)).toMatchObject({ byteSize: png.byteLength, mimeType: "image/png" });

      const backup = await collectQuestionAttachmentPayloads(questions, { localOnly: true });
      expect(backup.missingBlobKeys).toEqual([]);
      expect(backup.payloads).toHaveLength(2);
      await deleteQuestionAttachmentBlobs([blobKey]);
      expect((await restoreQuestionAttachmentPayloads(backup.payloads, questions)).restored).toBeGreaterThanOrEqual(1);
      expect((await getQuestionAttachmentBlob(attachments[0].blobKey))?.byteSize).toBe(png.byteLength);
      expect((await getQuestionAttachmentBlob(attachments[1].blobKey))?.byteSize).toBe(png.byteLength);

      const [removed, survivor] = questions;
      useStore.getState().removeQuestion(removed.id);
      await reloadWorkspace();
      expect(useStore.getState().questions.map((question) => question.id)).toEqual([survivor.id]);
      expect(useStore.getState().questions[0].attachments?.[0].blobKey).toBe(blobKey);
      expect((await getQuestionAttachmentBlob(blobKey, { localOnly: true }))?.byteSize).toBe(png.byteLength);
    } finally {
      await deleteQuestionAttachmentBlobs([blobKey]);
    }
  });

  const gifHeader = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64")).subarray(0, 12);
  const jpegHeader = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 1, 0, 1, 0]);
  const webpHeader = new Uint8Array(30);
  webpHeader.set(Buffer.from("RIFF"), 0);
  webpHeader.set(Buffer.from("WEBP"), 8);
  webpHeader.set(Buffer.from("VP8X"), 12);

  it.each([
    { name: "GIF", mimeType: "image/gif" as const, bytes: gifHeader },
    { name: "JPEG", mimeType: "image/jpeg" as const, bytes: jpegHeader },
    { name: "WebP", mimeType: "image/webp" as const, bytes: webpHeader },
  ])("rejects header-only $name bytes without persisting them", async ({ mimeType, bytes }) => {
    const b = await bundle();
    const bank = JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)) as PreparedBank;
    const checksum = await sha256(bytes);
    const filename = `header.${mimeType.split("/")[1]}`;
    bank.pkg.questions[0].assets = [{
      id: "broken-header", filename, mimeType, role: "question", questionId: "sample-1", checksum,
    }];
    b.files.set(`banks/test/assets/${filename}`, bytes);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("decoder refused header-only bytes"); }));
    await deleteQuestionAttachmentBlobs([`private-library:${checksum}`]);

    await expect(bankFiles(bank, b.read, "banks/test/bank.json")).rejects.toThrow(/integrity check failed/i);
    expect(await getQuestionAttachmentBlob(`private-library:${checksum}`)).toBeUndefined();
  });

  it("validates every image before persisting the first attachment", async () => {
    const b = await bundle();
    const bank = JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)) as PreparedBank;
    const png = new Uint8Array([
      137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,
    ]);
    const pngChecksum = await sha256(png);
    const brokenChecksum = await sha256(jpegHeader);
    bank.pkg.questions[0].assets = [
      { id: "valid-first", filename: "valid.png", mimeType: "image/png", role: "question", questionId: "sample-1", checksum: pngChecksum },
      { id: "broken-second", filename: "broken.jpg", mimeType: "image/jpeg", role: "question", questionId: "sample-1", checksum: brokenChecksum },
    ];
    b.files.set("banks/test/assets/valid.png", png);
    b.files.set("banks/test/assets/broken.jpg", jpegHeader);
    vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob) => {
      if (blob.type === "image/jpeg") throw new Error("decoder refused header-only bytes");
      return { width: 1, height: 1, close: vi.fn() };
    }));
    await deleteQuestionAttachmentBlobs([`private-library:${pngChecksum}`, `private-library:${brokenChecksum}`]);

    await expect(bankFiles(bank, b.read, "banks/test/bank.json")).rejects.toThrow(/broken\.jpg/i);
    expect(await getQuestionAttachmentBlob(`private-library:${pngChecksum}`)).toBeUndefined();
    expect(await getQuestionAttachmentBlob(`private-library:${brokenChecksum}`)).toBeUndefined();
  });

  it("rejects decoded or declared image dimensions that disagree with verified bytes", async () => {
    const b = await bundle();
    const bank = JSON.parse(new TextDecoder().decode(b.files.get("banks/test/bank.json")!)) as PreparedBank;
    const png = new Uint8Array([
      137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,
    ]);
    const checksum = await sha256(png);
    bank.pkg.questions[0].assets = [{
      id: "mismatch", filename: "mismatch.png", mimeType: "image/png", role: "question",
      questionId: "sample-1", checksum, width: 2, height: 1,
    }];
    b.files.set("banks/test/assets/mismatch.png", png);
    stubSuccessfulImageDecode(1, 1);
    await deleteQuestionAttachmentBlobs([`private-library:${checksum}`]);
    await expect(bankFiles(bank, b.read, "banks/test/bank.json")).rejects.toThrow(/dimensions do not match/i);
    expect(await getQuestionAttachmentBlob(`private-library:${checksum}`)).toBeUndefined();

    delete bank.pkg.questions[0].assets[0].width;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2, height: 1, close: vi.fn() })));
    await expect(bankFiles(bank, b.read, "banks/test/bank.json")).rejects.toThrow(/fully decoded/i);
    expect(await getQuestionAttachmentBlob(`private-library:${checksum}`)).toBeUndefined();
  });
});
