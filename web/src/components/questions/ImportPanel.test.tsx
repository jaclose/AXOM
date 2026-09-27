// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceDocument } from "../../lib/library";
import type { ParsedQuestionDraft } from "../../lib/questionParse";
import { ImportPanel, parseStoredDocument, preserveUserReviewedMappings } from "./ImportPanel";
import { importFromCsv, importFromJson } from "../../lib/questionImport";
import { pushToast } from "../../lib/toast";

const mocked = vi.hoisted(() => ({
  addDocument: vi.fn(),
  addQuestion: vi.fn(),
  addQuestionSet: vi.fn(),
  removeDocument: vi.fn(),
  removeQuestion: vi.fn(),
  removeQuestionSet: vi.fn(),
  updateDocument: vi.fn(),
  documents: [] as SourceDocument[],
}));

vi.mock("../../lib/store", () => ({ useStore: () => mocked }));
vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));
vi.mock("../../lib/ai", () => ({
  checkProviderHealth: vi.fn(async () => ({ ok: false, detail: "No provider" })),
  cleanExplanation: vi.fn(),
  enhanceQuestionSet: vi.fn(),
  generateQuestionDrafts: vi.fn(),
  loadAiSettings: vi.fn(() => ({ mode: "demo" })),
  mapAnswerFromText: vi.fn(),
  resolveActiveProvider: vi.fn(() => null),
}));

const draft: ParsedQuestionDraft = {
  stem: "Which option is correct?",
  options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  correctKey: "B",
  correctAnswerText: "Beta",
  confidence: "high",
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.documents.splice(0);
  mocked.addQuestion.mockReturnValue({ ok: true, errors: [], id: "question-1" });
});
afterEach(cleanup);

