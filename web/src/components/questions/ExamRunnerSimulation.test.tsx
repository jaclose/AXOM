// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { readSuspendedBlock, writeSuspendedBlock } from "../../lib/examSim";
import * as localVault from "../../lib/localVault";
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
  it("does not offer an ID claimed by both ready and review-required records", async () => {
    await act(async () => {
      await useStore.setState({
        questions: [q("duplicate"), { ...q("duplicate"), needsReview: true }, q("unique")],
      });
    });

    render(<ExamRunner mode="exam" onClose={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Practice source" }).textContent)
      .toContain("1 matches your filters");
  });

  it("runs a UWorld-style block and records the session", async () => {
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
    await waitFor(() => expect(screen.getByText("Block results")).toBeTruthy());
    const session = useStore.getState().quizSessions[0];
    expect(session).toMatchObject({ mode: "exam", timed: true, timeLimitSeconds: 180, simulation: { skin: "uworld", preset: "usmle-2026" } });
    expect(session.answers.filter((answer) => answer.correct)).toHaveLength(1);
    expect(session.answers.filter((answer) => !answer.answerKey)).toEqual([
      expect.objectContaining({ correct: false }),
    ]);
    expect(session.score).toEqual({ correct: 1, scored: 2, total: 2, pct: 50 });
    expect(useStore.getState().questions.find((item) => item.id === session.answers.find((answer) => answer.answerKey)!.questionId)!.attempts).toHaveLength(1);
  });

  it("suspends and resumes a block from setup", () => {
    const onClose = vi.fn();
    const { unmount } = render(<ExamRunner mode="exam" onClose={onClose} />);
    fireEvent.click(screen.getByRole("radio", { name: /USMLE \/ NBME/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start exam block/ }));
    fireEvent.click(screen.getAllByRole("radio", { name: "A. Alpha" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    expect(onClose).toHaveBeenCalled();
    expect(readSuspendedBlock()).toMatchObject({ skin: "nbme" });
    unmount();
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    expect(screen.getByText(/Suspended block · USMLE \/ NBME/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
    expect((screen.getAllByRole("radio", { name: "A. Alpha" })[0] as HTMLInputElement).checked).toBe(true);
  });

  it("retains final recovery and retries one stable run without duplicate attempts", async () => {
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites")
      .mockRejectedValueOnce(new Error("Synthetic vault refusal"))
      .mockResolvedValueOnce(undefined);
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /UWorld-style/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start exam block/ }));
    fireEvent.click(screen.getAllByRole("radio", { name: "B. Beta" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /End Block/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "End Block" }));

    const warning = await screen.findByRole("alert");
    expect(warning.textContent).toMatch(/recovery is still on this device/i);
    const recovery = readSuspendedBlock();
    expect(recovery?.runId).toEqual(expect.any(String));
    expect(useStore.getState().quizSessions).toHaveLength(1);
    expect(useStore.getState().questions.flatMap((item) => item.attempts)).toHaveLength(1);

    fireEvent.click(within(warning).getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(screen.getByText("Block results")).toBeTruthy());
    expect(useStore.getState().quizSessions).toHaveLength(1);
    expect(useStore.getState().quizSessions[0].id).toBe(recovery?.runId);
    expect(useStore.getState().questions.flatMap((item) => item.attempts)).toHaveLength(1);
    expect(readSuspendedBlock()).toBeUndefined();
    flush.mockRestore();
  });
});

describe("Suspended exam source recovery", () => {
  it("does not resume when any requested ID has multiple claimants", () => {
    const now = new Date().toISOString();
    writeSuspendedBlock({
      version: 1, runId: "duplicate-resume", skin: "nbme", mode: "exam", poolIds: ["q1"], index: 0,
      items: {}, elapsedMs: 0, notes: "", startedAt: now, suspendedAt: now,
    });
    useStore.setState({ questions: [q("q1"), { ...q("q1"), needsReview: true }] });
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByText(/Suspended block · USMLE \/ NBME/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /simulation/ })).toBeNull();
    expect(readSuspendedBlock()?.runId).toBe("duplicate-resume");
  });

  it("keeps a suspended block intact until all trusted question records are available", async () => {
    const now = new Date().toISOString();
    writeSuspendedBlock({
      version: 1, skin: "nbme", mode: "exam", poolIds: ["q1", "q2"], index: 1,
      items: {
        q1: { answerKey: "B", marked: true, struck: [], seconds: 23, visited: true },
        q2: { answerKey: "A", marked: false, struck: [], seconds: 12, visited: true },
      },
      elapsedMs: 45_000, timeLimitSeconds: 180, notes: "Preserve my notes",
      startedAt: now, suspendedAt: now,
    });
    useStore.setState({ questions: [q("q1")] });
    const onClose = vi.fn();
    render(<ExamRunner mode="exam" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByText(/Suspended block · USMLE \/ NBME/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /NBME .* simulation/ })).toBeNull();
    expect(readSuspendedBlock()?.poolIds).toEqual(["q1", "q2"]);
    expect(readSuspendedBlock()?.items.q1).toMatchObject({ answerKey: "B", marked: true });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { await useStore.setState({ questions: [q("q1"), q("q2")] }); });
    await waitFor(() => expect(screen.getByRole("region", { name: "Practice source" }).textContent).toContain("2 match your filters"));
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByRole("dialog", { name: /USMLE \/ NBME.*simulation/ })).toBeTruthy();
  });
});

