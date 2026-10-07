import { describe, expect, it } from "vitest";
import type { QuestionSet, SourceDocument } from "./library";
import { ALREADY_IMPORTED_RULE, alreadyImported, applyPriorImport, findPriorImport } from "./questionImportHistory";
import type { QuestionRecord } from "./questions";

// Invented teaching content.
const option = (key: string, text: string) => ({ key, text });
const VEIN = { stem: "Which vessel carries oxygenated blood from the lungs to the heart?", options: [option("A", "Pulmonary vein"), option("B", "Pulmonary artery"), option("C", "Aorta")] };
const NERVE = { stem: "Which nerve supplies the diaphragm?", options: [option("A", "Vagus nerve"), option("B", "Phrenic nerve"), option("C", "Intercostal nerve")] };
const HORMONE = { stem: "Which hormone lowers blood glucose?", options: [option("A", "Glucagon"), option("B", "Cortisol"), option("C", "Insulin")] };

const document = (over: Partial<SourceDocument> = {}): SourceDocument => ({
  id: "doc-1", title: "Thorax quiz", fileName: "Thorax Quiz.pdf", fileType: "pdf", uploadedAt: "2026-09-12T10:00:00.000Z",
  rawText: "", sizeBytes: 10, checksum: "sha-1", tags: [], linkedQuestionSetIds: ["set-1"], libraryOnly: false, ...over,
});
const saved = (id: string, from: typeof VEIN, over: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id, stem: from.stem, options: from.options, correctKey: "A", sourceDocumentId: "doc-1", ...over,
} as QuestionRecord);
const set = (over: Partial<QuestionSet> = {}): QuestionSet => ({
  id: "set-1", title: "Thorax quiz", sourceDocumentIds: ["doc-1"], createdAt: "2026-09-12T10:00:00.000Z",
  questionIds: ["q-1", "q-2"], tags: [], aiEnhanced: false, parserWarnings: [], ...over,
});
const library = (over: Partial<{ questions: QuestionRecord[]; questionSets: QuestionSet[]; documents: SourceDocument[] }> = {}) => ({
  questions: [saved("q-1", VEIN), saved("q-2", NERVE)], questionSets: [set()], documents: [document()], ...over,
});
const draft = (from: typeof VEIN): typeof VEIN & { warnings: string[]; parserRuleIds?: string[] } => ({ ...from, warnings: [] });

describe("findPriorImport", () => {
  it("knows a file by its bytes, whatever it is called now", () => {
    const prior = findPriorImport({ checksum: "sha-1", fileName: "renamed.pdf" }, library());
    expect(prior).toMatchObject({ relation: "same-file", document: { id: "doc-1" } });
    expect(prior?.questions.map((question) => question.id)).toEqual(["q-1", "q-2"]);
    expect(prior?.sets.map((entry) => entry.id)).toEqual(["set-1"]);
  });

  it("sees the same name with different bytes as another version", () => {
    expect(findPriorImport({ checksum: "sha-2", fileName: "thorax quiz.PDF" }, library())).toMatchObject({ relation: "other-version", document: { id: "doc-1" } });
  });

  it("is not an earlier import when the source was kept without questions, or its questions are gone", () => {
    expect(findPriorImport({ checksum: "sha-1", fileName: "Thorax Quiz.pdf" }, library({ questions: [] }))).toBeUndefined();
    expect(findPriorImport({ checksum: "sha-9", fileName: "other.pdf" }, library())).toBeUndefined();
  });
});

describe("alreadyImported", () => {
  it("matches a question by its wording, not by what the learner changed afterwards", () => {
    const edited = library({
      questions: [
        saved("q-1", VEIN, { explanation: "My own note.", tags: ["high-yield"], week: 9, module: "CPR", correctKey: "B" } as Partial<QuestionRecord>),
        saved("q-2", NERVE),
      ],
    });
    const prior = findPriorImport({ checksum: "sha-1", fileName: "Thorax Quiz.pdf" }, edited)!;
    const reflowed = { ...VEIN, stem: "  which vessel carries OXYGENATED blood from the lungs, to the heart ", options: VEIN.options.map((entry) => ({ ...entry, text: `${entry.text}.` })) };
    expect(alreadyImported([reflowed, HORMONE, NERVE], prior)).toEqual([true, false, true]);
  });
});

describe("applyPriorImport", () => {
  it("leaves what the file already brought in unselected, and says so", () => {
    const result = applyPriorImport([draft(VEIN), draft(NERVE)], { checksum: "sha-1", fileName: "Thorax Quiz.pdf" }, library());
    expect(result.selected).toEqual([false, false]);
    expect(result.note).toBe('This file was imported on 2026-09-12 as "Thorax quiz". Every question here is already in your bank, so none is selected. What you have changed on the earlier questions is left as it is.');
    expect(result.drafts[0].parserRuleIds).toEqual([ALREADY_IMPORTED_RULE]);
    expect(result.drafts[0].warnings[0]).toMatch(/already in your bank from an earlier import of this file/);
  });

  it("selects only what a changed version of the file adds", () => {
    const result = applyPriorImport([draft(VEIN), draft(NERVE), draft(HORMONE)], { checksum: "sha-2", fileName: "Thorax Quiz.pdf" }, library());
    expect(result.selected).toEqual([false, false, true]);
    expect(result.prior?.relation).toBe("other-version");
    expect(result.note).toBe('A different version of this file was imported on 2026-09-12 as "Thorax quiz". 2 of these 3 questions are already in your bank and are not selected. 1 is new. What you have changed on the earlier questions is left as it is.');
    expect(result.drafts[2]).toEqual(draft(HORMONE));
  });

  it("selects everything for a file never imported, and for a source the learner re-opened themselves", () => {
    expect(applyPriorImport([draft(VEIN)], { checksum: "sha-9", fileName: "new.pdf" }, library())).toEqual({ drafts: [draft(VEIN)], selected: [true] });
    expect(applyPriorImport([draft(VEIN)], { checksum: "sha-1", fileName: "Thorax Quiz.pdf", existingDocumentId: "doc-1" }, library())).toEqual({ drafts: [draft(VEIN)], selected: [true] });
    expect(applyPriorImport([draft(VEIN)], null, library())).toEqual({ drafts: [draft(VEIN)], selected: [true] });
  });
});