describe("source-document-first import", () => {
  it("blocks an unresolved mapping even if confidence is malformed high", () => {
    render(<ImportPanel seed={{
      drafts: [{ ...draft, correctKey: undefined, correctAnswerText: undefined }],
      rawText: "Which option is correct?\nA. Alpha\nB. Beta",
      title: "Unresolved import",
      fileName: "unresolved.txt",
      fileType: "text",
    }} />);

    expect(screen.getByText("Invalid")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);
    expect(mocked.addQuestion).not.toHaveBeenCalled();
  });

  it("associates review blockers with their fields and explains disabled finalization", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [{
        ...draft,
        correctKey: undefined,
        correctAnswerText: undefined,
        explanation: "Boundary needs review.",
        needsReview: true,
        parserRuleIds: ["explanation.ambiguous-boundary"],
      }],
      rawText: "Question source", title: "Accessible review", fileName: "accessible.txt", fileType: "text",
    }} />);

    const finalize = screen.getByRole("button", { name: "Finalize import" });
    const finalizeStatus = document.getElementById(finalize.getAttribute("aria-describedby") ?? "");
    expect(finalize).toHaveProperty("disabled", true);
    expect(finalizeStatus?.textContent).toMatch(/1 included question still needs correction/i);

    await user.click(screen.getByRole("button", { name: /Which option is correct/ }));
    const reasons = screen.getByText("Select a correct answer before finalizing.").closest("div");
    const explanation = screen.getByLabelText("Explanation or rationale");
    const answer = screen.getByLabelText("Correct answer");
    expect(explanation.getAttribute("aria-invalid")).toBe("true");
    expect(explanation.getAttribute("aria-describedby")).toBe(reasons?.id);
    expect(answer.getAttribute("aria-invalid")).toBe("true");
    expect(answer.getAttribute("aria-describedby")).toBe(reasons?.id);
  });

  it("groups repeated review fields under each question's accessible name", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [
        { ...draft, questionNumber: 1, stem: "First grouped stem?" },
        { ...draft, questionNumber: 2, stem: "Second grouped stem?" },
      ],
      rawText: "Two questions", title: "Accessible groups", fileName: "groups.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: /1\. First grouped stem/ }));
    await user.click(screen.getByRole("button", { name: /2\. Second grouped stem/ }));
    const first = screen.getByRole("group", { name: /1\. First grouped stem/ });
    const second = screen.getByRole("group", { name: /2\. Second grouped stem/ });
    expect(within(first).getByRole("textbox", { name: "Stem" })).toHaveProperty("value", "First grouped stem?");
    expect(within(second).getByRole("textbox", { name: "Stem" })).toHaveProperty("value", "Second grouped stem?");
    expect(within(first).getByLabelText("Correct answer")).toHaveProperty("value", "B");
    expect(within(second).getByLabelText("Option A")).toHaveProperty("value", "Alpha");
  });

  it("summarizes ready, suggested, unresolved, and explanation coverage", () => {
    render(<ImportPanel seed={{
      drafts: [
        { ...draft, explanation: "Grounded rationale." },
        { ...draft, correctKey: "A", correctAnswerText: "Alpha", confidence: "medium" },
        { ...draft, correctKey: undefined, correctAnswerText: undefined, confidence: "low", needsReview: true },
      ],
      rawText: "Sanitized source",
      title: "Trust summary",
      fileName: "summary.txt",
      fileType: "text",
    }} />);

    expect(screen.getByText("High 1").textContent).toBe("High 1");
    expect(screen.getByText("Needs Review 1").textContent).toBe("Needs Review 1");
    expect(screen.getByText("Invalid 1").textContent).toBe("Invalid 1");
    expect(screen.getByText(/Explanations found/).textContent).toContain("1");
    expect(screen.getByRole("button", { name: "Select High (1)" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Review flagged (1)" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Repair invalid (1)" }).hasAttribute("disabled")).toBe(false);
  });

  it("persists an explicit manual answer confirmation at medium confidence", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [{
        ...draft,
        correctKey: undefined,
        correctAnswerText: undefined,
        confidence: "low",
        needsReview: true,
        questionDetectionConfidence: 0.7,
        answerDetectionConfidence: 0,
        explanationDetectionConfidence: 0,
        overallImportConfidence: 0.28,
      }],
      rawText: "Which option is correct?\nA. Alpha\nB. Beta",
      title: "Manual review",
      fileName: "manual.txt",
      fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: /Which option is correct/ }));
    await user.selectOptions(screen.getByLabelText("Correct answer"), "B");
    await user.click(screen.getByRole("button", { name: "Mark source review complete" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    expect(mocked.addQuestion).toHaveBeenCalledWith(expect.objectContaining({
      correctKey: "B",
      extraction: expect.objectContaining({
        confidence: "medium",
        reviewed: true,
        reviewedAt: expect.any(String),
        parserRuleIds: expect.arrayContaining(["answer.user-reviewed-mapping"]),
      }),
    }));
  });

  it("preselects a structured drift candidate, shows evidence, and keeps it review-gated until confirmation", async () => {
    const user = userEvent.setup();
    const [candidate] = importFromCsv([
      "question,a,b,c,answer",
      '"Which cell releases histamine?","Mast cells","CD4+ T lymphocytes","B lymphocytes","A. Mast cell"',
    ].join("\n")).drafts;
    render(<ImportPanel seed={{
      drafts: [candidate],
      rawText: "Structured CSV source",
      title: "Structured drift",
      fileName: "drift.csv",
      fileType: "csv",
    }} />);

    expect(screen.getAllByText("Needs Review").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Which cell releases histamine/ }));
    expect((screen.getByLabelText("Correct answer") as HTMLSelectElement).value).toBe("A");
    expect(document.body.textContent).toContain("Answer evidence: A. Mast cell");
    expect(screen.getByText(/Explicit answer letter A was preserved/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Confirm mapped answer A" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    expect(mocked.addQuestion).toHaveBeenCalledWith(expect.objectContaining({
      correctKey: "A",
      needsReview: undefined,
      extraction: expect.objectContaining({
        reviewed: true,
        parserRuleIds: expect.arrayContaining([
          "answer.explicit-letter-text-drift",
          "answer.user-reviewed-mapping",
        ]),
      }),
    }));
  });

  it("shows both sides of a JSON letter/text conflict without preselecting an answer", async () => {
    const user = userEvent.setup();
    const [conflict] = importFromJson(JSON.stringify([{
      stem: "Which cell?",
      options: [
        { key: "A", text: "Mast cells" },
        { key: "B", text: "CD4+ T lymphocytes" },
        { key: "C", text: "B lymphocytes" },
      ],
      answer: "A. B lymphocytes",
    }])).drafts;
    render(<ImportPanel seed={{
      drafts: [conflict],
      rawText: "Structured JSON source",
      title: "Structured conflict",
      fileName: "conflict.json",
      fileType: "json",
    }} />);

    await user.click(screen.getByRole("button", { name: /Which cell/ }));
    expect((screen.getByLabelText("Correct answer") as HTMLSelectElement).value).toBe("");
    expect(document.body.textContent).toContain("letter A vs text of option C");
    expect(document.body.textContent).toContain("Answer evidence: A. B lymphocytes");
  });

  it("saves a no-question source as library-only without creating fake records", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [],
      rawText: "Reference notes without a question pattern.",
      title: "Reference notes",
      fileName: "notes.txt",
      fileType: "text",
    }} />);

    expect(screen.getByRole("button", { name: "Source document only" }).className).toContain("on");
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    expect(mocked.addQuestion).not.toHaveBeenCalled();
    expect(mocked.addQuestionSet).not.toHaveBeenCalled();
    expect(mocked.addDocument).toHaveBeenCalledWith(expect.objectContaining({
      title: "Reference notes",
      linkedQuestionSetIds: [],
      libraryOnly: true,
    }));
  });

  it("retains review and rolls back when persistence rejects a preflight-valid question", async () => {
    const user = userEvent.setup();
    mocked.addQuestion.mockReturnValue({ ok: false, errors: ["Invalid question"] });
    render(<ImportPanel seed={{
      drafts: [draft],
      rawText: "Which option is correct?\nA. Alpha\nB. Beta",
      title: "Failed set",
      fileName: "failed.txt",
      fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    expect(mocked.addQuestionSet).not.toHaveBeenCalled();
    expect(mocked.addDocument).not.toHaveBeenCalled();
    expect(screen.getByText(/Review 1 parsed question/)).toBeTruthy();
  });

  it("derives the persisted correct-answer text from the learner's edited option", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [draft], rawText: "Question source", title: "Edited answer",
      fileName: "edited.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: /Which option is correct/ }));
    await user.clear(screen.getByLabelText("Option B"));
    await user.type(screen.getByLabelText("Option B"), "Updated beta");
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    expect(mocked.addQuestion).toHaveBeenCalledWith(expect.objectContaining({
      correctKey: "B",
      correctAnswerText: "Updated beta",
      options: expect.arrayContaining([{ key: "B", text: "Updated beta" }]),
    }));
  });

  it("removes an invalid question explicitly and finalizes only the remaining valid question", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [
        { ...draft, questionNumber: 1 },
        { ...draft, questionNumber: 2, stem: "Malformed second question", correctKey: undefined, correctAnswerText: undefined },
      ],
      rawText: "Two source questions", title: "Remove malformed", fileName: "remove.txt", fileType: "text",
    }} />);

    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Remove question 2" }));
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Which option is correct/ }),
    ));
    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", false);
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    expect(mocked.addQuestion).toHaveBeenCalledTimes(1);
    expect(mocked.addQuestionSet).toHaveBeenCalledWith(expect.objectContaining({ questionIds: ["question-1"] }));
  });

  it("returns to the full source text without losing it and reparses an edit", async () => {
    const user = userEvent.setup();
    const rawText = "1. Original stem?\nA. Alpha\nB. Beta\nAnswer: B";
    render(<ImportPanel seed={{
      drafts: [draft], rawText, title: "Return source", fileName: "return.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: "Back to source" }));
    const source = screen.getByLabelText("Edit extracted source text from return.txt") as HTMLTextAreaElement;
    expect(source.value).toBe(rawText);
    await user.clear(source);
    await user.type(source, "1. Revised stem?\nA. Alpha\nB. Beta\nAnswer: B");
    await user.click(screen.getByRole("button", { name: "Parse and review" }));

    expect(screen.getByRole("button", { name: /Revised stem/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Revised stem/ }));
    expect(document.body.textContent).toContain("import.source-text-edited");
    await user.click(screen.getByRole("button", { name: "Confirm mapped answer B" }));
    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Mark source review complete" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to source" }));
    expect((screen.getByLabelText("Edit extracted source text from return.txt") as HTMLTextAreaElement).value)
      .toContain("Revised stem");
  });

  it("does not let an unrelated metadata edit acknowledge an ambiguous answer", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [{
        ...draft,
        confidence: "medium",
        needsReview: true,
        parserRuleIds: ["answer.text-option-match"],
      }],
      rawText: "Question source", title: "Review scope", fileName: "scope.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: /Which option is correct/ }));
    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);
    await user.type(screen.getByLabelText("Topic"), "Immunology");
    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Mark source review complete" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Confirm mapped answer B" }));
    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", false);
  });

  it("does not clear a structural boundary guard through a cosmetic option edit", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [{ ...draft, needsReview: true, parserRuleIds: ["question.malformed-boundary"] }],
      rawText: "Question source", title: "Boundary review", fileName: "boundary.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: /Which option is correct/ }));
    await user.type(screen.getByLabelText("Option B"), " corrected");
    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Confirm this is one complete question" }));
    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", false);
  });

  it("keeps a three-file queue intact across review, source return, correction, removal, and finalization", async () => {
    const user = userEvent.setup();
    const onFinalized = vi.fn();
    render(<ImportPanel initialTab="batch" onFinalized={onFinalized} />);
    const contents = "1. Stable question?\nA. Alpha\nB. Beta\nAnswer: B\nExplanation: Stable rationale.";
    const secondContents = [
      contents,
      "",
      "2. Malformed question retained for review?",
      "A. Only one option",
    ].join("\n");
    const files = [
      new File([contents], "first.txt", { type: "text/plain" }),
      new File([secondContents], "second.txt", { type: "text/plain" }),
      new File([contents], "third.txt", { type: "text/plain" }),
    ];
    await user.upload(screen.getByLabelText("Choose multiple question files"), files);
    await user.click(screen.getByRole("button", { name: "Import files" }));
    await screen.findByRole("button", { name: "Inspect first.txt" });
    await screen.findByRole("button", { name: "Inspect second.txt" });
    await screen.findByRole("button", { name: "Inspect third.txt" });
    await user.click(screen.getByRole("button", { name: "Inspect first.txt" }));
    await user.click(screen.getByRole("button", { name: "Back to source" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Inspect first.txt" })));
    await user.click(screen.getByRole("button", { name: "Paste text" }));
    const source = screen.getByLabelText("Edit extracted source text from first.txt");
    await user.clear(source);
    await user.type(source, contents.replace("Stable question", "Revised batch question"));
    await user.click(screen.getByRole("button", { name: "Parse and review" }));
    await user.click(screen.getByRole("button", { name: /Revised batch question/ }));
    await user.click(screen.getByRole("button", { name: "Mark source review complete" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    const secondInspect = await screen.findByRole("button", { name: "Inspect second.txt" });
    await waitFor(() => expect(document.activeElement).toBe(secondInspect));
    expect(screen.getByRole("button", { name: "Inspect third.txt" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Inspect first.txt" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Inspect second.txt" }));
    await user.click(screen.getByRole("button", { name: "Back to source" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Inspect second.txt" })));
    expect(screen.queryByRole("button", { name: "Inspect first.txt" })).toBeNull();
    expect(screen.getByRole("button", { name: "Inspect second.txt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inspect third.txt" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Inspect second.txt" }));
    await user.click(screen.getByRole("button", { name: /Stable question/ }));
    const beta = screen.getByLabelText("Option B");
    await user.clear(beta);
    await user.type(beta, "Reviewed beta");
    await user.click(screen.getByRole("button", { name: "Remove question 2" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    const thirdInspect = await screen.findByRole("button", { name: "Inspect third.txt" });
    await waitFor(() => expect(document.activeElement).toBe(thirdInspect));
    expect(screen.queryByRole("button", { name: "Inspect second.txt" })).toBeNull();
    expect(onFinalized).not.toHaveBeenCalled();
  });

  it("lets the learner correct the source question number", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [{ ...draft, questionNumber: 7 }], rawText: "7. Source", title: "Renumber",
      fileName: "numbered.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: /7\. Which option/ }));
    const number = screen.getByLabelText("Question number") as HTMLInputElement;
    await user.clear(number);
    await user.type(number, "12");
    expect(number.value).toBe("12");
  });

  it("prevents a repeated finalize gesture from creating duplicate records", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [draft], rawText: "Question source", title: "Idempotent",
      fileName: "idempotent.txt", fileType: "text",
    }} />);

    await user.dblClick(screen.getByRole("button", { name: "Finalize import" }));
    expect(mocked.addQuestion).toHaveBeenCalledTimes(1);
    expect(mocked.addQuestionSet).toHaveBeenCalledTimes(1);
    expect(mocked.addDocument).toHaveBeenCalledTimes(1);
  });

  it("joins the same finalization after an in-flight unmount and remount", async () => {
    const user = userEvent.setup();
    let releaseQuestion!: () => void;
    const questionGate = new Promise<void>((resolve) => { releaseQuestion = resolve; });
    mocked.addQuestion.mockImplementation(async () => {
      await questionGate;
      return { ok: true, errors: [], id: "question-joined" };
    });
    const seed = {
      drafts: [draft], rawText: "Question source", title: "In-flight remount",
      fileName: "in-flight.txt", fileType: "text", checksum: "in-flight-checksum",
    };
    const first = render(<ImportPanel seed={seed} />);
    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    await waitFor(() => expect(mocked.addQuestion).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<ImportPanel seed={seed} />);
    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    expect(mocked.addQuestion).toHaveBeenCalledTimes(1);
    releaseQuestion();

    await waitFor(() => expect(screen.queryByRole("button", { name: "Finalize import" })).toBeNull());
    expect(mocked.addQuestion).toHaveBeenCalledTimes(1);
    expect(mocked.addQuestionSet).toHaveBeenCalledTimes(1);
    expect(mocked.addDocument).toHaveBeenCalledTimes(1);
  });

  it("rolls back newly added questions if a later write unexpectedly fails", async () => {
    const user = userEvent.setup();
    mocked.addQuestion
      .mockReturnValueOnce({ ok: true, errors: [], id: "first-created" })
      .mockReturnValueOnce({ ok: false, errors: ["Second write failed"] });
    render(<ImportPanel seed={{
      drafts: [{ ...draft, questionNumber: 1 }, { ...draft, questionNumber: 2, stem: "Second valid question" }],
      rawText: "Two valid questions", title: "Atomic finalize", fileName: "atomic.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    expect(mocked.removeQuestion).toHaveBeenCalledWith("first-created");
    expect(mocked.addQuestionSet).not.toHaveBeenCalled();
    expect(mocked.addDocument).not.toHaveBeenCalled();
    expect(screen.getByText(/Review 2 parsed questions/)).toBeTruthy();
  });

  it("parses a saved document locally and preserves mixed answer mappings", () => {
    const document: SourceDocument = {
      id: "doc-1",
      title: "Saved source",
      fileName: "questions.txt",
      fileType: "text",
      uploadedAt: "2026-07-12T00:00:00.000Z",
      rawText: [
        "1. First question?", "A. One", "B. Two", "Answer: B", "",
        "2. Second question?", "A. Alpha", "B. Beta", "Answer: A",
      ].join("\n"),
      sizeBytes: 100,
      tags: [],
      linkedQuestionSetIds: [],
      libraryOnly: true,
    };
    expect(parseStoredDocument(document).drafts.map((question) => question.correctKey)).toEqual(["B", "A"]);
  });

  it("keeps a user-confirmed mapping above conflicting re-import output", () => {
    const reparsed = importFromJson(JSON.stringify([{
      stem: "Reparsed question",
      options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }],
      answer: "A",
    }])).drafts;
    const preserved = preserveUserReviewedMappings(reparsed, [{
      id: "existing", source: "imported", sourceDocumentId: "doc-1", questionNumber: 1,
      stem: "Original question", options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }],
      correctKey: "B", correctAnswerText: "Beta", status: "unseen", tags: [], attempts: [],
      extraction: {
        confidence: "high", reviewed: true,
        parserRuleIds: ["answer.user-reviewed-mapping"],
      },
      createdAt: "2026-07-17T00:00:00.000Z", updatedAt: "2026-07-17T00:00:00.000Z",
    }], "doc-1");
    expect(preserved[0]).toMatchObject({
      correctKey: "B",
      correctAnswerText: "Beta",
    });
    expect(preserved[0].needsReview).toBeFalsy();
    expect(preserved[0].parserRuleIds).toContain("answer.user-reviewed-mapping");
    expect(preserved[0].warnings.join(" ")).toContain("Preserved user-confirmed answer B");
  });

  it("does not clear a non-answer review gate while preserving a user-confirmed mapping", () => {
    const reparsed = importFromJson(JSON.stringify([{
      stem: "Structurally incomplete question",
      options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
      answer: "A",
    }])).drafts;
    expect(reparsed[0]).toMatchObject({
      questionDetectionConfidence: 0.6,
      needsReview: true,
    });
    const preserved = preserveUserReviewedMappings(reparsed, [{
      id: "existing-low-confidence", source: "imported", sourceDocumentId: "doc-low-confidence", questionNumber: 1,
      stem: "Original question", options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
      correctKey: "B", correctAnswerText: "Beta", status: "unseen", tags: [], attempts: [],
      extraction: {
        confidence: "high", reviewed: true,
        parserRuleIds: ["answer.user-reviewed-mapping"],
      },
      createdAt: "2026-07-17T00:00:00.000Z", updatedAt: "2026-07-17T00:00:00.000Z",
    }], "doc-low-confidence");
    expect(preserved[0]).toMatchObject({
      correctKey: "B",
      questionDetectionConfidence: 0.6,
      needsReview: true,
    });
  });

  it("keeps duplicate-question-number review active while preserving a confirmed answer", () => {
    const reparsed = importFromJson(JSON.stringify([{
      stem: "Duplicate-number question",
      options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }],
      answer: "B trailing drift",
    }])).drafts.map((question) => ({
      ...question,
      needsReview: true,
      parserRuleIds: [
        ...(question.parserRuleIds ?? []),
        "conflict.duplicate-question-number",
      ],
    }));
    const preserved = preserveUserReviewedMappings(reparsed, [{
      id: "existing-duplicate-number", source: "imported", sourceDocumentId: "doc-duplicate-number", questionNumber: 1,
      stem: "Original question", options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }],
      correctKey: "B", correctAnswerText: "Beta", status: "unseen", tags: [], attempts: [],
      extraction: {
        confidence: "high", reviewed: true,
        parserRuleIds: ["answer.user-reviewed-mapping"],
      },
      createdAt: "2026-07-17T00:00:00.000Z", updatedAt: "2026-07-17T00:00:00.000Z",
    }], "doc-duplicate-number");
    expect(preserved[0]).toMatchObject({
      correctKey: "B",
      needsReview: true,
      parserRuleIds: expect.arrayContaining(["conflict.duplicate-question-number"]),
    });
  });

  it("reuses the saved document ID when parsed questions are saved later", async () => {
    const user = userEvent.setup();
    const existing: SourceDocument = {
      id: "doc-existing",
      title: "Existing source",
      fileName: "existing.txt",
      fileType: "text",
      uploadedAt: "2026-07-12T00:00:00.000Z",
      rawText: "Which option is correct?\nA. Alpha\nB. Beta",
      sizeBytes: 100,
      tags: [],
      linkedQuestionSetIds: [],
      libraryOnly: true,
    };
    mocked.documents.push(existing);
    render(<ImportPanel seed={{
      drafts: [draft],
      rawText: existing.rawText,
      title: existing.title,
      fileName: existing.fileName,
      fileType: existing.fileType,
      sourceDocumentId: existing.id,
    }} />);

    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    expect(mocked.addDocument).not.toHaveBeenCalled();
    expect(mocked.updateDocument).toHaveBeenCalledWith("doc-existing", expect.objectContaining({
      linkedQuestionSetIds: [expect.any(String)],
      libraryOnly: false,
    }));
    expect(mocked.addQuestionSet).toHaveBeenCalledWith(expect.objectContaining({
      sourceDocumentIds: ["doc-existing"],
      questionIds: ["question-1"],
    }));
  });

  it("maintains the reverse source link in Questions-only mode", async () => {
    const user = userEvent.setup();
    const existing: SourceDocument = {
      id: "doc-questions-only", title: "Existing source", fileName: "existing.txt", fileType: "text",
      uploadedAt: "2026-07-12T00:00:00.000Z", rawText: "Question source", sizeBytes: 15,
      tags: [], linkedQuestionSetIds: [], libraryOnly: true,
    };
    mocked.documents.push(existing);
    render(<ImportPanel seed={{
      drafts: [draft], rawText: existing.rawText, title: existing.title, fileName: existing.fileName,
      fileType: existing.fileType, sourceDocumentId: existing.id, sizeBytes: existing.sizeBytes,
    }} />);

    await user.click(screen.getByRole("button", { name: "Questions" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    expect(mocked.updateDocument).toHaveBeenCalledWith(existing.id, expect.objectContaining({
      linkedQuestionSetIds: [expect.any(String)], libraryOnly: false,
    }));
    expect(mocked.addQuestion).toHaveBeenCalledWith(expect.objectContaining({
      sourceDocumentId: existing.id,
      sourceFile: expect.objectContaining({ name: existing.fileName, size: existing.sizeBytes }),
    }));
  });

  it("does not create a dangling link when an existing source was deleted during review", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [draft], rawText: "Question source", title: "Deleted source", fileName: "deleted.txt",
      fileType: "text", sourceDocumentId: "missing-document",
    }} />);

    await user.click(screen.getByRole("button", { name: "Questions" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    expect(mocked.addQuestion).toHaveBeenCalledWith(expect.objectContaining({ sourceDocumentId: undefined }));
    expect(mocked.addQuestionSet).toHaveBeenCalledWith(expect.objectContaining({ sourceDocumentIds: [] }));
  });

  it("rolls back the set and questions if source persistence throws", async () => {
    const user = userEvent.setup();
    mocked.addDocument.mockImplementationOnce(() => { throw new Error("Document write failed"); });
    render(<ImportPanel seed={{
      drafts: [draft], rawText: "Question source", title: "Rollback all", fileName: "rollback.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    expect(mocked.removeQuestionSet).toHaveBeenCalledWith(expect.any(String));
    expect(mocked.removeQuestion).toHaveBeenCalledWith("question-1");
    expect(screen.getByText(/Review 1 parsed question/)).toBeTruthy();
  });

  it("clears an answer mapping when a label collision makes option identity ambiguous", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [{
        ...draft,
        options: [
          { key: "A", text: "Alpha" },
          { key: "B", text: "Beta" },
          { key: "C", text: "Gamma" },
          { key: "D", text: "Delta" },
        ],
      }],
      rawText: "Question source", title: "Collision review", fileName: "collision.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: /Which option is correct/ }));
    fireEvent.change(screen.getByLabelText("Label for option 2"), { target: { value: "D" } });
    expect((screen.getByLabelText("Correct answer") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Label for option 4"), { target: { value: "B" } });
    expect((screen.getByLabelText("Correct answer") as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);

    await user.selectOptions(screen.getByLabelText("Correct answer"), "D");
    await user.click(screen.getByRole("button", { name: "Mark source review complete" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    expect(mocked.addQuestion).toHaveBeenCalledWith(expect.objectContaining({
      correctKey: "D",
      correctAnswerText: "Beta",
    }));
  });

  it("clears a selected answer when its option is removed and restores keyboard focus", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [{
        ...draft,
        options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }],
      }],
      rawText: "Question source", title: "Delete selected", fileName: "delete.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: /Which option is correct/ }));
    await user.click(screen.getByRole("button", { name: "Remove option B" }));
    expect((screen.getByLabelText("Correct answer") as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Option C")));
  });

  it("preserves the intended answer and text when answer choices are reordered", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [{
        ...draft,
        options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }],
      }],
      rawText: "Question source", title: "Reordered choices", fileName: "reorder.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: /Which option is correct/ }));
    await user.click(screen.getByRole("button", { name: "Move option B up" }));
    expect((screen.getByLabelText("Correct answer") as HTMLSelectElement).value).toBe("B");
    expect(screen.getByLabelText("Option B")).toHaveProperty("value", "Beta");
    await user.click(screen.getByRole("button", { name: "Mark source review complete" }));
    await user.click(screen.getByRole("button", { name: "Finalize import" }));

    expect(mocked.addQuestion).toHaveBeenCalledWith(expect.objectContaining({
      options: [{ key: "B", text: "Beta" }, { key: "A", text: "Alpha" }, { key: "C", text: "Gamma" }],
      correctKey: "B",
      correctAnswerText: "Beta",
    }));
  });

  it("lets exclusion remove a duplicate-number constraint from the finalized subset", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={{
      drafts: [
        { ...draft, questionNumber: 1, parserRuleIds: ["conflict.duplicate-question-number"] },
        { ...draft, questionNumber: 1, stem: "Excluded duplicate", parserRuleIds: ["conflict.duplicate-question-number"] },
      ],
      rawText: "Duplicate source", title: "Included subset", fileName: "subset.txt", fileType: "text",
    }} />);

    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", true);
    await user.click(screen.getAllByRole("checkbox", { name: "Include question 1" })[1]);
    expect(screen.getByRole("button", { name: "Finalize import" })).toHaveProperty("disabled", false);
    const includedCard = screen.getAllByRole("checkbox", { name: "Include question 1" })[0].closest("section");
    const excludedCard = screen.getAllByRole("checkbox", { name: "Include question 1" })[1].closest("section");
    expect(includedCard && within(includedCard).getByText("High")).toBeTruthy();
    expect(includedCard && within(includedCard).queryByText("Invalid")).toBeNull();
    expect(excludedCard && within(excludedCard).getByText("Invalid")).toBeTruthy();
    expect(screen.getByText("High 1")).toBeTruthy();
    expect(screen.getByText("Invalid 1")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    expect(mocked.addQuestion).toHaveBeenCalledTimes(1);
    expect(mocked.addQuestion).toHaveBeenCalledWith(expect.objectContaining({ stem: "Which option is correct?" }));
  });

  it("continues rollback after a cleanup failure and warns against an unsafe retry", async () => {
    const user = userEvent.setup();
    mocked.addDocument.mockRejectedValueOnce(new Error("Document write failed"));
    mocked.removeQuestionSet.mockRejectedValueOnce(new Error("Set cleanup failed"));
    render(<ImportPanel seed={{
      drafts: [draft], rawText: "Question source", title: "Rollback warning",
      fileName: "rollback-warning.txt", fileType: "text",
    }} />);

    await user.click(screen.getByRole("button", { name: "Finalize import" }));
    expect(mocked.removeQuestion).toHaveBeenCalledWith("question-1");
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Finalization failed — cleanup incomplete",
      body: expect.stringMatching(/Review the Question Bank and Source Library before retrying/),
      tone: "warn",
    }));
    expect(screen.getByText(/Review 1 parsed question/)).toBeTruthy();
  });
});
