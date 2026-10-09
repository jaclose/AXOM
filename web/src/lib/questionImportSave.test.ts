import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionSet, SourceDocument } from "./library";
import { parseQuestionBlocks } from "./questionParse";
import type { QuestionImportPersistence, ReviewedImportPersistencePlan } from "./questionImportFinalization";
import { blockedDraftIndexes, prepareReviewedImport, saveReviewedImport, type ReviewedDraft, type ReviewedImportRequest } from "./questionImportSave";
import type { QuestionRecord } from "./questions";
import * as imageImport from "./questionImportImages";
import * as vault from "./localVault";

afterEach(() => vi.restoreAllMocks());

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

const drafts = (text = TEXT): ReviewedDraft[] => parseQuestionBlocks(text).map((draft) => ({ ...draft, source: "imported" as const }));
const file = { title: "Thorax quiz", fileName: "thorax-quiz.txt", fileType: "text", sizeBytes: TEXT.length, rawText: TEXT, checksum: "sha-thorax" };
const empty = { questions: [] as QuestionRecord[], questionSets: [] as QuestionSet[], documents: [] as SourceDocument[] };

function request(over: Partial<ReviewedImportRequest> = {}): ReviewedImportRequest {
  return { drafts: drafts(), destination: "both", document: file, sourceType: "imported", setTitle: "Thorax quiz", parserWarnings: [], ...over };
}

/** Counting ids and a fixed clock, so two preparations of the same request can be compared. */
function make() {
  let next = 0;
  return { id: () => `id-${(next += 1)}`, now: () => "2026-10-07T09:00:00.000Z" };
}

/** A store that keeps what it is given, the way the workspace store's atomic commit does. */
function memoryStore(library = empty) {
  const state = { questions: [...library.questions], questionSets: [...library.questionSets], documents: [...library.documents] };
  const commits: ReviewedImportPersistencePlan[] = [];
  const updateQuestion = vi.fn<(id: string, patch: Partial<QuestionRecord>) => void>();
  const store: QuestionImportPersistence & { updateQuestion: typeof updateQuestion } = {
    commitReviewedImport: async (plan) => {
      commits.push(plan);
      state.questions.push(...(plan.questions as unknown as QuestionRecord[]));
      if (plan.questionSet) state.questionSets.push(plan.questionSet);
      if (plan.documentWrite?.kind === "create") state.documents.push(plan.documentWrite.document);
      return { ok: true, questionIds: plan.questions.map((question) => question.id), questionSetId: plan.questionSet?.id, documentId: plan.documentWrite?.kind === "create" ? plan.documentWrite.document.id : plan.documentWrite?.id };
    },
    addQuestion: vi.fn(), removeQuestion: vi.fn(), addQuestionSet: vi.fn(), removeQuestionSet: vi.fn(),
    addDocument: vi.fn(), updateDocument: vi.fn(), removeDocument: vi.fn(), updateQuestion,
  };
  return { store, state, commits };
}

