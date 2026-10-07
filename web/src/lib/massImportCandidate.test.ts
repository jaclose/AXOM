import { describe, expect, it } from "vitest";
import { inferSourceMapping } from "./course-engine/sourceMapping";
import { moduleAliases } from "./course-engine/templateParse";
import { vocabularyFromCourses } from "./course-engine/vocabulary";
import type { QuestionSet, SourceDocument } from "./library";
import { FIGURE_AFTER_QUESTION_RULE, evaluateImportCandidate, scopeFromMapping } from "./massImportCandidate";
import { buildDuplicateIndex } from "./questionDuplicates";
import { parseQuestionBlocks, type ParsedQuestionDraft } from "./questionParse";
import type { QuestionRecord } from "./questions";

// Invented teaching content.
const TEXT = [
  "1. Which vessel carries oxygenated blood from the lungs to the heart?",
  "A. Pulmonary vein", "B. Pulmonary artery", "C. Aorta", "D. Vena cava",
  "Answer: A", "Explanation: The pulmonary veins return oxygenated blood to the left atrium.",
  "",
  "2. Which nerve supplies the diaphragm?",
  "A. Vagus nerve", "B. Phrenic nerve", "C. Intercostal nerve", "D. Accessory nerve",
  "Answer: B", "Explanation: The phrenic nerve arises from C3 to C5.",
].join("\n");
const ready = () => parseQuestionBlocks(TEXT);

const TERMS = [{ id: "term-1", name: "Term 1" }] as never[];
const COURSES = [{ id: "course-1", termId: "term-1", code: "BPM 500", name: "Basic principles", files: 0, modules: [{ id: "m-1", name: "FTM 1" }, { id: "m-2", name: "MSK" }] }] as never[];
const MODULES = ["FTM 1", "MSK"];
const mappingFor = (name: string) => inferSourceMapping(name, vocabularyFromCourses(TERMS, COURSES, moduleAliases));

function evaluate(over: Partial<Parameters<typeof evaluateImportCandidate>[0]> & { questions?: QuestionRecord[]; documents?: SourceDocument[]; questionSets?: QuestionSet[] } = {}) {
  const { questions = [], documents = [], questionSets = [], ...input } = over;
  return evaluateImportCandidate({
    drafts: ready(), fileName: "thorax.txt", checksum: "sha-new", modules: [],
    library: { questions, questionSets, documents }, duplicates: buildDuplicateIndex(questions), ...input,
  });
}
const codes = (result: ReturnType<typeof evaluate>) => result.blocks.map((block) => block.code);

