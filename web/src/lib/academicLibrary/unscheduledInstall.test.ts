// @vitest-environment jsdom
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { closeWorkspace, openEmptyWorkspace, realWorkspace, reloadWorkspace } from "../question-content/persistenceHarness.testing";
import { prepareAcademicUpload } from "./upload";
import { academicBindings, academicRecord } from "./contentReferences";
import { installPrivateLibrary, preparedBankImportOptions, readPreparedBank, type LibraryReader } from "../privateLibrary/install";
import { PRIVATE_REVIEW_DOCUMENT, type PreparedBank } from "../privateLibrary/types";
import { PACKAGE_SCHEMA_VERSION } from "../question-content/package";
import { packageToReviewedImport } from "../question-content/toReviewedImport";
import { saveBank } from "../question-content/bankImport";
import { buildQuestionBankBooks } from "../bookshelf/questionBankBooks";
import { flushLocalVaultWrites, localVaultStorage } from "../localVault";
import type { QuestionRecord } from "../questions";

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const originalRefilingCommit = useStore.getState().commitReviewedRefiling;

async function reviewedSourceOnly(reviewedFiling?: PreparedBank["reviewedFiling"]) {
  const sourceHash = "a".repeat(64);
  const catalog = {
    format: "axom-private-library", schemaVersion: 1, id: "private-goer-synthetic", version: "v1",
    templates: [], sources: [{
      id: "source-qbank", name: "illustrative.txt", sourcePath: "illustrative.txt",
      checksum: sourceHash, module: "GOER", status: "prepared", reason: "Validated",
      ready: 1, review: 0, bankFile: "banks/source/bank.json",
    }],
  };
  const bank: PreparedBank = { pkg: {
    manifest: {
      schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 },
      bank: { id: "source-qbank", title: "Illustrative private bank", discipline: "Example" },
      source: { filename: "illustrative.txt", sourceWeekDeclared: false, axomAssignedWeek: 2 },
      questionsFile: "questions.json", assetsDirectory: "assets",
    },
    questions: [{
      id: "synthetic-q1", course: "GOER", term: 5, week: 2,
      source: { filename: "illustrative.txt", questionNumber: 1 },
      stem: [{ type: "text", text: "Which item is alphabetically first?" }],
      choices: [
        { id: "a", label: "A", blocks: [{ type: "text", text: "Alpha" }] },
        { id: "b", label: "B", blocks: [{ type: "text", text: "Beta" }] },
      ],
      correctAnswer: { labels: ["A"], evidence: "printed-key" },
      assets: [], provenance: { method: "authored", sourceChecksum: `sha256:${sourceHash}` },
    }],
  }, issues: [], sourceText: { rawText: "Synthetic question source only." }, sourceBytes: 30, notes: [],
  ...(reviewedFiling ? { reviewedFiling } : {}) };
  const files = new Map([["catalog.json", encode(catalog)], ["banks/source/bank.json", encode(bank)]]);
  const read: LibraryReader = async path => {
    const data = files.get(path);
    if (!data) throw new Error("The fixture is missing " + path);
    return data;
  };
  return { bank, files, read };
}

beforeEach(async () => {
  await openEmptyWorkspace();
  vi.stubGlobal("Blob", NativeBlob);
  vi.stubGlobal("File", NativeFile);
});
afterEach(async () => {
  vi.restoreAllMocks();
  useStore.setState({ commitReviewedRefiling: originalRefilingCommit });
  await closeWorkspace();
});

async function declaredSourceOnly() {
  const input = await reviewedSourceOnly();
  input.bank.pkg.manifest.course.week = 3;
  input.bank.pkg.manifest.source.sourceWeekDeclared = true;
  input.bank.pkg.manifest.source.axomAssignedWeek = 3;
  input.bank.pkg.questions[0].week = 3;
  input.files.set("banks/source/bank.json", encode(input.bank));
  const prepared = await prepareAcademicUpload(input.read, {
    term: "Term 5", module: "GOER", title: "Illustrative GOER", evidence: "source-metadata",
  });
  const files = new Map(prepared.files.map(file => [file.path, file.bytes]));
  const read: LibraryReader = async path => {
    const bytes = files.get(path);
    if (!bytes) throw new Error("Missing published fixture file: " + path);
    return bytes;
  };
  const catalog = JSON.parse(new TextDecoder().decode(files.get("catalog.json")));
  const bank = readPreparedBank(JSON.parse(new TextDecoder().decode(files.get(catalog.sources[0].bankFile))));
  return { prepared, read, bank };
}