describe("prepareReviewedImport", () => {
  it("shapes a set, its questions and its source the same way for every caller", () => {
    const prepared = prepareReviewedImport(request({ scope: { module: "FTM 1", week: 3 }, category: "Anatomy" }), empty, make());
    if (!prepared.ok) throw new Error("expected a prepared import");
    expect(prepared).toMatchObject({ wantsSet: true, wantsDoc: true, setTitle: "Thorax quiz", equivalent: undefined, existingDocumentId: undefined });

    const { questions, questionSet, documentWrite } = prepared.plan;
    expect(questions).toHaveLength(2);
    expect(questionSet).toMatchObject({ title: "Thorax quiz", kind: "source", scope: { module: "FTM 1", week: 3 }, tags: ["Anatomy"], questionIds: questions.map((question) => question.id) });
    expect(documentWrite).toMatchObject({ kind: "create", document: { fileName: "thorax-quiz.txt", checksum: "sha-thorax", libraryOnly: false, linkedQuestionSetIds: [questionSet!.id] } });
    expect(questions[0]).toMatchObject({
      stem: "Which vessel carries oxygenated blood from the lungs to the heart?",
      correctKey: "A", correctAnswerText: "Pulmonary vein", bank: "Thorax quiz", category: "Anatomy",
      module: "FTM 1", week: 3, setId: questionSet!.id, status: "unseen", questionNumber: 1,
      sourceFile: { name: "thorax-quiz.txt", type: "text" }, citation: "thorax-quiz.txt",
      extraction: { reviewed: true, confidence: "high" },
    });
    expect(questions[0].sourceDocumentId).toBe(documentWrite?.kind === "create" ? documentWrite.document.id : undefined);
  });

  it("is the same preparation every time for the same request", () => {
    expect(prepareReviewedImport(request(), empty, make())).toEqual(prepareReviewedImport(request(), empty, make()));
  });

  it("refuses when there is nothing to save", () => {
    expect(prepareReviewedImport(request({ drafts: [], document: null }), empty)).toEqual({ ok: false, reason: "nothing-to-save" });
    expect(prepareReviewedImport(request({ drafts: [], destination: "set" }), empty)).toEqual({ ok: false, reason: "nothing-to-save" });
  });

  it("refuses a question with no answer, and one that needs review until the learner accepts it", () => {
    const unanswered = drafts(TEXT.replace("Answer: B\n", ""));
    expect(prepareReviewedImport(request({ drafts: unanswered }), empty)).toEqual({ ok: false, reason: "review-incomplete", blocked: [1] });

    const flagged = drafts().map((draft, index) => (index === 0 ? { ...draft, needsReview: true } : draft));
    expect(blockedDraftIndexes(flagged)).toEqual([0]);
    expect(prepareReviewedImport(request({ drafts: flagged }), empty)).toMatchObject({ ok: false, reason: "review-incomplete", blocked: [0] });
    const acknowledged = flagged.map((draft) => ({ ...draft, reviewAcknowledged: true }));
    const prepared = prepareReviewedImport(request({ drafts: acknowledged }), empty);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect((prepared.plan.questions[0].extraction as { parserRuleIds: string[] }).parserRuleIds).toContain("import.user-reviewed");
  });

  it("keeps a source for later without checking its questions", () => {
    const unanswered = drafts(TEXT.replace("Answer: B\n", ""));
    const prepared = prepareReviewedImport(request({ drafts: unanswered, destination: "doc" }), empty, make());
    expect(prepared).toMatchObject({ ok: true, wantsSet: false, wantsDoc: true, plan: { questions: [], questionSet: undefined, documentWrite: { kind: "create", document: { libraryOnly: true, linkedQuestionSetIds: [] } } } });
  });

  it("links a new set to the library's existing record of the file instead of copying it", () => {
    const existing: SourceDocument = { id: "doc-1", title: "Thorax quiz", fileName: "thorax-quiz.txt", fileType: "text", uploadedAt: "2026-09-01T00:00:00.000Z", rawText: TEXT, sizeBytes: TEXT.length, checksum: "sha-thorax", tags: [], linkedQuestionSetIds: [], libraryOnly: true };
    const prepared = prepareReviewedImport(request(), { ...empty, documents: [existing] }, make());
    if (!prepared.ok) throw new Error("expected a prepared import");
    expect(prepared.existingDocumentId).toBe("doc-1");
    expect(prepared.plan.documentWrite).toMatchObject({ kind: "update", id: "doc-1", patch: { libraryOnly: false, linkedQuestionSetIds: [prepared.plan.questionSet!.id] } });
    expect(prepared.plan.questions.every((question) => question.sourceDocumentId === "doc-1")).toBe(true);
  });
});