describe("evaluateImportCandidate", () => {
  it("accepts a file whose every question is whole and answered, when there is nothing to file it under", () => {
    expect(evaluate()).toEqual({ valid: true, blocks: [], prior: undefined, scope: undefined });
  });

  it("is not valid with no questions", () => {
    expect(evaluate({ drafts: [] })).toMatchObject({ valid: false, blocks: [{ code: "no-questions", message: "No questions were found in this file." }] });
  });

  it("is not valid when an answer is missing or only inferred", () => {
    const unanswered = parseQuestionBlocks(TEXT.replace("Answer: B\n", ""));
    const result = evaluate({ drafts: unanswered });
    expect(result.valid).toBe(false);
    expect(result.blocks).toEqual([{ code: "answer-uncertain", message: "1 question has no certain answer.", count: 1 }]);
    const inferred = ready().map((draft) => ({ ...draft, parserRuleIds: [...(draft.parserRuleIds ?? []), "answer.explanation-prose"] }));
    expect(codes(evaluate({ drafts: inferred }))).toEqual(["answer-uncertain"]);
  });

  it("is not valid when a question's edges were left to judgement", () => {
    const fromDeck = ready().map((draft, index) => (index === 0 ? { ...draft, needsReview: true, parserRuleIds: [...(draft.parserRuleIds ?? []), "deck.options-before-stem"] } : draft));
    expect(evaluate({ drafts: fromDeck }).blocks).toEqual([{ code: "boundary-ambiguous", message: "1 question may start or end in the wrong place.", count: 1 }]);
    const split = ready().map((draft) => ({ ...draft, parserRuleIds: [...(draft.parserRuleIds ?? []), "question.malformed-boundary"] }));
    expect(codes(evaluate({ drafts: split }))).toEqual(["boundary-ambiguous"]);
  });

  it("is not valid when a question is incomplete, or the parser asks for a check", () => {
    const stemless = ready().map((draft, index) => (index === 0 ? { ...draft, stem: "" } : draft));
    expect(codes(evaluate({ drafts: stemless }))).toEqual(["question-incomplete"]);
    const flagged = ready().map((draft, index) => (index === 1 ? { ...draft, needsReview: true } : draft));
    expect(evaluate({ drafts: flagged }).blocks).toEqual([{ code: "needs-check", message: "1 question needs a check against the source.", count: 1 }]);
  });

  it("is not valid when an image may give the answer away, or would be left behind", () => {
    const withFigure = (rule: string): ParsedQuestionDraft[] => ready().map((draft, index) => (index === 0
      ? { ...draft, attachmentNames: ["thorax-p1-fig1.png"], parserRuleIds: [...(draft.parserRuleIds ?? []), rule] }
      : draft));
    expect(evaluate({ drafts: withFigure("figure.only-question-on-page"), imageCount: 1 }).valid).toBe(true);
    expect(evaluate({ drafts: withFigure(FIGURE_AFTER_QUESTION_RULE), imageCount: 1 }).blocks).toEqual([
      { code: "answer-leak-possible", message: "1 question has an image from the page after it, which may show the answer.", count: 1 },
    ]);
    expect(evaluate({ drafts: withFigure("figure.only-question-on-page"), imageCount: 3 }).blocks).toEqual([
      { code: "images-unplaced", message: "2 images could not be placed on a question, and would be left behind.", count: 2 },
    ]);
  });

  it("asks for a settled module and week once the learner has modules, and saves with exactly that", () => {
    const named = "FTM 1 Week 3 Quiz 2.txt";
    const settled = evaluate({ fileName: named, mapping: mappingFor(named), modules: MODULES });
    expect(settled).toMatchObject({ valid: true, scope: { module: "FTM 1", week: 3 } });

    const unnamed = evaluate({ fileName: "quiz.txt", mapping: mappingFor("quiz.txt"), modules: MODULES });
    expect(unnamed.valid).toBe(false);
    expect(unnamed.blocks).toEqual([{ code: "mapping-unresolved", message: "Its module and week are not settled from the file's name.", count: undefined }]);
    expect(unnamed.scope).toBeUndefined();
  });

  it("gives the review a starting scope for any reading, and an accepted file only a settled one", () => {
    const mapping = mappingFor("FTM 1 Week 3 Quiz 2.txt");
    expect(scopeFromMapping(mapping, MODULES)).toEqual({ module: "FTM 1", week: 3 });
    expect(scopeFromMapping(mapping, ["Some other module"])).toBeUndefined();
    expect(scopeFromMapping(undefined, MODULES)).toBeUndefined();
    const unsure = { ...mapping, status: "needs-confirmation" as const };
    expect(scopeFromMapping(unsure, MODULES)).toEqual({ module: "FTM 1", week: 3 });
    expect(evaluate({ fileName: "FTM 1 Week 3 Quiz 2.txt", mapping: unsure, modules: MODULES })).toMatchObject({ valid: false, scope: undefined });
  });

  it("is not valid when its questions are in the bank already", () => {
    const bank = ready().slice(0, 1).map((draft, index) => ({ id: `q-${index}`, stem: draft.stem, options: draft.options, correctKey: draft.correctKey }) as QuestionRecord);
    expect(evaluate({ questions: bank }).blocks).toEqual([
      { code: "duplicate-question", message: "1 question is already in your bank, or close to one that is.", count: 1 },
    ]);
  });

  it("names an earlier import of the same file, and a changed version of it, instead of counting duplicates", () => {
    const document: SourceDocument = { id: "doc-1", title: "thorax", fileName: "thorax.txt", fileType: "text", uploadedAt: "2026-09-12T10:00:00.000Z", rawText: TEXT, sizeBytes: 1, checksum: "sha-old", tags: [], linkedQuestionSetIds: ["set-1"], libraryOnly: false };
    const bank = ready().map((draft, index) => ({ id: `q-${index}`, stem: draft.stem, options: draft.options, correctKey: draft.correctKey, sourceDocumentId: "doc-1" }) as QuestionRecord);
    const same = evaluate({ checksum: "sha-old", questions: bank, documents: [document] });
    expect(same.valid).toBe(false);
    expect(codes(same)).toEqual(["already-imported"]);
    expect(same.prior?.relation).toBe("same-file");

    const changed = evaluate({ checksum: "sha-new", questions: bank, documents: [document] });
    expect(codes(changed)).toEqual(["source-changed"]);
    expect(changed.blocks[0].message).toBe("A different version of this file was imported before. Open it to bring in only what is new.");
  });
});
