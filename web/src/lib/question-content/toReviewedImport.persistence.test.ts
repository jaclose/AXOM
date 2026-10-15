// @vitest-environment jsdom
// A package, saved by the code every import is saved by, into the real
// workspace store: filed, linked to its pictures, read back, and not written
// twice. The content is the invented fixture.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushLocalVaultWrites, localVaultStorage } from "../localVault";
import { deleteQuestionAttachmentBlobs, getQuestionAttachmentBlob } from "../questionAttachments";
import type { ReviewedImportStore } from "../questionImportSave";
import { useStore } from "../store";
import { saveBank } from "./bankImport";
import { preparedBankImportOptions } from "../privateLibrary/install";
import { parsePackage } from "./packageJson";
import { closeWorkspace, importPackage, openEmptyWorkspace, realWorkspace, reloadWorkspace, storedImageCount, workspaceOnDisk } from "./persistenceHarness.testing";
import type { ImportPackage, PackageIssue } from "./package";
import { packageToReviewedImport, type PackageImportOptions } from "./toReviewedImport";
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
afterEach(async () => {
  vi.restoreAllMocks();
  await closeWorkspace();
});

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

  it("layers reviewed filing over imported records without rewriting source scope evidence", () => {
    const { pkg, issues } = invented();
    const before = structuredClone(pkg);
    const adapted = packageToReviewedImport(pkg, issues, preparedBankImportOptions({
      pkg, issues, sourceText: SOURCE_TEXT, sourceBytes: 4321, notes: [],
      reviewedFiling: { term: "Term 5", module: "GOER", evidence: "human-reviewed", weekAssignment: "unassigned" },
    }));

    expect(adapted.imports[0].request.scope).toEqual({ module: "GOER" });
    expect(adapted.filing).toMatchObject({ module: "GOER", term: 5 });
    expect(adapted.filing).not.toHaveProperty("week");
    expect(pkg).toEqual(before);
    expect(adapted.imports[0].request.drafts[0].content).toEqual(before.questions[0]);
  });

  it("rejects malformed, mismatched, and week-assigned reviewed filing options", () => {
    const { pkg, issues } = invented();
    expect(() => packageToReviewedImport(pkg, issues, {
      reviewedFiling: { module: "FTCM", term: 4, week: 2 } as PackageImportOptions["reviewedFiling"],
    })).toThrow(/without assigning a week/);
    expect(() => packageToReviewedImport(pkg, issues, {
      reviewedFiling: { module: "FTCM", term: 5 },
    })).toThrow(/belongs to Term 4/);
    expect(() => packageToReviewedImport(pkg, issues, {
      reviewedFiling: { module: " ", term: 4 },
    })).toThrow(/Term 1-5 destination/);
    expect(() => packageToReviewedImport(pkg, issues, {
      reviewedFiling: { module: "GOER & FTCM", term: 4 },
    })).toThrow(/one module/);
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

  it("blocks a merged 9-choice PDF and a one-choice slide even when review is acknowledged", () => {
    const { pkg, files } = invented();
    const nineChoices = Array.from({ length: 9 }, (_, i) => ({
      id: "synthetic-option-" + i,
      label: String.fromCharCode(65+i),
      blocks: [{ type: "text" as const, text: "Synthetic alternative " + i }],
    }));
    const malformed = { ...pkg, questions: pkg.questions.map((q) =>
      q.id === "syn-q01" ? { ...q, choices: nineChoices } :
      q.id === "syn-q02" ? { ...q, choices: [q.choices[0]] } : q) };
    const result = packageToReviewedImport(malformed, validatePackage(malformed, {
      assetFiles: new Set(files.map(file=>file.name)),
    }), { acknowledged: new Set(["syn-q01","syn-q02"]) });
    const accepted = result.imports.flatMap(section => section.questionIds);
    expect(accepted).not.toContain("syn-q01");
    expect(accepted).not.toContain("syn-q02");
    expect(result.held.find(q=>q.questionId==="syn-q01")?.reasons.join(" ")).toMatch(/2–8/);
    expect(result.held.find(q=>q.questionId==="syn-q02")?.reasons.join(" ")).toMatch(/2–8/);
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

  it("refiles every reused set together after review", async () => {
    const { pkg, files } = twoSets();
    const source = { ...pkg, manifest: { ...pkg.manifest, course: { name: "GOER", term: 5, week: 2 } } };
    const issues = validatePackage(source, { assetFiles: new Set(files.map((file) => file.name)) });
    const first = await importPackage(source, issues, files);

    const reviewed = await importPackage(source, issues, files, {
      reviewedFiling: { module: "FTCM", term: 4 },
    });

    expect(reviewed).toMatchObject({ status: "already-saved", errors: [] });
    expect(reviewed.sections.map((section) => section.setId)).toEqual(first.sections.map((section) => section.setId));
    const after = await reloadWorkspace();
    expect(after.questionSets).toHaveLength(2);
    expect(after.questionSets.every((set) => set.scope?.module === "FTCM" && set.scope.week === undefined && set.scope.courseId === undefined)).toBe(true);
    expect(after.questions).toHaveLength(4);
    expect(after.questions.every((question) => question.module === "FTCM" && question.week === undefined && question.courseId === undefined)).toBe(true);
  });

  it("reports an atomic multi-set refiling failure without partial success", async () => {
    const { pkg, files } = twoSets();
    const source = { ...pkg, manifest: { ...pkg.manifest, course: { name: "GOER", term: 5, week: 2 } } };
    const issues = validatePackage(source, { assetFiles: new Set(files.map((file) => file.name)) });
    const first = await importPackage(source, issues, files);
    const actual = realWorkspace.store();
    let refilingAttempts = 0;
    const failSecond: ReviewedImportStore = {
      ...actual,
      commitReviewedRefiling: async () => {
        refilingAttempts += 1;
        return { ok: false, message: "Synthetic atomic refiling failure", rollbackFailures: [] };
      },
    };

    const reviewed = await saveBank(source, issues, files, {
      library: realWorkspace.library,
      store: () => failSecond,
    }, { reviewedFiling: { module: "FTCM", term: 4 } });

    expect(reviewed.status).toBe("failed");
    expect(reviewed.incompleteSections).toEqual(expect.arrayContaining([
      expect.objectContaining({ setId: first.sections[0].setId, savedIds: first.sections[0].savedIds, reused: true }),
    ]));
    expect(reviewed.sections).toEqual([]);
    expect(reviewed.errors.join(" ")).toMatch(/Synthetic atomic refiling failure/);
    expect(refilingAttempts).toBe(1);
    const after = await reloadWorkspace();
    expect(after.questionSets).toHaveLength(2);
    expect(after.questionSets.every((set) => set.scope?.module === "GOER" && set.scope.week === 2)).toBe(true);
    expect(after.questions).toHaveLength(4);
    expect(after.questions.every((question) => question.module === "GOER" && question.week === 2)).toBe(true);
  });

  it("refuses every reviewed refiling before question scope changes when atomic refiling is unavailable", async () => {
    const { pkg, files } = twoSets();
    const source = { ...pkg, manifest: { ...pkg.manifest, course: { name: "GOER", term: 5, week: 2 } } };
    const issues = validatePackage(source, { assetFiles: new Set(files.map((file) => file.name)) });
    await importPackage(source, issues, files);
    const actual = realWorkspace.store();
    let questionUpdates = 0;
    const unsupported: ReviewedImportStore = {
      ...actual,
      updateQuestion: (id, patch) => {
        questionUpdates += 1;
        return actual.updateQuestion(id, patch);
      },
      commitReviewedRefiling: undefined,
    };

    const reviewed = await saveBank(source, issues, files, {
      library: realWorkspace.library,
      store: () => unsupported,
    }, { reviewedFiling: { module: "FTCM", term: 4 } });

    expect(reviewed.status).toBe("failed");
    expect(reviewed.sections).toEqual([]);
    expect(reviewed.errors.join(" ")).toMatch(/cannot durably update reused source sets/);
    expect(questionUpdates).toBe(0);
    const after = await reloadWorkspace();
    expect(after.questionSets.every((set) => set.scope?.module === "GOER" && set.scope.week === 2)).toBe(true);
    expect(after.questions.every((question) => question.module === "GOER" && question.week === 2)).toBe(true);
  });

  it("makes an identical concurrent refiling share the first durable result", async () => {
    const { pkg, files } = twoSets();
    const source = { ...pkg, manifest: { ...pkg.manifest, course: { name: "GOER", term: 5, week: 2 } } };
    const issues = validatePackage(source, { assetFiles: new Set(files.map((file) => file.name)) });
    await importPackage(source, issues, files);
    const actual = realWorkspace.store();
    let commits = 0;
    const counted: ReviewedImportStore = {
      ...actual,
      commitReviewedRefiling: async (plan) => {
        commits += 1;
        return actual.commitReviewedRefiling!(plan);
      },
    };
    let storeReads = 0;
    const workspace = { library: realWorkspace.library, store: () => { storeReads += 1; return counted; } };
    let rejectAtomicWrite!: (error: Error) => void;
    const deferredFailure = new Promise<void>((_resolve, reject) => { rejectAtomicWrite = reject; });
    const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
    vi.spyOn(localVaultStorage, "setItem")
      .mockImplementationOnce(() => deferredFailure)
      .mockImplementation((name, value) => originalSetItem(name, value));

    const first = saveBank(source, issues, files, workspace, { reviewedFiling: { module: "FTCM", term: 4 } });
    await vi.waitFor(() => {
      expect(commits).toBe(1);
      expect(useStore.getState().questionSets.every((set) => set.scope?.module === "FTCM")).toBe(true);
    });
    const second = saveBank(source, issues, files, workspace, { reviewedFiling: { module: "FTCM", term: 4 } });
    await vi.waitFor(() => expect(storeReads).toBeGreaterThanOrEqual(6));
    expect(commits).toBe(1);
    rejectAtomicWrite(new Error("Deferred duplicate refiling failure"));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toMatchObject({ status: "failed", sections: [] });
    expect(secondResult).toMatchObject({ status: "failed", sections: [] });
    expect(firstResult.errors.join(" ")).toMatch(/Deferred duplicate refiling failure/);
    expect(secondResult.errors).toEqual(firstResult.errors);
    expect(commits).toBe(1);
    const after = await reloadWorkspace();
    expect(after.questionSets.every((set) => set.scope?.module === "GOER" && set.scope.week === 2)).toBe(true);
    expect(after.questions.every((question) => question.module === "GOER" && question.week === 2)).toBe(true);
  });

  it("serializes conflicting concurrent refilings before reading live scope", async () => {
    const { pkg, files } = twoSets();
    const source = { ...pkg, manifest: { ...pkg.manifest, course: { name: "GOER", term: 5, week: 2 } } };
    const issues = validatePackage(source, { assetFiles: new Set(files.map((file) => file.name)) });
    await importPackage(source, issues, files);
    const actual = realWorkspace.store();
    const commits: string[] = [];
    const counted: ReviewedImportStore = {
      ...actual,
      commitReviewedRefiling: async (plan) => {
        commits.push(plan.sets[0]?.targetScope.module ?? "missing");
        return actual.commitReviewedRefiling!(plan);
      },
    };
    let storeReads = 0;
    const workspace = { library: realWorkspace.library, store: () => { storeReads += 1; return counted; } };
    let rejectAtomicWrite!: (error: Error) => void;
    const deferredFailure = new Promise<void>((_resolve, reject) => { rejectAtomicWrite = reject; });
    const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
    vi.spyOn(localVaultStorage, "setItem")
      .mockImplementationOnce(() => deferredFailure)
      .mockImplementation((name, value) => originalSetItem(name, value));

    const first = saveBank(source, issues, files, workspace, { reviewedFiling: { module: "FTCM", term: 4 } });
    await vi.waitFor(() => expect(commits).toEqual(["FTCM"]));
    const second = saveBank(source, issues, files, workspace, { reviewedFiling: { module: "NCRS", term: 4 } });
    await vi.waitFor(() => expect(storeReads).toBeGreaterThanOrEqual(6));
    expect(commits).toEqual(["FTCM"]);
    rejectAtomicWrite(new Error("Deferred first refiling failure"));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.status).toBe("failed");
    expect(secondResult).toMatchObject({ status: "already-saved", errors: [] });
    expect(commits).toEqual(["FTCM", "NCRS"]);
    const after = await reloadWorkspace();
    expect(after.questionSets.every((set) => set.scope?.module === "NCRS" && set.scope.week === undefined)).toBe(true);
    expect(after.questions.every((question) => question.module === "NCRS" && question.week === undefined)).toBe(true);
  });

  it("keeps a newly saved section when a reused sibling refiling fails", async () => {
    const { pkg, files } = invented();
    const source = { ...pkg, manifest: { ...pkg.manifest, course: { name: "GOER", term: 5, week: 2 } } };
    const firstPackage = { ...source, questions: source.questions.filter((question) => question.id === "syn-q01") };
    const firstIssues = validatePackage(firstPackage, { assetFiles: new Set(files.map((file) => file.name)) });
    await importPackage(firstPackage, firstIssues, files);
    const mixedPackage = { ...source, questions: source.questions.filter((question) => ["syn-q01", "syn-q02"].includes(question.id)) };
    const mixedIssues = validatePackage(mixedPackage, { assetFiles: new Set(files.map((file) => file.name)) });
    const actual = realWorkspace.store();
    const refused: ReviewedImportStore = {
      ...actual,
      commitReviewedRefiling: async () => ({ ok: false, message: "Synthetic reused-section failure", rollbackFailures: [] }),
    };

    const result = await saveBank(mixedPackage, mixedIssues, files, {
      library: realWorkspace.library,
      store: () => refused,
    }, { reviewedFiling: { module: "FTCM", term: 4 } });

    expect(result.status).toBe("partial");
    expect(result.errors.join(" ")).toMatch(/Synthetic reused-section failure/);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({ reused: false, questionIds: ["syn-q02"] });
    expect(result.incompleteSections).toEqual([
      expect.objectContaining({
        reused: true,
        questionIds: ["syn-q01"],
        savedIds: expect.arrayContaining([expect.any(String)]),
        reason: expect.stringMatching(/Synthetic reused-section failure/),
      }),
    ]);
    const after = await reloadWorkspace();
    expect(after.questions).toHaveLength(2);
    expect(after.questions.find((question) => question.content?.id === "syn-q01")).toMatchObject({ module: "GOER", week: 2 });
    const newQuestion = after.questions.find((question) => question.content?.id === "syn-q02");
    expect(newQuestion).toMatchObject({ module: "FTCM" });
    expect(newQuestion).not.toHaveProperty("week");
    expect(after.questionSets).toHaveLength(2);
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

  it("refiles an existing source set in place and keeps learner state when a sibling is released", async () => {
    const { pkg, files } = invented();
    const source = {
      ...pkg,
      manifest: { ...pkg.manifest, course: { name: "GOER", term: 5, week: 2 } },
    };
    const issues = validatePackage(source, { assetFiles: new Set(files.map((file) => file.name)) });
    const first = await importPackage(source, issues, files);
    const firstSet = first.sections[0];
    const attemptedId = firstSet.savedIds[firstSet.questionIds.indexOf("syn-q04")];
    useStore.getState().recordQuestionAttempt(attemptedId, {
      answerKey: "A", status: "incorrect", quizSessionId: "reviewed-refiling-proof", mode: "tutor",
    });
    await flushLocalVaultWrites();
    const before = await workspaceOnDisk();
    const beforeQuestion = before.questions.find((question) => question.id === attemptedId)!;
    const beforeSet = before.questionSets.find((set) => set.id === firstSet.setId)!;

    const reviewed = await importPackage(source, issues, files, {
      acknowledged: new Set(["syn-q03"]),
      reviewedFiling: { module: "FTCM", term: 4 },
    });

    expect(reviewed).toMatchObject({ status: "saved", errors: [] });
    expect(reviewed.sections.some((section) => section.reused && section.setId === firstSet.setId)).toBe(true);
    const after = await reloadWorkspace();
    const afterQuestion = after.questions.find((question) => question.id === attemptedId)!;
    const afterSet = after.questionSets.find((set) => set.id === firstSet.setId)!;
    expect(after.questions).toHaveLength(7);
    expect(new Set(after.questions.map((question) => question.id)).size).toBe(7);
    expect(new Set(after.questions.map((question) => question.content?.id)).size).toBe(7);
    expect(after.questions.find((question) => question.content?.id === "syn-q03")).toMatchObject({ module: "FTCM" });
    expect(after.questions.every((question) => question.module === "FTCM" && question.week === undefined && question.courseId === undefined)).toBe(true);
    expect(after.questionSets.every((set) => set.scope?.module === "FTCM" && set.scope.week === undefined && set.scope.courseId === undefined)).toBe(true);
    expect(afterSet).toMatchObject({ id: beforeSet.id, questionIds: beforeSet.questionIds, scope: { module: "FTCM" } });
    expect(afterQuestion).toMatchObject({ id: beforeQuestion.id, module: "FTCM" });
    expect(afterQuestion.content).toEqual(beforeQuestion.content);
    expect(afterQuestion.attachments).toEqual(beforeQuestion.attachments);
    expect(afterQuestion.attempts).toEqual(beforeQuestion.attempts);
    expect(afterQuestion.status).toBe(beforeQuestion.status);
    expect(afterQuestion.userAnswerKey).toBe(beforeQuestion.userAnswerKey);
    expect(afterQuestion.notes).toBe(beforeQuestion.notes);
    expect(afterQuestion.annotations).toEqual(beforeQuestion.annotations);
    expect(afterQuestion).not.toHaveProperty("week");
  });

  it("retains the prior scope when an atomic reviewed refiling is refused", async () => {
    const { pkg, files } = invented();
    const source = {
      ...pkg,
      manifest: { ...pkg.manifest, course: { name: "GOER", term: 5, week: 2 } },
    };
    const issues = validatePackage(source, { assetFiles: new Set(files.map((file) => file.name)) });
    const first = await importPackage(source, issues, files);
    const actual = realWorkspace.store();
    let refilingAttempts = 0;
    const failOnce: ReviewedImportStore = {
      ...actual,
      commitReviewedRefiling: async () => {
        refilingAttempts += 1;
        return { ok: false, message: "Synthetic atomic refiling failure", rollbackFailures: [] };
      },
    };

    const reviewed = await saveBank(source, issues, files, {
      library: realWorkspace.library,
      store: () => failOnce,
    }, { reviewedFiling: { module: "FTCM", term: 4 } });

    expect(reviewed.status).toBe("failed");
    expect(reviewed.errors.join(" ")).toMatch(/Synthetic atomic refiling failure/);
    expect(refilingAttempts).toBe(1);
    const after = await reloadWorkspace();
    expect(after.questions).toHaveLength(first.sections[0].savedIds.length);
    expect(after.questions.every((question) => question.module === "GOER" && question.week === 2)).toBe(true);
    expect(after.questionSets).toEqual([
      expect.objectContaining({ id: first.sections[0].setId, scope: { module: "GOER", week: 2 } }),
    ]);
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
