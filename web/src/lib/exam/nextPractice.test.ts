import { describe, expect, it } from "vitest";
import type { QuestionRecord } from "../questions";
import { nextPractice } from "./nextPractice";

const now = new Date("2026-11-16T12:00:00Z");
const question = (id: string, patch: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id, source: "imported", stem: "Synthetic question", options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }],
  correctKey: "A", status: "unseen", tags: [], attempts: [], createdAt: "2026-11-01", updatedAt: "2026-11-01", ...patch,
});

describe("next practice from observed evidence", () => {
  it("prefers scheduled reviews, then actual latest misses, then unseen records", () => {
    const due = question("due", { reviewDueAt: "2026-11-15T00:00:00Z" });
    const missed = question("missed", { status: "incorrect", attempts: [{ at: "2026-11-16T10:00:00Z", status: "incorrect", answerKey: "B" }] });
    const unseen = question("unseen");
    expect(nextPractice([unseen, missed, due], now)).toMatchObject({ kind: "due", questionIds: ["due"], title: "Review 1 due question" });
    expect(nextPractice([unseen, missed], now)).toMatchObject({ kind: "missed", questionIds: ["missed"], title: "Retry 1 missed question" });
    expect(nextPractice([unseen], now)).toMatchObject({ kind: "unseen", questionIds: ["unseen"] });
  });

  it("does not turn a status flag or superseded miss into observed errors", () => {
    const corrected = question("corrected", { status: "incorrect", attempts: [
      { at: "2026-11-16T10:00:00Z", status: "correct", answerKey: "A" },
      { at: "2026-11-15T10:00:00Z", status: "incorrect", answerKey: "B" },
    ] });
    expect(nextPractice([corrected, question("flag", { status: "incorrect" }), question("reported", {
      status: "incorrect", attempts: [{ at: "2026-11-15T10:00:00Z", status: "incorrect" }],
    })], now)).toBeNull();
  });

  it("holds duplicate identities, unresolved answers and malformed due dates", () => {
    const duplicate = question("duplicate");
    const held = question("held", { correctKey: undefined, reviewDueAt: "2026-11-01" });
    const malformed = question("malformed", { status: "correct", reviewDueAt: "not-a-date" });
    expect(nextPractice([duplicate, { ...duplicate }, held, malformed, question("")], now)).toBeNull();
  });

  it("keeps the exact small selection and its evidence count without modifying records", () => {
    const questions = Array.from({ length: 28 }, (_, i) => question(`q${String(i).padStart(2, "0")}`));
    const before = structuredClone(questions);
    expect(nextPractice(questions, now, 5)).toMatchObject({ questionIds: questions.slice(0, 5).map(q => q.id), available: 28, title: "Start 5 unseen questions" });
    expect(nextPractice(questions, now)?.questionIds).toHaveLength(10);
    expect(questions).toEqual(before);
  });
});