it("preserves a uniformly declared source week through actual planless publication, installation and QBank grouping", async () => {
  const published = await declaredSourceOnly();
  expect(published.prepared.template).toBe("");
  expect(published.bank.reviewedFiling).toEqual({
    term: "Term 5", module: "GOER", evidence: "source-metadata", weekAssignment: "unassigned",
  });
  expect(preparedBankImportOptions(published.bank).preserveSourceDeclaredWeek).toBe(true);
  const sourceBefore = structuredClone(published.bank.pkg);
  const installation = await installPrivateLibrary(published.read);
  expect(installation.status).toBe("complete");
  expect(installation.templateIds).toEqual([]);
  const state = await reloadWorkspace();
  expect(state.questions).toHaveLength(1);
  expect(state.questions[0]).toMatchObject({ module: "GOER", week: 3 });
  expect(state.questionSets[0].scope).toEqual({ module: "GOER", week: 3 });
  expect(state.questions[0].content).toEqual(sourceBefore.questions[0]);
  expect(buildQuestionBankBooks({ terms: [], courses: [], sets: state.questionSets, questions: state.questions })[0].weeks)
    .toEqual([expect.objectContaining({ week: 3, label: "Week 3", questions: 1 })]);
  expect(published.bank.pkg).toEqual(sourceBefore);
});

it.each(["undeclared", "missing declaration", "cumulative", "invalid week", "mixed weeks", "human-reviewed unassigned"])(
  "does not restore a week for %s source scope", async kind => {
    let { bank } = await declaredSourceOnly();
    if (kind === "undeclared") bank.pkg.manifest.source.sourceWeekDeclared = false;
    if (kind === "missing declaration") delete (bank.pkg.manifest.source as Partial<typeof bank.pkg.manifest.source>).sourceWeekDeclared;
    if (kind === "cumulative") {
      bank.pkg.manifest.course.week = 0;
      bank.pkg.questions[0].week = 0;
    }
    if (kind === "invalid week") {
      bank.pkg.manifest.course.week = 100;
      bank.pkg.questions[0].week = 100;
    }
    if (kind === "mixed weeks") bank.pkg.questions.push({
      ...structuredClone(bank.pkg.questions[0]), id: "synthetic-q2", week: 4,
      source: { ...bank.pkg.questions[0].source, questionNumber: 2 },
    });
    if (kind === "human-reviewed unassigned") bank = { ...bank, reviewedFiling: { ...bank.reviewedFiling!, evidence: "human-reviewed" } };
    const options = preparedBankImportOptions(bank);
    expect(options.preserveSourceDeclaredWeek).toBeUndefined();
    const adapted = packageToReviewedImport(bank.pkg, bank.issues, options);
    expect(adapted.filing.week).toBeUndefined();
    expect(adapted.imports.every(section => section.request.scope?.week === undefined)).toBe(true);
    if (kind === "missing declaration") expect(() => readPreparedBank(bank)).toThrow("damaged or unsupported");
  },
);

it.each(["filing module", "filing term", "question module", "question term"])(
  "rejects mismatched %s source evidence before assigning a week", async kind => {
    let { bank } = await declaredSourceOnly();
    if (kind === "filing module") bank = { ...bank, reviewedFiling: { ...bank.reviewedFiling!, module: "FTCM", term: "Term 4" } };
    if (kind === "filing term") bank = { ...bank, reviewedFiling: { ...bank.reviewedFiling!, term: "Term 4" } };
    if (kind === "question module") bank.pkg.questions[0].course = "FTCM";
    if (kind === "question term") bank.pkg.questions[0].term = 4;
    expect(preparedBankImportOptions(bank).preserveSourceDeclaredWeek).toBeUndefined();
    expect(() => readPreparedBank(bank)).toThrow(/original module and term|original modules or terms/);
  },
);

async function saveWithEarlierUnassignedProjection(bank: PreparedBank) {
  const saved = await saveBank(bank.pkg, bank.issues, [], realWorkspace, {
    ...preparedBankImportOptions(bank), preserveSourceDeclaredWeek: false,
  });
  expect(saved.status).toBe("saved");
  expect(useStore.getState().questions[0].week).toBeUndefined();
  return useStore.getState().questions[0];
}

