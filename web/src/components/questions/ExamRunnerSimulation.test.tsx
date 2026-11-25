// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAttempt, type QuestionRecord } from "../../lib/questions";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { EXAM_SIM_SUSPENDED_KEY, readSuspendedBlock, writeSuspendedBlock } from "../../lib/examSim";
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
  function savedBlock(runId: string): NonNullable<ReturnType<typeof readSuspendedBlock>> {
    const now = new Date().toISOString();
    return {
      version: 1, runId, skin: "nbme", mode: "exam", poolIds: ["q1"], index: 0,
      items: { q1: { answerKey: "A", marked: false, struck: [], seconds: 12, visited: true } },
      elapsedMs: 12_000, notes: "Original notes", startedAt: now, suspendedAt: now,
    };
  }

  it.each([
    ["discard", "scoped", "throw"], ["discard", "legacy", "noop"],
    ["start", "scoped", "noop"], ["start", "legacy", "throw"],
  ] as const)("holds %s on %s removal refusal (%s)", (action, copy, refusal) => {
    const original = savedBlock("refused-run");
    writeSuspendedBlock(original);
    const { unmount } = render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    if (action === "start") fireEvent.click(screen.getByRole("radio", { name: /USMLE \/ NBME/ }));
    const target = copy === "legacy" ? EXAM_SIM_SUSPENDED_KEY : `${EXAM_SIM_SUSPENDED_KEY}:run:refused-run`;
    const remove = Storage.prototype.removeItem;
    const refusalSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (this === localStorage && key === target) {
        if (refusal === "throw") throw new Error("Synthetic removal refusal");
        return;
      }
      remove.call(this, key);
    });
    const consent = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      fireEvent.click(screen.getByRole("button", { name: action === "start" ? /Start exam block/ : "Discard" }));
      expect(consent).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog", { name: /simulation/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    } finally {
      refusalSpy.mockRestore();
      consent.mockRestore();
    }
    expect(readSuspendedBlock()).toEqual(original);
    unmount();
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it.each(["read-refusal", "malformed"] as const)("does not start a new simulation with unverifiable recovery (%s)", (kind) => {
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /USMLE \/ NBME/ }));
    const get = Storage.prototype.getItem;
    const read = kind === "read-refusal" ? vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (this === localStorage && key === EXAM_SIM_SUSPENDED_KEY) throw new Error("Synthetic read refusal");
      return get.call(this, key);
    }) : undefined;
    if (kind === "malformed") localStorage.setItem(EXAM_SIM_SUSPENDED_KEY, "{broken");
    try {
      fireEvent.click(screen.getByRole("button", { name: /Start exam block/ }));
      expect(screen.queryByRole("dialog", { name: /simulation/ })).toBeNull();
      expect(screen.getByRole("alert").textContent).toContain("Suspended exam recovery needs attention");
      expect((screen.getByRole("button", { name: /Start exam block/ }) as HTMLButtonElement).disabled).toBe(true);
    } finally {
      read?.mockRestore();
    }
    if (kind === "malformed") {
      expect(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY)).toBe("{broken");
      // External repair in this fixture only.
      localStorage.removeItem(EXAM_SIM_SUSPENDED_KEY);
    }
    fireEvent.click(screen.getByRole("button", { name: "Retry recovery check" }));
    expect(screen.queryByText("Suspended exam recovery needs attention")).toBeNull();
    expect((screen.getByRole("button", { name: /Start exam block/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("dialog", { name: /simulation/ })).toBeNull();
  });

  it("shows unreadable recovery on initial setup and only enables simulation after a verified retry", () => {
    localStorage.setItem(EXAM_SIM_SUSPENDED_KEY, "{broken");
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /USMLE \/ NBME/ }));
    const start = screen.getByRole("button", { name: /Start exam block/ }) as HTMLButtonElement;
    expect(screen.getByRole("alert").textContent).toContain("Suspended exam recovery needs attention");
    expect(start.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry recovery check" }));
    expect(start.disabled).toBe(true);
    expect(localStorage.getItem(EXAM_SIM_SUSPENDED_KEY)).toBe("{broken");

    const restored = savedBlock("repaired-run");
    // Simulate external recovery repair, not a UI discard.
    localStorage.removeItem(EXAM_SIM_SUSPENDED_KEY);
    writeSuspendedBlock(restored);
    fireEvent.click(screen.getByRole("button", { name: "Retry recovery check" }));
    expect(screen.queryByText("Suspended exam recovery needs attention")).toBeNull();
    expect(start.disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /simulation/ })).toBeNull();
    expect(readSuspendedBlock()).toEqual(restored);
  });

  it("retains orphan recovery bytes and permits unrelated native practice", () => {
    const orphan = savedBlock("orphan-retry");
    const key = `${EXAM_SIM_SUSPENDED_KEY}:run:orphan-retry`;
    localStorage.setItem(key, JSON.stringify(orphan));
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /USMLE \/ NBME/ }));
    const start = screen.getByRole("button", { name: /Start exam block/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry recovery check" }));
    expect(start.disabled).toBe(true);
    expect(localStorage.getItem(key)).toBe(JSON.stringify(orphan));
    fireEvent.click(screen.getByRole("radio", { name: /AXOM native/ }));
    expect(start.disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    expect(localStorage.getItem(key)).toBe(JSON.stringify(orphan));
  });

  it.each(["same-run", "different-run"] as const)("requires renewed consent to resume a changed snapshot (%s)", (kind) => {
    const original = savedBlock("old-run");
    writeSuspendedBlock(original);
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    const changed = {
      ...original, runId: kind === "same-run" ? original.runId : "new-run", notes: "Newer notes",
      items: { q1: { ...original.items.q1, answerKey: "B", marked: true } },
    };
    writeSuspendedBlock(changed);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.queryByRole("dialog", { name: /simulation/ })).toBeNull();
    expect(readSuspendedBlock()).toEqual(changed);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByRole("dialog", { name: /USMLE \/ NBME.*simulation/ })).toBeTruthy();
    expect((screen.getAllByRole("radio", { name: "B. Beta" })[0] as HTMLInputElement).checked).toBe(true);
  });

  it.each(["same-run", "different-run"] as const)("does not discard unseen recovery (%s)", (kind) => {
    const original = savedBlock("old-run");
    writeSuspendedBlock(original);
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    const changed = { ...original, runId: kind === "same-run" ? original.runId : "new-run", notes: "Newer notes" };
    writeSuspendedBlock(changed);
    const consent = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(consent).not.toHaveBeenCalled();
      expect(readSuspendedBlock()).toEqual(changed);
      expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    } finally {
      consent.mockRestore();
    }
  });

  it("rechecks recovery after discard confirmation", () => {
    const original = savedBlock("old-run");
    writeSuspendedBlock(original);
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    const changed = { ...original, notes: "Changed during confirmation" };
    const consent = vi.spyOn(window, "confirm").mockImplementation(() => {
      writeSuspendedBlock(changed);
      return true;
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(consent).toHaveBeenCalledTimes(1);
      expect(readSuspendedBlock()).toEqual(changed);
      expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    } finally {
      consent.mockRestore();
    }
  });

  it("does not start a new simulation over recovery created after setup opened", () => {
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /USMLE \/ NBME/ }));
    const changed = savedBlock("new-run");
    writeSuspendedBlock(changed);
    const consent = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      fireEvent.click(screen.getByRole("button", { name: /Start exam block/ }));
      expect(consent).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: /simulation/ })).toBeNull();
      expect(readSuspendedBlock()).toEqual(changed);
      expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Start exam block/ }));
      expect(consent).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("dialog", { name: /USMLE \/ NBME.*simulation/ })).toBeTruthy();
      expect(readSuspendedBlock()).toBeUndefined();
    } finally {
      consent.mockRestore();
    }
  });

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


