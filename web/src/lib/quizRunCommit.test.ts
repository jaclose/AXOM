import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import type { QuizSession } from "./quiz";

function addQuestion(id: string) {
  const result = useStore.getState().addQuestion({
    id,
    source: "manual",
    stem: `Stem ${id}`,
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    correctKey: "B",
    tags: [],
  });
  expect(result.ok).toBe(true);
}

function session(id: string, questionIds: string[]): QuizSession {
  return {
    id,
    mode: "exam",
    startedAt: "2026-07-10T00:00:00.000Z",
    endedAt: "2026-07-10T00:10:00.000Z",
    timed: false,
    filters: { count: questionIds.length, status: "all" },
    questionIds,
    answers: questionIds.map((questionId) => ({ questionId, answerKey: "B", correct: true, flagged: false })),
  };
}

beforeEach(() => {
  useStore.getState().replaceAll(makeSeed());
  for (const id of ["q-1", "q-2", "q-3"]) addQuestion(id);
});

describe("committing a block run", () => {
  it("saves every attempt and the session in one state change", () => {
    const changes = vi.fn();
    const unsubscribe = useStore.subscribe(changes);

    useStore.getState().commitQuizRun({
      attempts: ["q-1", "q-2"].map((questionId) => ({
        questionId,
        attempt: { answerKey: "B", status: "correct" as const, quizSessionId: "run-1", mode: "exam" as const },
      })),
      session: session("run-1", ["q-1", "q-2", "q-3"]),
    });
    unsubscribe();

    // One change is one serialized snapshot: the result can never reach the
    // vault without its answers, or the other way round.
    expect(changes).toHaveBeenCalledTimes(1);
    const state = useStore.getState();
    expect(state.quizSessions[0].id).toBe("run-1");
    expect(state.questions.find((q) => q.id === "q-1")?.attempts).toHaveLength(1);
    expect(state.questions.find((q) => q.id === "q-2")?.status).toBe("correct");
    expect(state.questions.find((q) => q.id === "q-3")?.attempts).toHaveLength(0);
  });

  it("can be written again for the same run without adding attempts or sessions", () => {
    const run = {
      attempts: [{ questionId: "q-1", attempt: { answerKey: "A", status: "incorrect" as const, quizSessionId: "run-1" } }],
      session: session("run-1", ["q-1"]),
    };
    useStore.getState().commitQuizRun(run);
    useStore.getState().commitQuizRun(run);

    const state = useStore.getState();
    expect(state.questions.find((q) => q.id === "q-1")?.attempts).toHaveLength(1);
    expect(state.quizSessions.filter((item) => item.id === "run-1")).toHaveLength(1);
  });

  it("keeps a tutor answer saved at check when the block's result arrives later", () => {
    useStore.getState().recordQuestionAttempt("q-1", { answerKey: "A", status: "incorrect", quizSessionId: "run-1", mode: "tutor" });
    useStore.getState().recordQuestionAttempt("q-1", {
      answerKey: "A", status: "incorrect", errorType: "knowledge-gap", quizSessionId: "run-1", mode: "tutor",
    });
    useStore.getState().commitQuizRun({ attempts: [], session: { ...session("run-1", ["q-1"]), mode: "tutor", endedEarly: true } });

    const saved = useStore.getState().questions.find((q) => q.id === "q-1");
    expect(saved?.attempts).toHaveLength(1);
    expect(saved?.attempts[0].errorType).toBe("knowledge-gap");
    expect(useStore.getState().quizSessions[0].endedEarly).toBe(true);
  });
});