describe("saveReviewedImport", () => {
  it("writes the prepared import once, as one commit", async () => {
    const { store, state, commits } = memoryStore();
    const prepared = prepareReviewedImport(request(), empty, make());
    if (!prepared.ok) throw new Error("expected a prepared import");
    const saved = await saveReviewedImport(prepared, store);
    expect(saved).toMatchObject({ ok: true, reused: false, joined: false, reusedDocument: false, questionIds: prepared.plan.questions.map((question) => question.id), images: { attached: 0, missing: 0, problems: [] } });
    expect(commits).toHaveLength(1);
    expect([state.questions.length, state.questionSets.length, state.documents.length]).toEqual([2, 1, 1]);
  });

  it("reuses an identical earlier import instead of writing it again", async () => {
    const { store, state, commits } = memoryStore();
    const first = prepareReviewedImport(request(), empty, make());
    if (!first.ok) throw new Error("expected a prepared import");
    await saveReviewedImport(first, store);

    const again = prepareReviewedImport(request(), state);
    if (!again.ok) throw new Error("expected a prepared import");
    expect(again.equivalent).toMatchObject({ setId: first.plan.questionSet!.id, questionIds: first.plan.questions.map((question) => question.id) });
    const saved = await saveReviewedImport(again, store);
    expect(saved).toMatchObject({ ok: true, reused: true, setId: first.plan.questionSet!.id, reusedDocument: true });
    expect(commits).toHaveLength(1);
    expect([state.questions.length, state.questionSets.length, state.documents.length]).toEqual([2, 1, 1]);
  });

  it("reports a failed write and saves nothing more", async () => {
    const { store } = memoryStore();
    store.commitReviewedImport = async () => ({ ok: false, message: "The device is full.", rollbackFailures: [] });
    const prepared = prepareReviewedImport(request(), empty, make());
    if (!prepared.ok) throw new Error("expected a prepared import");
    expect(await saveReviewedImport(prepared, store)).toEqual({ ok: false, message: "The device is full.", rollbackFailures: [] });
    expect(store.updateQuestion).not.toHaveBeenCalled();
  });

  it("counts a named image that was not supplied as missing, and never fails the import for it", async () => {
    const { store } = memoryStore();
    const withImage = drafts().map((draft, index) => (index === 0 ? { ...draft, attachmentNames: ["thorax-p1-fig1.png"] } : draft));
    const prepared = prepareReviewedImport(request({ drafts: withImage }), empty, make());
    if (!prepared.ok) throw new Error("expected a prepared import");
    expect(prepared.attachmentNames).toEqual([["thorax-p1-fig1.png"], []]);
    expect(await saveReviewedImport(prepared, store, [])).toMatchObject({ ok: true, images: { attached: 0, missing: 1, problems: [] } });
  });

  it.each([false, true])("waits for image associations and reports a failed vault write (%s)", async (fail) => {
    const { store } = memoryStore();
    const prepared = prepareReviewedImport(request({ drafts: drafts().map((draft, i) => ({
      ...draft, attachmentNames: i === 0 ? ["figure.png"] : [],
    })) }), empty, make());
    if (!prepared.ok) throw new Error("expected prepared import");
    vi.spyOn(imageImport, "attachNamedImages").mockResolvedValue({ attachments: [{
      id: "figure", blobKey: "figure", fileName: "figure.png", mimeType: "image/png",
      byteSize: 10, altText: "", createdAt: "2026-10-08", updatedAt: "2026-10-08", role: "exhibit",
    }], problems: [] });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const flush = vi.spyOn(vault, "flushLocalVaultWrites").mockReturnValue(pending);
    vi.spyOn(vault, "assertVaultWritesSince").mockImplementation(() => {
      if (fail) throw new Error("Storage full");
    });
    let finished = false;
    const saving = saveReviewedImport(prepared, store, [new File(["image"], "figure.png")])
      .then((result) => { finished = true; return result; });
    await vi.waitFor(() => expect(flush).toHaveBeenCalled());
    expect(finished).toBe(false);
    release();
    const result = await saving;
    expect(result).toMatchObject({ ok: true, images: { attached: fail ? 0 : 1, missing: 0 } });
    if (result.ok) expect(result.images.problems).toHaveLength(fail ? 1 : 0);
  });
});
