// @vitest-environment jsdom
// A package, saved by the code every import is saved by, into the real
// workspace store: filed, linked to its pictures, read back, and not written
// twice. The content is the invented fixture.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteQuestionAttachmentBlobs, getQuestionAttachmentBlob } from "../questionAttachments";
import type { ReviewedImportStore } from "../questionImportSave";
import { saveBank } from "./bankImport";
import { parsePackage } from "./packageJson";
import { closeWorkspace, importPackage, openEmptyWorkspace, realWorkspace, reloadWorkspace, storedImageCount, workspaceOnDisk } from "./persistenceHarness.testing";
import type { ImportPackage, PackageIssue } from "./package";
import { packageToReviewedImport } from "./toReviewedImport";
import { validatePackage } from "./validate";
import { isAssetVisible } from "./visibility";

const folder = join(process.cwd(), "..", "fixtures", "qbank", "synthetic", "multimodal-shapes");
const SOURCE_TEXT = { rawText: "The invented source, as it was read.", pageTexts: ["The invented source,", "as it was read."] };

function invented(): { pkg: ImportPackage; issues: PackageIssue[]; files: File[] } {
  const parsed = parsePackage(readFileSync(join(folder, "manifest.json"), "utf8"), readFileSync(join(folder, "questions.json"), "utf8"));
  const names = readdirSync(join(folder, "assets")).filter((name) => name.endsWith(".png"));
  const pkg = parsed.package!;
  for (const question of pkg.questions) question.provenance.sourceChecksum = "sha256:invented";
  return {
    pkg,
    issues: [...parsed.issues, ...validatePackage(pkg, { assetFiles: new Set(names) })],
    files: names.map((name) => new File([new Uint8Array(readFileSync(join(folder, "assets", name)))], name, { type: "image/png" })),
  };
}

/** The first four invented questions as two sets of one source, each numbered 1 and 2. */
function twoSets(): { pkg: ImportPackage; issues: PackageIssue[]; files: File[] } {
  const { pkg, files } = invented();
  const questions = pkg.questions.filter((question) => ["syn-q01", "syn-q02", "syn-q04", "syn-q05"].includes(question.id)).map((question, index) => ({
    ...question,
    source: { ...question.source, questionNumber: (index % 2) + 1, set: index < 2 ? 1 : 2, setTitle: index < 2 ? "Cardiology" : "Renal physiology" },
  }));
  const split = { ...pkg, questions };
  return { pkg: split, issues: validatePackage(split, { assetFiles: new Set(files.map((file) => file.name)) }), files };
}

beforeEach(openEmptyWorkspace);
afterEach(closeWorkspace);

describe("what a package offers to the canonical import", () => {
  it("offers only the ready questions, and says why each other one is held", () => {
    const { pkg, issues } = invented();
    const adapted = packageToReviewedImport(pkg, issues);
    expect(adapted.imports).toHaveLength(1);
    expect(adapted.imports[0].questionIds).toEqual(["syn-q01", "syn-q02", "syn-q04", "syn-q05", "syn-q06", "syn-q07"]);
    expect(adapted.held).toEqual([
      // Its key was read from the slide that marks the answer: evidence, not a printed key.
      { questionId: "syn-q03", readiness: "needs-review", reasons: [expect.stringContaining("slide that marks the answer")] },
      // Its source disagrees with itself.
      { questionId: "syn-q08", readiness: "needs-review", reasons: [expect.any(String)] },
    ]);
    expect(adapted.imports[0].request).toMatchObject({ scope: { module: "EXAMPLE", week: 1 }, destination: "set", setTitle: "Invented multimodal shapes" });
  });

  it("takes a question that needs review only once a person has accepted it, and retains restricted pictures for post-answer review", () => {
    const { pkg, issues } = invented();
    const adapted = packageToReviewedImport(pkg, issues, { acknowledged: new Set(["syn-q03"]) });
    const [section] = adapted.imports;
    expect(section.questionIds).toContain("syn-q03");
    const draft = section.request.drafts[section.questionIds.indexOf("syn-q03")];
    expect(draft.reviewAcknowledged).toBe(true);
    expect(draft.warnings).toEqual([expect.stringContaining("slide that marks the answer")]);
    expect(draft.attachmentNames).toEqual(["syn-q03-curves.png", "syn-q03-curves-answer.png"]);
    expect(section.imageNames).toEqual(["syn-q03-curves.png", "syn-q03-curves-answer.png", "syn-q04-micrograph.png", "syn-q07-field-left.png", "syn-q07-field-right.png"]);
    expect(adapted.withheldAssets).toEqual([]);
    expect(draft.content?.assets.find((asset) => asset.role === "answer_reveal")).toBeDefined();
  });

  it("never takes a question with no key, accepted or not", () => {
    const { pkg, issues } = invented();
    const unkeyed = { ...pkg, questions: pkg.questions.map((question) => (question.id === "syn-q02" ? { ...question, correctAnswer: undefined, flags: [{ type: "answer_needs_review" as const, message: "The answer is only shown by a mark." }] } : question)) };
    const adapted = packageToReviewedImport(unkeyed, issues, { acknowledged: new Set(["syn-q02"]) });
    expect(adapted.imports[0].questionIds).not.toContain("syn-q02");
    expect(adapted.held.find((entry) => entry.questionId === "syn-q02")).toEqual({ questionId: "syn-q02", readiness: "needs-review", reasons: ["The answer is only shown by a mark."] });
  });

  it("lets an advisory note travel with a ready question without marking it as reviewed by hand", () => {
    const { pkg, issues } = invented();
    const noted = { ...pkg, questions: pkg.questions.map((question) => (question.id === "syn-q01" ? { ...question, flags: [{ type: "possible_duplicate" as const, message: "It reads like another question in the bank." }] } : question)) };
    const [section] = packageToReviewedImport(noted, issues).imports;
    const draft = section.request.drafts[section.questionIds.indexOf("syn-q01")];
    expect(draft.warnings).toContain("It reads like another question in the bank.");
    expect(draft.reviewAcknowledged).toBeUndefined();
  });
});

