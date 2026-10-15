// @vitest-environment jsdom
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { closeWorkspace, openEmptyWorkspace, reloadWorkspace } from "../question-content/persistenceHarness.testing";
import { prepareAcademicUpload } from "./upload";
import { installPrivateLibrary, type LibraryReader } from "../privateLibrary/install";

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

async function reviewedSourceOnly() {
  const sourceHash = "a".repeat(64);
  const catalog = {
    format: "axom-private-library", schemaVersion: 1, id: "private-goer-synthetic", version: "v1",
    templates: [], sources: [{
      id: "source-qbank", name: "illustrative.txt", sourcePath: "illustrative.txt",
      checksum: sourceHash, module: "GOER", status: "prepared", reason: "Validated",
      ready: 1, review: 0, bankFile: "banks/source/bank.json",
    }],
  };
  const bank = { pkg: {
    manifest: {
      schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 },
      bank: { id: "source-qbank", title: "Illustrative private bank", discipline: "Example" },
      source: { filename: "illustrative.txt", sourceWeekDeclared: false, axomAssignedWeek: 2 },
      questionsFile: "questions.json", assetsDirectory: "assets",
    },
    questions: [{
      id: "synthetic-q1", source: { filename: "illustrative.txt", questionNumber: 1 },
      stem: [{ type: "text", text: "Which item is alphabetically first?" }],
      choices: [
        { id: "a", label: "A", blocks: [{ type: "text", text: "Alpha" }] },
        { id: "b", label: "B", blocks: [{ type: "text", text: "Beta" }] },
      ],
      correctAnswer: { labels: ["A"], evidence: "printed-key" },
      assets: [], provenance: { method: "authored", sourceChecksum: `sha256:${sourceHash}` },
    }],
  }, issues: [], sourceText: { rawText: "Synthetic question source only." }, sourceBytes: 30, notes: [] };
  const files = new Map([["catalog.json", encode(catalog)], ["banks/source/bank.json", encode(bank)]]);
  const read: LibraryReader = async path => {
    const data = files.get(path);
    if (!data) throw new Error("The fixture is missing " + path);
    return data;
  };
  return read;
}

beforeEach(async () => {
  await openEmptyWorkspace();
  vi.stubGlobal("Blob", NativeBlob);
  vi.stubGlobal("File", NativeFile);
});
afterEach(closeWorkspace);

it("round-trips a scope-verified source-only academic bank into the canonical local QBank with no fabricated course template", async () => {
  const input = await reviewedSourceOnly();
  const prepared = await prepareAcademicUpload(input, {
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
