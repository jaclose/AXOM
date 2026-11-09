// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import { BankBrowser } from "./BankBrowser";

const mocked = vi.hoisted(() => ({
  questions: [] as QuestionRecord[],
  bulkUpdateQuestions: vi.fn(),
}));

vi.mock("../../lib/store", () => ({
  useStore: () => ({
    questions: mocked.questions,
    bulkUpdateQuestions: mocked.bulkUpdateQuestions,
  }),
}));
vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));

function makeQuestion(patch: Partial<QuestionRecord>): QuestionRecord {
  return {
    id: "question",
    source: "imported",
    stem: "Question stem",
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    correctKey: "A",
    status: "unseen",
    tags: [],
    attempts: [],
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    ...patch,
  };
}

afterEach(() => {
  cleanup();
  mocked.questions = [];
  vi.clearAllMocks();
});

describe("BankBrowser mapping review", () => {
  it("keeps unfinished modes out of the bank and opens an old mode link as All", () => {
    mocked.questions = [makeQuestion({ stem: "Available question" })];
    render(<BankBrowser initialMode="exam-simulation" onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Timed Block|Faculty Style|Exam Simulation/ })).toBeNull();
    expect(screen.getByRole("button", { name: "All (1)" }).className).toContain("on");
    expect(screen.getByRole("button", { name: "Available question" })).toBeTruthy();
  });

  it("opens scoped to canonical unresolved and review-suggested mappings", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    mocked.questions = [
      makeQuestion({ id: "unresolved", stem: "Unresolved stem", correctKey: undefined, needsReview: true }),
      makeQuestion({ id: "suggested", stem: "Suggested stem", extraction: { confidence: "medium", reviewed: false } }),
      makeQuestion({ id: "ready", stem: "Ready stem", extraction: { confidence: "high", reviewed: true } }),
      makeQuestion({ id: "outside", stem: "Outside scope" }),
    ];

    render(
      <BankBrowser
        initialMode="mapping-review"
        questionIds={["unresolved", "suggested", "ready"]}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByRole("button", { name: /Mapping Review \(2\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unresolved stem" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Suggested stem" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ready stem" })).toBeNull();
    expect(screen.queryByText("Outside scope")).toBeNull();
    expect(screen.getByText("Unresolved")).toBeTruthy();
    expect(screen.getByText("Review suggested")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Suggested stem" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "suggested" }));
  });
});