it.each(["same module", "absent scope"])("repairs a partial earlier install with %s through the durable filing commit and preserves learner state", async kind => {
  const published = await declaredSourceOnly();
  const question = await saveWithEarlierUnassignedProjection(published.bank);
  useStore.getState().updateQuestion(question.id, { notes: "My source note", stem: "My reviewed wording of the same source question." });
  useStore.getState().recordQuestionAttempt(question.id, { answerKey: "B", status: "incorrect", quizSessionId: "week-repair", mode: "tutor" });
  if (kind === "absent scope") useStore.setState(state => ({
    questions: state.questions.map(item => ({ ...item, module: undefined, week: undefined })),
    questionSets: state.questionSets.map(set => ({ ...set, scope: undefined })),
  }));
  const before = await reloadWorkspace();
  const commit = vi.spyOn(useStore.getState(), "commitReviewedRefiling");
  const repaired = await installPrivateLibrary(published.read);
  expect(repaired.status).toBe("complete");
  expect(commit).toHaveBeenCalledOnce();
  const after = await reloadWorkspace();
  expect(after.questions).toEqual([{ ...before.questions[0], module: "GOER", week: 3 }]);
  expect(after.questionSets).toEqual([{ ...before.questionSets[0], scope: { module: "GOER", week: 3 } }]);
  expect(after.questions[0].attempts).toHaveLength(1);
  expect(after.questions[0].notes).toBe("My source note");
  const repeated = await installPrivateLibrary(published.read);
  expect(repeated.status).toBe("complete");
  expect((await reloadWorkspace()).questions).toEqual(after.questions);
  expect(useStore.getState().questionSets).toHaveLength(1);
});

it.each(["set week", "question week", "question module", "question course"])(
  "refuses automatic week repair over a conflicting learner %s", async kind => {
    const published = await declaredSourceOnly();
    const question = await saveWithEarlierUnassignedProjection(published.bank);
    const patch: Partial<QuestionRecord> = kind === "question week" ? { week: 4 }
      : kind === "question module" ? { module: "FTCM" }
        : kind === "question course" ? { courseId: "learner-course" } : {};
    useStore.getState().updateQuestion(question.id, { ...patch, notes: "Keep this learner filing" });
    if (kind === "set week") useStore.setState(state => ({
      questionSets: state.questionSets.map(set => ({ ...set, scope: { module: "GOER", week: 4 } })),
    }));
    const before = await reloadWorkspace();
    const commit = vi.spyOn(useStore.getState(), "commitReviewedRefiling");
    const refused = await installPrivateLibrary(published.read);
    expect(refused.status).toBe("partial");
    expect(refused.warnings.join(" ")).toContain("different learner filing");
    expect(commit).not.toHaveBeenCalled();
    const after = await reloadWorkspace();
    expect(after.questions).toEqual(before.questions);
    expect(after.questionSets).toEqual(before.questionSets);
  },
);

it("keeps a failed source-week write incomplete and rolls back its scope before retry", async () => {
  const published = await declaredSourceOnly();
  await saveWithEarlierUnassignedProjection(published.bank);
  await flushLocalVaultWrites();
  const originalSetItem = localVaultStorage.setItem.bind(localVaultStorage);
  vi.spyOn(localVaultStorage, "setItem")
    .mockRejectedValueOnce(new Error("Synthetic week persistence failure"))
    .mockImplementation(originalSetItem);
  const result = await saveBank(published.bank.pkg, published.bank.issues, [], realWorkspace, preparedBankImportOptions(published.bank));
  expect(result.status).toBe("failed");
  expect(result.sections).toEqual([]);
  expect(result.errors.join(" ")).toMatch(/could not be saved|Synthetic week persistence failure/);
  const after = await reloadWorkspace();
  expect(after.questions[0].week).toBeUndefined();
  expect(after.questionSets[0].scope?.week).toBeUndefined();
  expect((await installPrivateLibrary(published.read)).status).toBe("complete");
  expect((await reloadWorkspace()).questions[0].week).toBe(3);
});

