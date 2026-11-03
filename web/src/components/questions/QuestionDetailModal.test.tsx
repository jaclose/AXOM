// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import { QuestionDetailModal } from "./QuestionDetailModal";

const mocked = vi.hoisted(() => ({
  addAnkiCards: vi.fn(() => ({ saved: 1, errors: [] })),
  updateQuestion: vi.fn(),
  documents: [{
    id: "source-doc",
    title: "Verified source",
    fileName: "source.pdf",
    fileType: "pdf",
    uploadedAt: "2026-07-10T00:00:00.000Z",
    rawText: "Which option is correct?\nA. Alpha\nB. Beta\n\nAnswer evidence section\nCorrect answer: B. Beta",
    pageTexts: ["Which option is correct?\nA. Alpha\nB. Beta\n\nAnswer evidence section\nCorrect answer: B. Beta"],
    sizeBytes: 100,
    tags: [],
    linkedQuestionSetIds: [],
    libraryOnly: false,
  }],
}));

vi.mock("../../lib/store", () => ({
  useStore: () => ({
    addAnkiCards: mocked.addAnkiCards,
    recordQuestionAttempt: vi.fn(),
    removeQuestion: vi.fn(),
    toggleQuestionMarked: vi.fn(),
    updateQuestion: mocked.updateQuestion,
    documents: mocked.documents,
  }),
}));
vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));

const edited = "Answer choice B is wrong because receptor affinity alone does not determine signaling.";
const question: QuestionRecord = {
  id: "manual-edit",
  source: "manual",
  stem: "Which option is correct?",
  options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  correctKey: "B",
  correctAnswerText: "Beta",
  explanation: edited,
  status: "unseen",
  tags: [],
  attempts: [],
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QuestionDetailModal repair cards", () => {
  it("reveals a related diagram only after checking a keyed question", async () => {
    const user = userEvent.setup();
    render(<QuestionDetailModal question={{
      ...question,
      stem: "A patient has runny nose and sneezing.",
      options: [{ key: "A", text: "Rhinovirus" }, { key: "B", text: "Influenza virus" }],
      correctKey: "A", correctAnswerText: "Rhinovirus",
    }} onClose={() => {}} />);
    expect(screen.queryByRole("complementary", { name: "Related AXOM diagram" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "BInfluenza virus" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    expect(screen.getByRole("complementary", { name: "Related AXOM diagram" })).toBeTruthy();
  });
  it("preserves a manually edited answer-line-shaped explanation verbatim", async () => {
    const user = userEvent.setup();
    render(<QuestionDetailModal question={question} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "AAlpha" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.click(screen.getByRole("button", { name: /Create an error-repair card/i }));

    expect(mocked.addAnkiCards).toHaveBeenCalledWith([
      expect.objectContaining({ back: `Correct: B. Beta\n\n${edited}` }),
    ]);
  });

  it("repairs mapping metadata without rewriting attempts or practice status", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const unresolved: QuestionRecord = {
      ...question,
      id: "unresolved",
      correctKey: undefined,
      correctAnswerText: undefined,
      needsReview: true,
      status: "incorrect",
      attempts: [{ at: "2026-07-10T00:00:00.000Z", answerKey: "A", status: "incorrect" }],
      extraction: {
        confidence: "low",
        reviewed: false,
        answerDetectionConfidence: 0.2,
      },
    };

    render(<QuestionDetailModal question={unresolved} onClose={onClose} />);
    expect(screen.getByText("Unresolved")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Review answer mapping/i }));
    await user.selectOptions(screen.getByLabelText("Correct answer mapping"), "B");
    await user.click(screen.getByRole("button", { name: "Confirm mapping" }));

    expect(mocked.updateQuestion).toHaveBeenCalledWith("unresolved", {
      correctKey: "B",
      correctAnswerText: "Beta",
      needsReview: false,
      extraction: expect.objectContaining({
        confidence: "low",
        reviewed: true,
        reviewedAt: expect.any(String),
        answerDetectionConfidence: 1,
        parserRuleIds: expect.arrayContaining(["import.user-reviewed"]),
      }),
    });
    const patch = mocked.updateQuestion.mock.calls[0][1];
    expect(patch).not.toHaveProperty("attempts");
    expect(patch).not.toHaveProperty("status");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("updates only a user-selected grounded source excerpt", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<QuestionDetailModal question={{
      ...question,
      source: "pdf",
      sourceDocumentId: "source-doc",
      citation: "source.pdf",
      extraction: {
        confidence: "high",
        reviewed: true,
        questionSourceSnippet: "Wrong excerpt",
      },
    }} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "This source looks wrong" }));
    expect(screen.getByRole("region", { name: "Source review" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Use this excerpt/i }));

    expect(mocked.updateQuestion).toHaveBeenCalledWith("manual-edit", {
      extraction: expect.objectContaining({
        confidence: "high",
        reviewed: true,
        questionSourceSnippet: expect.stringContaining("Which option is correct?"),
        questionSourcePage: 1,
      }),
      sourcePage: 1,
    });
    const patch = mocked.updateQuestion.mock.calls[0][1];
    expect(patch).not.toHaveProperty("attempts");
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("stem");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers and saves a different nearby grounded span for bad answer evidence", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<QuestionDetailModal question={{
      ...question,
      source: "pdf",
      sourceDocumentId: "source-doc",
      sourcePage: 1,
      attempts: [{ at: "2026-07-10T00:00:00.000Z", answerKey: "A", status: "incorrect" }],
      status: "incorrect",
      extraction: {
        confidence: "low",
        reviewed: true,
        answerEvidenceSnippet: "Wrong answer excerpt",
        questionSourcePage: 1,
      },
    }} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "This source looks wrong" }));
    await user.click(screen.getByRole("button", { name: "Answer evidence" }));
    await user.click(screen.getByRole("button", { name: /Use nearby excerpt.*Answer evidence section/i }));

    expect(mocked.updateQuestion).toHaveBeenCalledWith("manual-edit", {
      extraction: expect.objectContaining({
        reviewed: true,
        answerEvidenceSnippet: expect.stringContaining("Answer evidence section"),
        answerEvidencePage: 1,
      }),
    });
    const patch = mocked.updateQuestion.mock.calls[0][1];
    expect(patch).not.toHaveProperty("attempts");
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("stem");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