describe("Simulation protects active question identity at final save", () => {
  it.each(["held-first", "held-last", "identical"] as const)(
    "retains recovery and refuses to mutate ambiguous attempts (%s)",
    async (collision) => {
      await act(async () => { useStore.setState({ questions: [q("q1")] }); });
      render(<ExamRunner mode="exam" onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole("radio", { name: /UWorld-style/ }));
      fireEvent.click(screen.getByRole("button", { name: /Start exam block/ }));
      const sim = screen.getByRole("dialog", { name: "UWorld-style exam simulation" });
      fireEvent.click(within(sim).getAllByRole("radio", { name: "B. Beta" })[0]);

      const original = q("q1");
      const held = { ...q("q1"), needsReview: true, correctKey: "A", correctAnswerText: "Alpha" };
      const claimants = collision === "held-first" ? [held, original]
        : collision === "held-last" ? [original, held] : [original, q("q1")];
      await act(async () => { useStore.setState({ questions: claimants }); });
      const before = JSON.stringify(useStore.getState().questions);
      fireEvent.click(within(sim).getByRole("button", { name: /End Block/ }));
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "End Block" }));
      const warning = await screen.findByRole("alert");
      expect(warning.textContent).toContain("Multiple records claim a question ID");
      expect(useStore.getState().quizSessions).toHaveLength(0);
      expect(JSON.stringify(useStore.getState().questions)).toBe(before);
      const recovery = readSuspendedBlock();
      expect(recovery?.runId).toEqual(expect.any(String));
      expect(recovery?.items.q1.answerKey).toBe("B");

      // An unrelated duplicate should not block this exact run after q1 is unique.
      await act(async () => { useStore.setState({ questions: [original, q("other"), q("other")] }); });
      fireEvent.click(within(warning).getByRole("button", { name: "Retry save" }));
      await waitFor(() => expect(screen.getByText("Block results")).toBeTruthy());
      const result = useStore.getState().quizSessions;
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: recovery?.runId, score: { correct: 1, scored: 1, total: 1 } });
      expect(useStore.getState().questions.map((item) => item.attempts.length)).toEqual([1, 0, 0]);
      expect(readSuspendedBlock()).toBeUndefined();
    },
  );
});

