// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { readSuspendedBlock } from "../../lib/examSim";
import { ExamRunner } from "./ExamRunner";

vi.mock("../../lib/ai", () => ({ resolveActiveProvider: () => null, explainSimply: vi.fn(), explainWhyWrong: vi.fn(), memoryHook: vi.fn() }));

function q(id: string): QuestionRecord {
  return {
    id, source: "manual", stem: `Stem ${id}`, options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    correctKey: "B", correctAnswerText: "Beta", status: "unseen", tags: [], attempts: [],
    createdAt: "2026-07-10T00:00:00.000Z", updatedAt: "2026-07-10T00:00:00.000Z",
  };
}

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ ...makeSeed(), questions: [q("q1"), q("q2")], quizSessions: [] });
});
afterEach(cleanup);

describe("ExamRunner simulation", () => {
  it("runs a UWorld-style block and records the session", () => {
    const onClose = vi.fn();
    render(<ExamRunner mode="exam" onClose={onClose} />);
    fireEvent.click(screen.getByRole("radio", { name: /UWorld-style/ }));
    fireEvent.click(screen.getByRole("button", { name: /USMLE block · 20/ }));
    expect(screen.getByText(/30 min block/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Start exam block/ }));
    const sim = screen.getByRole("dialog", { name: "UWorld-style exam simulation" });
    expect(within(sim).getByText(/Block Time Remaining/).textContent).toMatch(/Block Time Remaining: 00:0[23]:/);
    fireEvent.click(within(sim).getAllByRole("radio", { name: "B. Beta" })[0]);
    fireEvent.click(within(sim).getByRole("button", { name: /End Block/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "End Block" }));
    expect(screen.getByText("Block results")).toBeTruthy();
    const session = useStore.getState().quizSessions[0];
    expect(session).toMatchObject({ mode: "exam", timed: true, timeLimitSeconds: 180, simulation: { skin: "uworld", preset: "usmle-2026" } });
    expect(session.answers.filter((answer) => answer.correct)).toHaveLength(1);
    expect(useStore.getState().questions.find((item) => item.id === session.answers.find((answer) => answer.answerKey)!.questionId)!.attempts).toHaveLength(1);
  });

  it("suspends and resumes a block from setup", () => {
    const onClose = vi.fn();
    const { unmount } = render(<ExamRunner mode="exam" onClose={onClose} />);
    fireEvent.click(screen.getByRole("radio", { name: /USMLE \/ NBME/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start exam block/ }));
    fireEvent.click(screen.getAllByRole("radio", { name: "A. Alpha" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Suspend/ }));
    expect(onClose).toHaveBeenCalled();
    expect(readSuspendedBlock()).toMatchObject({ skin: "nbme" });
    unmount();
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    expect(screen.getByText(/Suspended block · USMLE \/ NBME/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
    expect((screen.getAllByRole("radio", { name: "A. Alpha" })[0] as HTMLInputElement).checked).toBe(true);
  });
});