describe("Simulation uses current source evidence at submission", () => {
  it("does not score stale correct answers after the source key changes mid-exam", async () => {
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /UWorld-style/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start exam block/ }));
    const sim = screen.getByRole("dialog", { name: "UWorld-style exam simulation" });
    fireEvent.click(within(sim).getAllByRole("radio", { name: "B. Beta" })[0]);

    await act(async () => {
      await useStore.setState({
        questions: [q("q1"), q("q2")].map((item) => ({ ...item, correctKey: "A", correctAnswerText: "Alpha" })),
      });
    });
    fireEvent.click(within(sim).getByRole("button", { name: /End Block/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "End Block" }));

    const session = useStore.getState().quizSessions[0];
    expect(session?.score).toMatchObject({ correct: 0, scored: 0, total: 2 });
    expect(session.answers.some((answer) => answer.answerKey)).toBe(true);
    expect(session.answers.filter((answer) => answer.answerKey).every((answer) => answer.correct === undefined)).toBe(true);
    await waitFor(() => expect(screen.getByText(/answer mapping unavailable or changed during the block/)).toBeTruthy());
  });
});

describe("Six-choice simulation keyboard", () => {
  it("keeps an F answer selectable in ExamSoft and reserves M for marking", async () => {
    const six: QuestionRecord = {
      ...q("six-choice"),
      stem: "Choose the sixth option",
      correctKey: "F", correctAnswerText: "Foxtrot",
      options: ["A", "B", "C", "D", "E", "F"].map((key) => ({ key, text: key === "F" ? "Foxtrot" : `Choice ${key}` })),
    };
    await act(async () => { await useStore.setState({ questions: [six] }); });
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /ExamSoft/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start exam block/ }));
    const sim = screen.getByRole("dialog", { name: /ExamSoft.*simulation/ });
    fireEvent.keyDown(window, { key: "f", code: "KeyF" });
    expect(within(sim).getByRole("radio", { name: "F. Foxtrot" }).getAttribute("aria-checked")).toBe("true");
    const mark = within(sim).getByRole("button", { name: "Flag question" });
    expect(mark.getAttribute("aria-pressed")).toBe("false");
    fireEvent.keyDown(window, { key: "m", code: "KeyM" });
    expect(mark.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "F", code: "KeyF", shiftKey: true });
    expect(within(sim).getByRole("radio", { name: "F. Foxtrot (struck out)" }).getAttribute("aria-checked")).toBe("false");
  });
});