describe("a source that holds more than one set of questions", () => {
  it("is one request for each set, and every question keeps the number its source gave it", () => {
    const { pkg, issues } = twoSets();
    const adapted = packageToReviewedImport(pkg, issues);
    expect(adapted.imports.map((section) => [section.set, section.title, section.request.setTitle, section.questionIds])).toEqual([
      [1, "Cardiology", "Invented multimodal shapes: set 1 (Cardiology)", ["syn-q01", "syn-q02"]],
      [2, "Renal physiology", "Invented multimodal shapes: set 2 (Renal physiology)", ["syn-q04", "syn-q05"]],
    ]);
    expect(adapted.imports.map((section) => section.request.drafts.map((draft) => draft.questionNumber))).toEqual([[1, 2], [1, 2]]);
    expect(adapted.imports[1].request.drafts[0].sourceLabel).toBe("invented.pdf, set 2 (Renal physiology), question 1");
    // One source: both requests name the same file and the same checksum.
    expect(new Set(adapted.imports.map((section) => `${section.request.document?.fileName}|${section.request.document?.checksum}`)).size).toBe(1);
  });

  it("holds two questions of one set that share a number, since the number no longer says which is which", () => {
    const { pkg, issues } = twoSets();
    const clash = { ...pkg, questions: pkg.questions.map((question) => (question.id === "syn-q02" ? { ...question, source: { ...question.source, questionNumber: 1 } } : question)) };
    const adapted = packageToReviewedImport(clash, issues, { acknowledged: new Set(["syn-q01", "syn-q02"]) });
    expect(adapted.imports.map((section) => section.questionIds)).toEqual([["syn-q04", "syn-q05"]]);
    expect(adapted.held.map((entry) => [entry.questionId, entry.readiness])).toEqual([["syn-q01", "needs-review"], ["syn-q02", "needs-review"]]);
    expect(adapted.held[0].reasons).toEqual([expect.stringContaining("also has the number 1")]);
  });

  it("saves each set on its own, tied to one record of the source, with nothing written twice", async () => {
    const { pkg, issues, files } = twoSets();
    const saved = await importPackage(pkg, issues, files, { sourceText: SOURCE_TEXT, sourceBytes: 4321 });
    expect(saved).toMatchObject({ status: "saved", errors: [] });
    expect(saved.sections.map((section) => [section.set, section.reused, section.savedIds.length])).toEqual([[1, false, 2], [2, false, 2]]);

    const disk = await workspaceOnDisk();
    expect(disk.documents).toHaveLength(1);
    const [source] = disk.documents;
    expect(source).toMatchObject({ fileName: "invented.pdf", checksum: "sha256:invented", sizeBytes: 4321, rawText: SOURCE_TEXT.rawText, libraryOnly: false });
    expect([...source.linkedQuestionSetIds].sort()).toEqual(saved.sections.map((section) => section.setId!).sort());
    expect(disk.questionSets).toHaveLength(2);
    for (const section of saved.sections) {
      const set = disk.questionSets.find((entry) => entry.id === section.setId)!;
      expect(set).toMatchObject({ title: section.setTitle, scope: { module: "EXAMPLE", week: 1 }, sourceDocumentIds: [source.id], questionIds: section.savedIds });
      const numbers = section.savedIds.map((id) => disk.questions.find((question) => question.id === id)!.questionNumber);
      expect(numbers).toEqual([1, 2]);
    }
    expect(disk.questions.every((question) => question.sourceDocumentId === source.id)).toBe(true);
    // One picture, on the first question of the second set.
    expect(saved.sections[1].images).toEqual({ attached: 1, missing: 0, problems: [] });

    const again = await importPackage(pkg, issues, files, { sourceText: SOURCE_TEXT, sourceBytes: 4321 });
    expect(again.status).toBe("already-saved");
    expect(again.sections.map((section) => section.setId)).toEqual(saved.sections.map((section) => section.setId));
    const after = await workspaceOnDisk();
    expect([after.documents.length, after.questionSets.length, after.questions.length, await storedImageCount()]).toEqual([1, 2, 4, 1]);
  });
});