it("round-trips a scope-verified source-only academic bank into the canonical local QBank with no fabricated course template", async () => {
  const input = await reviewedSourceOnly();
  const prepared = await prepareAcademicUpload(input.read, {
    term: "Term 5", module: "GOER", title: "Illustrative GOER", evidence: "human-reviewed",
  });
  expect(prepared.provenance.weekAssignment).toBe("unassigned");
  expect(prepared.template).toBe("");
  expect(prepared.metadata.ready_questions).toBe(1);
  const bytes = new Map(prepared.files.map(file => [file.path, file.bytes]));
  const restoredRead: LibraryReader = async path => {
    const found = bytes.get(path);
    if (!found) throw new Error("Verified academic file missing from immutable package: " + path);
    return found;
  };
  const installed = await installPrivateLibrary(restoredRead);
  expect(installed.templateIds).toEqual([]);
  expect(installed.questionIds).toHaveLength(1);
  expect(installed.setIds).toHaveLength(1);
  expect(useStore.getState().questions).toHaveLength(1);
  const question = useStore.getState().questions[0];
  expect(question.sourceDocumentId).toBeTruthy();
  expect(question.correctKey).toBe("A");
  useStore.getState().updateQuestion(question.id, { notes: "Remember source provenance" });
  await reloadWorkspace();
  expect(useStore.getState().questions).toHaveLength(1);
  expect(useStore.getState().questions[0].notes).toBe("Remember source provenance");
  const repeat = await installPrivateLibrary(restoredRead);
  expect(repeat.setIds).toHaveLength(1);
  expect(useStore.getState().questions).toHaveLength(1);
  expect(useStore.getState().questions[0].notes).toBe("Remember source provenance");
});

it("keeps reviewed filing in private recovery while adapter v1 refuses incompatible question reconstruction", async () => {
  const input = await reviewedSourceOnly({
    term: "Term 4", module: "FTCM", evidence: "human-reviewed", weekAssignment: "unassigned",
  });
  const originalPackage = structuredClone(input.bank.pkg);
  input.files.set("banks/source/bank.json", encode(input.bank));
  const installed = await installPrivateLibrary(input.read);
  expect(installed.questionIds).toHaveLength(1);
  expect(installed.setIds).toHaveLength(1);
  let state = useStore.getState();
  let question = state.questions[0];
  let set = state.questionSets.find(candidate => candidate.id === question.setId)!;
  expect(set.scope).toEqual({ module: "FTCM" });
  expect(question).toMatchObject({ module: "FTCM" });
  expect(question.week).toBeUndefined();
  expect(question.content).toEqual(originalPackage.questions[0]);

  await reloadWorkspace();
  state = useStore.getState();
  question = state.questions[0];
  set = state.questionSets.find(candidate => candidate.id === question.setId)!;
  expect(set.scope).toEqual({ module: "FTCM" });
  expect(question.week).toBeUndefined();

  const recovery = state.documents.find(document => document.fileType === PRIVATE_REVIEW_DOCUMENT);
  expect(recovery).toBeDefined();
  const persistedBank = readPreparedBank(JSON.parse(recovery!.rawText));
  expect(persistedBank.reviewedFiling).toEqual({
    term: "Term 4", module: "FTCM", evidence: "human-reviewed", weekAssignment: "unassigned",
  });
  // Recovery stores the canonical current package after accepting the legacy
  // v1 input; optional v2 teaching remains absent and source content is exact.
  expect(persistedBank.pkg).toEqual({
    ...originalPackage,
    manifest: { ...originalPackage.manifest, schemaVersion: PACKAGE_SCHEMA_VERSION },
  });

  const questionReference = {
    adapterVersion: 1,
    kind: "question" as const,
    questionId: question.content!.id,
    reviewedAt: question.extraction!.reviewedAt,
    revisionId: "11111111-1111-4111-8111-111111111111",
    path: "banks/source/bank.json",
    sha256: "a".repeat(64),
  } as const;
  expect(() => academicRecord(persistedBank, questionReference)).toThrow("newer academic question adapter");
  const bindings = await academicBindings(state, installed, questionReference.revisionId, [{
    path: questionReference.path, sha256: questionReference.sha256, mime_type: "application/json",
  }], input.files);
  expect(bindings.sources.filter(reference => reference.collection === "questions")).toEqual([]);

  const repeated = await installPrivateLibrary(input.read);
  expect(repeated.questionIds).toHaveLength(1);
  expect(useStore.getState().questions).toHaveLength(1);
  expect(useStore.getState().questions[0]).toMatchObject({ module: "FTCM" });
  expect(useStore.getState().questions[0].week).toBeUndefined();
  expect(readPreparedBank(JSON.parse(useStore.getState().documents.find(document => document.fileType === PRIVATE_REVIEW_DOCUMENT)!.rawText)).reviewedFiling)
    .toEqual(persistedBank.reviewedFiling);
});