describe("Simulation preserves original source evidence across recovery", () => {
  const changes = ["unchanged", "key", "stem", "choices", "source", "legacy", "changed-then-reverted"] as const;
  const cases = (["exam", "tutor"] as const).flatMap((mode) => changes.map((change) => [mode, change] as const));
  it.each(cases)(
    "scores only verified original source after suspend and remount (%s, %s)",
    async (mode, change) => {
      const original = q("q1");
      await act(async () => { useStore.setState({ questions: [original] }); });
      let mounted = render(<ExamRunner mode={mode} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole("radio", { name: /UWorld-style/ }));
      fireEvent.click(screen.getByRole("button", { name: `Start ${mode} block` }));
      fireEvent.click(screen.getAllByRole("radio", { name: "B. Beta" })[0]);
      if (mode === "tutor") fireEvent.click(screen.getByRole("button", { name: /^Submit$/ }));
      fireEvent.click(screen.getByRole("button", { name: "Save & exit" }));
      const recovery = readSuspendedBlock()!;
      expect(recovery.items.q1.answerKey).toBe("B");
      expect(recovery.sourceEvidenceV1?.q1).toMatch(/^[a-f0-9]{64}$/);
      mounted.unmount();

      const changed: QuestionRecord = change === "key" ? { ...original, correctKey: "A", correctAnswerText: "Alpha" }
        : change === "stem" || change === "changed-then-reverted" ? { ...original, stem: "Different stem" }
        : change === "choices" ? { ...original, correctKey: "A", correctAnswerText: "Beta", options: [{ key: "A", text: "Beta" }, { key: "B", text: "Alpha" }] }
        : change === "source" ? { ...original, sourceDocumentId: "replacement-source" }
        : original;
      if (change === "legacy") {
        const legacy = { ...recovery };
        delete legacy.sourceEvidenceV1;
        writeSuspendedBlock(legacy);
      }
      await act(async () => { useStore.setState({ questions: [changed] }); });
      mounted = render(<ExamRunner mode={mode} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
      expect(screen.getByRole("dialog", { name: /UWorld-style.*simulation/ })).toBeTruthy();
      expect(readSuspendedBlock()?.runId).toBe(recovery.runId);
      if (change === "changed-then-reverted") {
        expect(readSuspendedBlock()?.sourceEvidenceV1).toEqual({});
        fireEvent.click(screen.getByRole("button", { name: "Save & exit" }));
        mounted.unmount();
        await act(async () => { useStore.setState({ questions: [original] }); });
        render(<ExamRunner mode={mode} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: "Resume" }));
        expect(readSuspendedBlock()?.sourceEvidenceV1).toEqual({});
      }
      // A valid attempt against the live revision must survive stale recovery.
      const current = useStore.getState().questions[0];
      const prior = applyAttempt(current, {
        answerKey: current.correctKey, status: "correct", mode: "tutor", quizSessionId: "prior-current-version",
      }, new Date("2026-11-23T12:00:00Z"));
      await act(async () => { useStore.setState({ questions: [prior] }); });
      const dialog = screen.getByRole("dialog", { name: /UWorld-style.*simulation/ });
      if (mode === "tutor") {
        const feedback = within(dialog).getByRole("region", { name: "Explanation" });
        expect(feedback.textContent).toContain(change === "unchanged" ? "Correct" : "Answer key not confirmed");
        expect(within(dialog).getByRole("button", { name: change === "unchanged" ? "Item 1, correct" : "Item 1, answered" })).toBeTruthy();
        if (change !== "unchanged") expect(feedback.textContent).not.toContain("Correct answer:");
      }
      fireEvent.click(within(dialog).getByRole("button", { name: /End Block/ }));
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "End Block" }));
      await waitFor(() => expect(screen.getByText("Block results")).toBeTruthy());
      const session = useStore.getState().quizSessions[0];
      expect(session.id).toBe(recovery.runId);
      expect(session.answers[0].answerKey).toBe("B");
      expect(session.answers[0].correct).toBe(change === "unchanged" ? true : undefined);
      expect(session.score).toMatchObject({ scored: change === "unchanged" ? 1 : 0, total: 1 });
      const storedQuestion = useStore.getState().questions[0];
      if (change === "unchanged") {
        expect(storedQuestion.attempts).toHaveLength(2);
        expect(storedQuestion.attempts[0]).toEqual(prior.attempts[0]);
        expect(storedQuestion.attempts[1]).toMatchObject({ quizSessionId: session.id, status: "correct", answerKey: "B" });
      } else {
        expect(storedQuestion).toEqual(prior);
      }
      expect(readSuspendedBlock()).toBeUndefined();
      fireEvent.click(screen.getByRole("button", { name: "Review in the exam interface" }));
      const explanation = screen.getByRole("region", { name: "Explanation" });
      expect(explanation.textContent).toContain(change === "unchanged" ? "Correct" : "Not scored in saved block");
      expect(explanation.textContent).toContain("Current source material may differ");
      if (change === "unchanged") expect(explanation.textContent).toContain("Current correct answer: B");
      else expect(explanation.textContent).not.toContain("Current correct answer:");
      expect(useStore.getState().quizSessions[0]).toEqual(session);
    },
  );
});

