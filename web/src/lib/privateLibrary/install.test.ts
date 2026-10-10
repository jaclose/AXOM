// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { useStore } from "../store";
import { closeWorkspace, openEmptyWorkspace, reloadWorkspace } from "../question-content/persistenceHarness.testing";
import { sha256 } from "../question-content/assets";
import { bankFiles, folderLibraryReader, installPrivateLibrary, readCatalog, readPreparedBank, safeLibraryPath } from "./install";
import { PRIVATE_LIBRARY_FORMAT, PRIVATE_REVIEW_DOCUMENT, type PreparedBank, type PrivateLibraryCatalog } from "./types";
import { privateReviewMedia } from "./media";
import { collectQuestionAttachmentPayloads, deleteQuestionAttachmentBlobs, restoreQuestionAttachmentPayloads, runQuestionAttachmentMaintenance } from "../questionAttachments";
import { buildCourseBooks } from "../bookshelf/courseBooks";
import { withPreparedCourses, loadPreparedCourse } from "../bookshelf/preparedCourses";

const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
async function bundle() {
  const template = encode("T5 - DEMO - Lectures:\nWeek 1:\nLecture 01 Example topic [Lecture]");
  const checksum = (await sha256(template)).slice(7);
  const sourceHash = "a".repeat(64);
  const bank: PreparedBank = { pkg: { manifest: { schemaVersion: 1, course: { name: "DEMO", term: 5, week: 1 }, bank: { id: "sample", title: "Sample bank", discipline: "Example" }, source: { filename: "sample.txt", sourceWeekDeclared: true }, questionsFile: "questions.json", assetsDirectory: "assets" }, questions: [
    { id: "sample-1", source: { filename: "sample.txt", questionNumber: 1 }, stem: [{ type: "text", text: "Which sample is labeled first?" }], choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "Sample one" }] }, { id: "b", label: "B", blocks: [{ type: "text", text: "Sample two" }] }], correctAnswer: { labels: ["A"], evidence: "printed-key" }, assets: [], provenance: { method: "authored", sourceChecksum: `sha256:${sourceHash}` } },
  ] }, issues: [], sourceText: { rawText: "Original sample source." }, sourceBytes: 23, notes: [] };
  const catalog: PrivateLibraryCatalog = { format: PRIVATE_LIBRARY_FORMAT, schemaVersion: 1, id: "test", version: "one", templates: [{ file: "templates/test.txt", name: "test.txt", checksum }], sources: [{ id: "test-source", name: "sample.txt", sourcePath: "sample.txt", checksum: sourceHash, status: "prepared", reason: "Validated", ready: 1, review: 0, bankFile: "banks/test/bank.json" }] };
  const files = new Map([["catalog.json", encode(catalog)], ["templates/test.txt", template], ["banks/test/bank.json", encode(bank)]]);
  return { catalog, files, read: async (path: string) => { const file = files.get(path); if (!file) throw new Error("Missing file"); return file; } };
}
beforeEach(async () => { await openEmptyWorkspace(); vi.stubGlobal("Blob", NativeBlob); vi.stubGlobal("File", NativeFile); });
afterEach(closeWorkspace);
describe("prepared private library installation", () => {
  it("installs without enrolling, survives reload, and preserves progress on repeated installation and loading", async () => {
    const b = await bundle();
    const trackerBefore = useStore.getState().tracker.length;
    await installPrivateLibrary(b.read);
    await reloadWorkspace();
    expect(useStore.getState().tracker).toHaveLength(trackerBefore);
    expect(useStore.getState().questions).toHaveLength(1);
    const question = useStore.getState().questions[0];
    useStore.getState().updateQuestion(question.id, { notes: "My reasoning", tags: ["my-remediation"], stem: "My clarified question wording?" });
    const books = withPreparedCourses(buildCourseBooks({ terms: [], courses: [], tracker: [], curricula: [{ id: "demo", label: "Demo", terms: [{ name: "Term 5", courses: [{ code: "DEMO", name: "Demo course", modules: ["DEMO"] }] }] }] }), useStore.getState().documents);
    expect(books[0].weeks[0].total).toBe(1);
    await loadPreparedCourse(books[0]);
    const item = useStore.getState().tracker.find(t => t.templateKey)!;
    useStore.getState().updateTrackerItem(item.id, { passes: 2, label: "My personal title" });
    await installPrivateLibrary(b.read);
    await loadPreparedCourse(books[0]);
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
    await expect(installPrivateLibrary(b.read)).rejects.toThrow("another installation attempt");
    b.files.set("banks/test/bank.json", bank);
    await installPrivateLibrary(b.read);
    expect(useStore.getState().questions).toHaveLength(1);
  });
  it("refuses traversal and unsupported library versions", () => {
    for (const path of ["../secret", "/secret", "banks/../../secret", "banks\\secret"]) expect(() => safeLibraryPath(path)).toThrow();
    expect(() => readCatalog({ format: PRIVATE_LIBRARY_FORMAT, schemaVersion: 2 })).toThrow();
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
  it("reads only files inside the one browser-selected prepared folder", async () => {
    const file = new File(["catalog"], "catalog.json");
    Object.defineProperty(file, "webkitRelativePath", { value: "prepared/catalog.json" });
    const read = folderLibraryReader([file]);
    expect(new TextDecoder().decode(await read("catalog.json"))).toBe("catalog");
    await expect(read("../outside")).rejects.toThrow("Unsafe");
    await expect(read("banks/missing.json")).rejects.toThrow("Missing");
  });
});
