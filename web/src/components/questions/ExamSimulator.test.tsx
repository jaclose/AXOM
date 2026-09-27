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
