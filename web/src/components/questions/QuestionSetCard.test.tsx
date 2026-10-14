// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionSet, QuestionSetMetrics } from "../../lib/library";
import { QuestionSetCard } from "./QuestionSetCard";

const set: QuestionSet = {
  id: "set", title: "Week 4–5 Postmidterm Immunology", sourceDocumentIds: ["doc"],
  createdAt: "2026-07-01T00:00:00.000Z", questionIds: Array.from({ length: 20 }, (_, index) => String(index)),
  tags: [], aiEnhanced: false, parserWarnings: [],
};
const metrics: QuestionSetMetrics = {
  total: 20, completed: 12, remaining: 8, completionPct: 60,
  currentMasteryCorrect: 10, currentMasteryQuestions: 12, currentMasteryPct: 83, currentMasteryTone: "gold",
  historicalCorrectAttempts: 13, historicalAttemptCount: 18, historicalAccuracyPct: 72,
  needsReview: 3, importConfidence: 91, lastStudiedAt: "2026-07-09T00:00:00.000Z",
  category: "Immunology", sourceTitle: "IMMU Practice set 3", missedQuestionIds: ["2", "4"],
  mapping: {
    ready: 17, reviewSuggested: 1, unresolved: 2, issueCount: 3,
    issueQuestionIds: ["1", "2", "3"], reviewSuggestedQuestionIds: ["1"], unresolvedQuestionIds: ["2", "3"],
  },
};

afterEach(cleanup);

describe("QuestionSetCard", () => {
  it("distinguishes mastery from attempt accuracy and prioritizes mapping review", async () => {
    const onReviewIssues = vi.fn();
    const user = userEvent.setup();
    render(<QuestionSetCard set={set} metrics={metrics} onStart={() => {}} onReviewIssues={onReviewIssues} onReviewMisses={() => {}} />);
    expect(screen.getByText(set.title)).toBeTruthy();
    expect(screen.getByLabelText("83% current mastery").classList.contains("gold")).toBe(true);
    expect(screen.getByText("Current mastery")).toBeTruthy();
    expect(screen.getByText("Attempt accuracy 72% · 18 total attempts")).toBeTruthy();
    expect(screen.getByText("12/20")).toBeTruthy();
    expect(screen.getByText("3 mapping issues")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "12 of 20 questions attempted" }).getAttribute("aria-valuenow")).toBe("60");
    expect(screen.getByText("91%")).toBeTruthy();
    expect(screen.getByRole("button", { name: /review misses/i })).not.toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: /review issues/i }));
    expect(onReviewIssues).toHaveBeenCalledOnce();
  });

  it("uses a neutral no-attempt state and starts a clean set", () => {
    render(<QuestionSetCard set={set} metrics={{
      ...metrics,
      completed: 0,
      remaining: 20,
      completionPct: 0,
      currentMasteryCorrect: 0,
      currentMasteryQuestions: 0,
      currentMasteryPct: null,
      currentMasteryTone: "neutral",
      historicalCorrectAttempts: 0,
      historicalAttemptCount: 0,
      historicalAccuracyPct: null,
      missedQuestionIds: [],
      needsReview: 0,
      mapping: {
        ready: 20, reviewSuggested: 0, unresolved: 0, issueCount: 0,
        issueQuestionIds: [], reviewSuggestedQuestionIds: [], unresolvedQuestionIds: [],
      },
    }} onStart={() => {}} onReviewMisses={() => {}} />);
    expect(screen.getByLabelText("No current mastery attempts yet").classList.contains("neutral")).toBe(true);
    expect(screen.getByText("Attempt accuracy — · 0 total attempts")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Start$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /review misses/i })).toHaveProperty("disabled", true);
  });

  it("does not launch a missing or malformed set with zero actually runnable questions", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<QuestionSetCard set={set} metrics={{
      ...metrics,
      needsReview: 0,
      mapping: {
        ready: 0, reviewSuggested: 0, unresolved: 0, issueCount: 0,
        issueQuestionIds: [], reviewSuggestedQuestionIds: [], unresolvedQuestionIds: [],
      },
    }} onStart={onStart} compact />);
    const unavailable = screen.getByRole("button", { name: "Unavailable" });
    expect(unavailable).toHaveProperty("disabled", true);
    expect(screen.getByRole("status").textContent).toMatch(/restore missing source records/i);
    await user.click(unavailable);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("offers Continue when some questions have attempts and no mapping issues", () => {
    render(<QuestionSetCard set={set} metrics={{
      ...metrics,
      needsReview: 0,
      mapping: {
        ready: 20, reviewSuggested: 0, unresolved: 0, issueCount: 0,
        issueQuestionIds: [], reviewSuggestedQuestionIds: [], unresolvedQuestionIds: [],
      },
    }} onStart={() => {}} compact />);
    expect(screen.getByRole("button", { name: /^Continue$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /insights|edit|review misses/i })).toBeNull();
  });
});
