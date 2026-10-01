// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { ExamSimulator } from "./ExamSimulator";

function q(id: string, correctKey = "B"): QuestionRecord {
  return {
    id, source: "manual", stem: `Stem for ${id}: which is right?`,
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }],
    correctKey, correctAnswerText: "Beta", explanation: `Because ${id}.`, status: "unseen", tags: [], attempts: [],
    createdAt: "2026-07-10T00:00:00.000Z", updatedAt: "2026-07-10T00:00:00.000Z",
  };
}
const pool = [q("q1"), q("q2"), q("q3")];

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ ...makeSeed(), questions: pool });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ExamSimulator", () => {
  it("runs an NBME-style block through Item Review to the end", () => {
    const onFinish = vi.fn();
    render(<ExamSimulator skin="nbme" mode="exam" pool={pool} timeLimitSeconds={270} onFinish={onFinish} onSuspend={vi.fn()} />);
    expect(screen.getByText("Item 1 of 3", { selector: "b" })).toBeTruthy();
    expect(document.body.classList.contains("exam-sim-active")).toBe(true);
    fireEvent.keyDown(window, { key: "b" });
    expect((screen.getByRole("radio", { name: "B. Beta" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Item 2 of 3", { selector: "b" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark item for review" }));
    fireEvent.contextMenu(screen.getByText("Gamma").closest(".sim-choice")!);
    expect(screen.getByText("Gamma").closest(".sim-choice")!.className).toContain("struck");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("radio", { name: "A. Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const review = screen.getByRole("dialog", { name: "Item Review" });
    expect(within(review).getByText(/1 incomplete · 1 marked/)).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: "Review Incomplete" }));
    expect(within(review).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(within(review).getByRole("button", { name: "End Block" }));
    expect(onFinish).toHaveBeenCalledOnce();
    const [answers] = onFinish.mock.calls[0];
    expect(answers.map((answer: { answerKey?: string; correct?: boolean; flagged: boolean }) => [answer.answerKey, answer.correct, answer.flagged]))
      .toEqual([["B", true, false], [undefined, false, true], ["A", false, false]]);
  });

  it("reveals the explanation per item in UWorld tutor mode", () => {
    render(<ExamSimulator skin="uworld" mode="tutor" pool={pool} onFinish={vi.fn()} onSuspend={vi.fn()} />);
    expect(screen.getByText(/Block Time Elapsed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "C. Gamma" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    const explanation = screen.getByRole("region", { name: "Explanation" });
    expect(within(explanation).getByText("Incorrect")).toBeTruthy();
    expect(within(explanation).getByText("Correct answer: B")).toBeTruthy();
    expect(within(explanation).getByText("Because q1.")).toBeTruthy();
  });

  it("shows the time taken to answer the moment the answer is revealed, and stops the item's clock there", () => {
    vi.useFakeTimers();
    const onFinish = vi.fn();
    render(<ExamSimulator skin="uworld" mode="tutor" pool={pool} onFinish={onFinish} onSuspend={vi.fn()} />);
    act(() => { vi.advanceTimersByTime(47_000); });
    fireEvent.click(screen.getByRole("radio", { name: "B. Beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(within(screen.getByRole("region", { name: "Explanation" })).getByText("Time spent: 00:47")).toBeTruthy();

    // Reading the explanation for a minute is not time spent answering.
    act(() => { vi.advanceTimersByTime(60_000); });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(within(screen.getByRole("region", { name: "Explanation" })).getByText("Time spent: 00:47")).toBeTruthy();
  });

  it("marks a wrong tutor answer with a cross and a right one with a tick in the UWorld item list, and nothing before submitting", () => {
    render(<ExamSimulator skin="uworld" mode="tutor" pool={pool} onFinish={vi.fn()} onSuspend={vi.fn()} />);
    const list = screen.getByRole("navigation", { name: "Items" });
    fireEvent.click(screen.getByRole("radio", { name: "C. Gamma" }));
    // Picked but not yet submitted: answered, with no verdict.
    const answered = within(list).getByRole("button", { name: "Item 1, answered" });
    expect(answered.querySelector(".sim-dot.filled")).toBeTruthy();
    expect(answered.querySelector(".sim-result")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(within(list).getByRole("button", { name: "Item 1, incorrect" }).querySelector(".sim-result.bad.lucide-x")).toBeTruthy();
    // On the choices: a cross on the wrong pick, a tick on the right answer, never a tick on the pick.
    expect(screen.getByText("Gamma").closest(".sim-choice")!.querySelector(".sim-choice-mark.bad.lucide-x")).toBeTruthy();
    expect(screen.getByText("Gamma").closest(".sim-choice")!.querySelector(".lucide-check")).toBeNull();
    expect(screen.getByText("Beta").closest(".sim-choice")!.querySelector(".sim-choice-mark.ok.lucide-check")).toBeTruthy();

    fireEvent.click(within(list).getByRole("button", { name: "Item 2, unanswered" }));
    fireEvent.click(screen.getByRole("radio", { name: "B. Beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    const right = within(list).getByRole("button", { name: "Item 2, correct" });
    expect(right.querySelector(".sim-result.ok.lucide-check")).toBeTruthy();
    expect(right.querySelector(".lucide-x")).toBeNull();
  });

  it("shows no verdict anywhere while an exam block is being sat", () => {
    for (const skin of ["uworld", "nbme", "examsoft"] as const) {
      const { unmount } = render(<ExamSimulator skin={skin} mode="exam" pool={pool} onFinish={vi.fn()} onSuspend={vi.fn()} />);
      // The exam renders at the document root (full screen), not inside the test container.
      const container = screen.getByRole("dialog");
      fireEvent.click(screen.getByRole("radio", { name: "C. Gamma" }));
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.click(screen.getByRole("radio", { name: "B. Beta" }));
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      expect(container.querySelector(".sim-result, .sim-choice-mark, .correct, .wrong, .right, .xfy-num-result, .xfy-choice-side.ok, .xfy-choice-side.bad"), skin).toBeNull();
      expect(screen.queryByRole("region", { name: "Explanation" }), skin).toBeNull();
      expect(container.textContent, skin).not.toMatch(/Correct answer|Incorrect/i);
      unmount();
    }
  });

  it("reads a finished block back in the same interface, with every result shown and nothing changeable", () => {
    const answers = [
      { questionId: "q1", answerKey: "B", correct: true, flagged: false, seconds: 30 },
      { questionId: "q2", answerKey: "A", correct: false, flagged: true, seconds: 12 },
      { questionId: "q3", flagged: false, seconds: 0 },
    ];
    const onClose = vi.fn();
    const onFinish = vi.fn();
    render(<ExamSimulator skin="nbme" mode="exam" pool={pool} review={{ answers, startedAt: "2026-10-01T10:00:00.000Z", elapsedSeconds: 95 }} onFinish={onFinish} onSuspend={vi.fn()} onClose={onClose} />);
    expect(screen.getByText(/Review · block time 00:01:35/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Explanation" })).getByText("Correct")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Explanation" })).getByText("Time spent: 00:30")).toBeTruthy();
    // Nothing can be changed.
    expect((screen.getByRole("radio", { name: "A. Alpha" }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: "a" });
    expect((screen.getByRole("radio", { name: "B. Beta" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("button", { name: "Mark item for review" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Navigator" }));
    const navigator = screen.getByRole("dialog", { name: "Navigator" });
    expect(within(navigator).getByRole("listitem", { name: "Item 1: correct" })).toBeTruthy();
    expect(within(navigator).getByRole("listitem", { name: "Item 2: incorrect, marked" })).toBeTruthy();
    expect(within(navigator).getByRole("listitem", { name: "Item 3: incomplete" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Close review/ }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("suspends with answers, marks, notes and a paused clock", () => {
    const onSuspend = vi.fn();
    render(<ExamSimulator skin="uworld" mode="exam" pool={pool} timeLimitSeconds={270} onFinish={vi.fn()} onSuspend={onSuspend} />);
    fireEvent.click(screen.getByRole("radio", { name: "A. Alpha" }));
    fireEvent.keyDown(window, { key: "m" });
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Block notes" }), { target: { value: "Check renal later" } });
    fireEvent.click(screen.getByRole("button", { name: /Suspend/ }));
    const block = onSuspend.mock.calls[0][0];
    expect(block).toMatchObject({ skin: "uworld", mode: "exam", index: 0, notes: "Check renal later", timeLimitSeconds: 270 });
    expect(block.items.q1).toMatchObject({ answerKey: "A", marked: true, visited: true });
  });

  it("ends the block when time runs out and warns at five minutes", () => {
    vi.useFakeTimers();
    const onFinish = vi.fn();
    render(<ExamSimulator skin="examsoft" mode="exam" pool={pool} timeLimitSeconds={900} onFinish={onFinish} onSuspend={vi.fn()} />);
    act(() => { vi.advanceTimersByTime(601_000); });
    expect(screen.getByRole("alert").textContent).toContain("5 minutes remaining");
    act(() => { vi.advanceTimersByTime(300_000); });
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("searches the lab values panel", () => {
    render(<ExamSimulator skin="nbme" mode="exam" pool={pool} onFinish={vi.fn()} onSuspend={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Lab Values" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search lab values" }), { target: { value: "tsh" } });
    expect(screen.getByText("0.4–4.0 μU/mL")).toBeTruthy();
  });
});
