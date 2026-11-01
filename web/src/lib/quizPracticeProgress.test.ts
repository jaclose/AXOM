import { describe, expect, it } from "vitest";
import type { QuizSession } from "./quiz";
import { quizPracticeLog, quizPracticeLogId, withQuizPracticeLog } from "./quizPracticeProgress";

const session = (patch: Partial<QuizSession> = {}): QuizSession => ({
  id: "run-1", mode: "tutor", startedAt: "2026-10-23T10:00:00.000Z", endedAt: "2026-10-23T10:05:00.000Z",
  timed: false, filters: { count: 3, status: "all" }, questionIds: ["q1", "q2", "q3"],
  answers: [
    { questionId: "q1", answerKey: "A", correct: true, flagged: false, seconds: 65 },
    { questionId: "q2", answerKey: "B", correct: false, flagged: false, seconds: 55 },
    { questionId: "q3", flagged: true, seconds: 20 },
  ], ...patch,
});
describe("quiz practice progress", () => {
  it("projects exact answered-question and observed-time totals", () => {
    expect(quizPracticeLog(session(), "2026-10-23")).toMatchObject({
      id: quizPracticeLogId("run-1"), quantity: 2, quantityKind: "questions", minutes: 2.33,
      note: "Tutor block · 2/3 answered", academic: true, productive: true,
    });
  });

  it("upserts one deterministic event and preserves its original study day", () => {
    const first = withQuizPracticeLog([], session(), "2026-10-23");
    const second = withQuizPracticeLog(first, session({ endedAt: "2026-10-24T10:05:00.000Z" }), "2026-10-24");
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ id: "qbank-session:run-1", dayKey: "2026-10-23", ts: "2026-10-23T10:05:00.000Z" });
  });

  it("does not create progress for a flag-only run", () => {
    expect(quizPracticeLog(session({ answers: [{ questionId: "q1", flagged: true }] }), "2026-10-23")).toBeUndefined();
  });
});
