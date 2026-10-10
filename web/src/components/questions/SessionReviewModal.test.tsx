// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import type { QuizSession } from "../../lib/quiz";
import { SessionReviewModal } from "./SessionReviewModal";

const state = vi.hoisted(() => ({ questions: [] as QuestionRecord[], documents: [], updateQuestion: vi.fn(), recordQuestionAttempt: vi.fn() }));
vi.mock("../../lib/store", () => ({ useStore: () => state }));
vi.mock("../../lib/ai", () => ({ resolveActiveProvider: () => null }));
const question: QuestionRecord = {
  id: "q1", source: "manual", stem: "Which signal is active?", options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  correctKey: "B", explanation: "Beta is the active signal in the supplied circuit.", tags: [], status: "incorrect", attempts: [],
  createdAt: "2026-10-10T12:00:00Z", updatedAt: "2026-10-10T12:00:00Z",
};
const session: QuizSession = {
  id: "run1", mode: "exam", timed: false, startedAt: "2026-10-10T12:00:00Z", endedAt: "2026-10-10T12:01:00Z",
  filters: { count: 2, status: "all" }, questionIds: ["q1", "gone"],
  answers: [{ questionId: "q1", answerKey: "A", correct: false, flagged: false }, { questionId: "gone", answerKey: "B", correct: true, flagged: true }],
};
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("saved block review", () => {
  it("reads the saved answer, filters and navigates without resubmitting or rescoring", async () => {
    state.questions = [question];
    const original = JSON.stringify(session);
    const user = userEvent.setup();
    render(<SessionReviewModal session={session} onClose={() => {}} onPractice={() => {}} />);
    expect(screen.getByText("Your answer: A")).toBeTruthy();
    expect(screen.getByText(question.explanation!)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("status").textContent).toContain("no longer in your library");
    await user.click(screen.getByRole("button", { name: "Missed" }));
    expect(screen.getByText(question.stem)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(true);
    expect(JSON.stringify(session)).toBe(original);
    expect(state.recordQuestionAttempt).not.toHaveBeenCalled();
    expect(state.updateQuestion).not.toHaveBeenCalled();
  });

  it("gates active exams, preserves historical results when a key is uncertain, and excludes them from practice", () => {
    state.questions = [{ ...question, needsReview: true }];
    const view = render(<SessionReviewModal session={{ ...session, endedAt: undefined }} onClose={() => {}} onPractice={() => {}} />);
    expect(screen.queryByText(question.explanation!)).toBeNull();
    view.rerender(<SessionReviewModal session={session} onClose={() => {}} onPractice={() => {}} />);
    expect(screen.getByText("Missed when submitted")).toBeTruthy();
    expect(screen.getByText(/current answer key needs review/)).toBeTruthy();
    expect(screen.queryByText("Current key")).toBeNull();
    expect(screen.queryByRole("button", { name: /Practice/ })).toBeNull();
  });

  it("starts a new practice only on request using ready canonical question IDs", async () => {
    state.questions = [question];
    const onPractice = vi.fn();
    render(<SessionReviewModal session={session} onClose={() => {}} onPractice={onPractice} />);
    expect(onPractice).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Practice 1 missed" }));
    expect(onPractice).toHaveBeenCalledWith(["q1"]);
  });
});
