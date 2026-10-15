// @vitest-environment jsdom
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { closeWorkspace, openEmptyWorkspace, reloadWorkspace } from "../question-content/persistenceHarness.testing";
import { prepareAcademicUpload } from "./upload";
import { academicBindings, academicRecord } from "./contentReferences";
import { installPrivateLibrary, readPreparedBank, type LibraryReader } from "../privateLibrary/install";
import { PRIVATE_REVIEW_DOCUMENT, type PreparedBank } from "../privateLibrary/types";

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

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
afterEach(closeWorkspace);

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
  expect(persistedBank.pkg).toEqual(originalPackage);

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