describe("Simulation history is distinct from current-question attempts", () => {
  const cases = [
    ["valid", true], ["valid", false], ["stale", true], ["stale", false],
  ] as const;
  it.each(cases)("preserves flag-only and unanswered history without invalid attribution (%s, flagged=%s)", async (evidence, flagged) => {
    const original = q("q1");
    await act(async () => { useStore.setState({ questions: [original] }); });
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /UWorld-style/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start exam block/ }));
    const sim = screen.getByRole("dialog", { name: "UWorld-style exam simulation" });
    if (flagged) fireEvent.click(within(sim).getByRole("button", { name: "Mark item for review" }));

    const current = evidence === "stale" ? { ...original, stem: "Replacement stem" } : original;
    const prior = applyAttempt(current, {
      answerKey: "B", status: "correct", mode: "tutor", quizSessionId: "prior-current-version",
    }, new Date("2026-11-23T12:00:00Z"));
    await act(async () => { useStore.setState({ questions: [prior] }); });

    // Exercise retry of an evidence-invalid flagged row after the first save was
    // not acknowledged. The session stays recoverable; no attempt is attributed.
    const flush = evidence === "stale" && flagged
      ? vi.spyOn(localVault, "flushLocalVaultWrites")
        .mockRejectedValueOnce(new Error("Synthetic vault refusal"))
        .mockResolvedValueOnce(undefined)
      : undefined;
    try {
      fireEvent.click(within(sim).getByRole("button", { name: /End Block/ }));
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "End Block" }));
      if (flush) {
        const warning = await screen.findByRole("alert");
        expect(readSuspendedBlock()?.items.q1.marked).toBe(true);
        expect(useStore.getState().questions[0]).toEqual(prior);
        const firstRun = useStore.getState().quizSessions[0];
        fireEvent.click(within(warning).getByRole("button", { name: "Retry save" }));
        await waitFor(() => expect(screen.getByText("Block results")).toBeTruthy());
        expect(useStore.getState().quizSessions[0].id).toBe(firstRun.id);
      }
      await waitFor(() => expect(screen.getByText("Block results")).toBeTruthy());
      const state = useStore.getState();
      expect(state.quizSessions).toHaveLength(1);
      expect(state.quizSessions[0].answers[0]).toMatchObject({
        flagged, correct: evidence === "valid" ? false : undefined,
      });
      expect(state.quizSessions[0].answers[0].answerKey).toBeUndefined();
      if (evidence === "valid" && flagged) {
        expect(state.questions[0].attempts).toHaveLength(2);
        expect(state.questions[0].attempts[1]).toMatchObject({ quizSessionId: state.quizSessions[0].id, status: "incorrect" });
      } else {
        expect(state.questions[0]).toEqual(prior);
      }
      expect(readSuspendedBlock()).toBeUndefined();
    } finally {
      flush?.mockRestore();
    }
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