describe("a package through the canonical import", () => {
  it("saves the ready questions as one set, filed where the manifest says, with their pictures", async () => {
    const { pkg, issues, files } = invented();
    const saved = await importPackage(pkg, issues, files);
    expect(saved).toMatchObject({ status: "saved", errors: [] });
    const [section] = saved.sections;
    expect(section.images).toEqual({ attached: 3, missing: 0, problems: [] });

    const disk = await workspaceOnDisk();
    expect(disk.questionSets).toHaveLength(1);
    expect(disk.questionSets[0]).toMatchObject({ id: section.setId, title: "Invented multimodal shapes", scope: { module: "EXAMPLE", week: 1 }, questionIds: section.savedIds });
    expect(disk.questions).toHaveLength(6);
    // No text of the source was given, so no record of the file is kept: only the questions.
    expect(disk.documents).toHaveLength(0);
    for (const question of disk.questions) expect(question).toMatchObject({ module: "EXAMPLE", week: 1, setId: section.setId, bank: "Invented multimodal shapes" });

    // Each saved question is the package question in the same place.
    const savedOf = (packageId: string) => disk.questions.find((question) => question.id === section.savedIds[section.questionIds.indexOf(packageId)])!;
    expect(savedOf("syn-q04").attachments?.map((attachment) => [attachment.fileName, attachment.role])).toEqual([["syn-q04-micrograph.png", "stem"]]);
    expect(savedOf("syn-q07").attachments?.map((attachment) => attachment.fileName)).toEqual(["syn-q07-field-left.png", "syn-q07-field-right.png"]);
    expect(savedOf("syn-q01").attachments ?? []).toEqual([]);
    for (const packageId of section.questionIds) {
      const from = pkg.questions.find((question) => question.id === packageId)!;
      expect(savedOf(packageId).content).toEqual(from);
      expect(savedOf(packageId)).toMatchObject({ correctKey: from.correctAnswer!.labels[0], questionNumber: from.source.questionNumber, ...(from.source.page !== undefined ? { sourcePage: from.source.page } : {}) });
    }

    // The picture bytes are in the vault.
    expect(await storedImageCount()).toBe(3);
    const blob = await getQuestionAttachmentBlob(savedOf("syn-q04").attachments![0].blobKey);
    expect(blob?.byteSize).toBe(files.find((file) => file.name === "syn-q04-micrograph.png")!.size);
  });

  it("stores answer pictures with stable roles, hidden until the answer is checked", async () => {
    const { pkg, issues, files } = invented();
    const saved = await importPackage(pkg, issues, files, { acknowledged: new Set(["syn-q03"]) });
    expect(saved.status).toBe("saved");
    expect(saved.withheldAssets).toEqual([]);
    const disk = await workspaceOnDisk();
    expect(disk.questions).toHaveLength(7);
    expect(disk.questions.flatMap((question) => question.attachments ?? []).map((attachment) => attachment.fileName).sort())
      .toEqual(["syn-q03-curves-answer.png", "syn-q03-curves.png", "syn-q04-micrograph.png", "syn-q07-field-left.png", "syn-q07-field-right.png"]);
    expect(await storedImageCount()).toBe(5);
    const after = await reloadWorkspace();
    const reveal = after.questions.flatMap((question) => question.attachments ?? []).find((asset) => asset.role === "answer_reveal")!;
    expect(reveal.assetId).toBeTruthy();
    expect(isAssetVisible("answer_reveal", "question")).toBe(false);
    expect(isAssetVisible("answer_reveal", "answered")).toBe(true);
    expect((await getQuestionAttachmentBlob(reveal.blobKey))?.byteSize).toBe(reveal.byteSize);
  });

  it("is all there after a reload", async () => {
    const { pkg, issues, files } = invented();
    const saved = await importPackage(pkg, issues, files, { sourceText: SOURCE_TEXT });
    const before = await workspaceOnDisk();
    const after = await reloadWorkspace();
    const [section] = saved.sections;
    expect(after.questions.map((question) => question.id).sort()).toEqual([...section.savedIds].sort());
    expect(after.questionSets.map((set) => [set.id, set.scope, set.questionIds, set.sourceDocumentIds])).toEqual([[section.setId, { module: "EXAMPLE", week: 1 }, section.savedIds, [section.documentId]]]);
    expect(after.documents.map((document) => [document.id, document.checksum, document.linkedQuestionSetIds])).toEqual([[section.documentId, "sha256:invented", [section.setId]]]);
    const shape = (question: (typeof after.questions)[number]) => [question.id, question.stem, question.correctKey, question.questionNumber, question.sourcePage, question.content, question.attachments?.map((attachment) => attachment.blobKey) ?? []];
    expect(after.questions.map(shape).sort()).toEqual(before.questions.map(shape).sort());
    for (const attachment of after.questions.flatMap((question) => question.attachments ?? [])) expect((await getQuestionAttachmentBlob(attachment.blobKey))?.byteSize).toBe(attachment.byteSize);
  });

  it("writes nothing the second time, before or after a reload", async () => {
    const { pkg, issues, files } = invented();
    const first = await importPackage(pkg, issues, files);
    const reread = { ...pkg, questions: pkg.questions.map(q => ({ ...q, provenance: { ...q.provenance, createdAt: "2026-10-09T12:00:00Z" } })) };
    const again = await importPackage(reread, issues, files);
    expect(again.status).toBe("already-saved");
    expect(again.sections[0]).toMatchObject({ reused: true, setId: first.sections[0].setId, savedIds: first.sections[0].savedIds });
    const disk = await workspaceOnDisk();
    expect([disk.questions.length, disk.questionSets.length, disk.documents.length, await storedImageCount()]).toEqual([6, 1, 0, 3]);

    await reloadWorkspace();
    expect((await importPackage(pkg, issues, files)).status).toBe("already-saved");
    expect((await workspaceOnDisk()).questions).toHaveLength(6);
  });

  it("repairs missing image bytes on reimport without duplicating questions", async () => {
    const { pkg, issues, files } = invented();
    await importPackage(pkg, issues, files);
    const before = await workspaceOnDisk();
    const image = before.questions.flatMap(q => q.attachments ?? [])[0];
    await deleteQuestionAttachmentBlobs([image.blobKey]);
    const repaired = await importPackage(pkg, issues, files);
    expect(repaired.status).toBe("already-saved");
    expect(repaired.sections[0].images.attached).toBe(1);
    expect((await workspaceOnDisk()).questions).toHaveLength(6);
    expect(await storedImageCount()).toBe(3);
  });

  it("adds newly reviewed questions without duplicating an earlier ready subset", async () => {
    const { pkg, issues, files } = invented();
    await importPackage(pkg, issues, files);
    await importPackage(pkg, issues, files, { acknowledged: new Set(["syn-q03"]) });
    const disk = await workspaceOnDisk();
    expect(disk.questions).toHaveLength(7);
    expect(new Set(disk.questions.map(q => q.content?.id)).size).toBe(7);
    const again = await importPackage(pkg, issues, files, { acknowledged: new Set(["syn-q03"]) });
    expect(again.status).toBe("already-saved");
    expect((await workspaceOnDisk()).questions).toHaveLength(7);
  });

  it("says nothing is ready when every question is held, and writes nothing", async () => {
    const { pkg, issues, files } = invented();
    const unkeyed = { ...pkg, questions: pkg.questions.map((question) => ({ ...question, correctAnswer: undefined })) };
    const saved = await importPackage(unkeyed, issues, files);
    expect(saved).toMatchObject({ status: "nothing-ready", sections: [], errors: [] });
    expect(saved.held).toHaveLength(8);
    expect((await workspaceOnDisk()).questions).toHaveLength(0);
  });

  it("reports a write that failed as a failure, never as a save", async () => {
    const { pkg, issues, files } = invented();
    const broken: ReviewedImportStore = {
      ...realWorkspace.store(),
      commitReviewedImport: async () => ({ ok: false, message: "The vault could not be written.", rollbackFailures: [] }),
    };
    const saved = await saveBank(pkg, issues, files, { library: realWorkspace.library, store: () => broken });
    expect(saved.status).toBe("failed");
    expect(saved.sections).toEqual([]);
    expect(saved.errors).toEqual([expect.stringContaining("The vault could not be written.")]);
    expect((await workspaceOnDisk()).questions).toHaveLength(0);
  });

  it("reports a refusal by the canonical checks as a failure", async () => {
    const { pkg, issues, files } = invented();
    // A stem the question record refuses: the package checks are bypassed on purpose here.
    const hollow = { ...pkg, questions: pkg.questions.map((question) => (question.id === "syn-q01" ? { ...question, stem: [] } : question)) };
    const saved = await importPackage(hollow, issues, files);
    expect(saved.status).toBe("failed");
    expect(saved.errors.join(" ")).toMatch(/refused/);
    expect((await workspaceOnDisk()).questions).toHaveLength(0);
  });
});
