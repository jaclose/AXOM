import { describe, expect, it } from "vitest";
import { examReducer, itemState, startBlock, type ExamAction, type ExamBlock } from "./engine";
import { blockFromPlayerSnapshot, certaintiesFromPlayerSnapshot, checkedFromPlayerSnapshot, playerAnswer, type PlayerSnapshot } from "./playerBlock";
import { recordedSeconds } from "./questionTime";

const T0 = 1_700_000_000_000;
const ids = ["q1", "q2", "q3"];
const run = (block: ExamBlock, ...actions: ExamAction[]) => actions.reduce(examReducer, block);

describe("what the AXOM player counts as an answer", () => {
  it("in an exam, the pick is the answer, with the time spent so far", () => {
    const block = run(startBlock({ ids, mode: "exam", now: T0 }), { type: "pick", key: "B" });
    expect(playerAnswer(block, "q1", T0 + 12_000, "B")).toEqual({ questionId: "q1", answerKey: "B", correct: true, flagged: false, seconds: 12 });
    expect(playerAnswer(block, "q1", T0 + 12_000, "A").correct).toBe(false);
  });

  it("leaves a question with no answer unscored, and without a time", () => {
    const block = run(startBlock({ ids, mode: "exam", now: T0 }), { type: "mark" }, { type: "go", index: 1, now: T0 + 30_000 });
    // Flagged and looked at for half a minute, never answered: not a miss, and not a slow answer.
    expect(playerAnswer(block, "q1", T0 + 40_000, "B")).toEqual({ questionId: "q1", flagged: true });
    expect(playerAnswer(block, "q3", T0 + 40_000, "B")).toEqual({ questionId: "q3", flagged: false });
  });

  it("does not score an answer to a question whose key is not trusted", () => {
    const block = run(startBlock({ ids, mode: "exam", now: T0 }), { type: "pick", key: "B" });
    expect(playerAnswer(block, "q1", T0, undefined)).toMatchObject({ answerKey: "B", correct: undefined });
  });

  it("in tutor mode, a pick is an answer only once it is checked", () => {
    const picked = run(startBlock({ ids, mode: "tutor", now: T0 }), { type: "pick", key: "A" });
    expect(playerAnswer(picked, "q1", T0 + 5_000, "B")).toEqual({ questionId: "q1", flagged: false });

    const checked = run(picked, { type: "reveal", now: T0 + 9_000 });
    // Checking seals the time: a minute on the explanation adds nothing.
    expect(playerAnswer(checked, "q1", T0 + 69_000, "B")).toEqual({ questionId: "q1", answerKey: "A", correct: false, flagged: false, seconds: 9 });
  });

  it("records how sure the learner was only when they said so", () => {
    const block = run(startBlock({ ids, mode: "exam", now: T0 }), { type: "pick", key: "B" });
    expect(playerAnswer(block, "q1", T0, "B", { certainty: "sure" }).certainty).toBe("sure");
    expect(playerAnswer(block, "q1", T0, "B")).not.toHaveProperty("certainty");
  });

  it("keeps a checked tutor answer as it was saved, even after its key is disputed", () => {
    const block = run(startBlock({ ids, mode: "tutor", now: T0 }), { type: "pick", key: "A" }, { type: "reveal", now: T0 + 9_000 });
    const saved = playerAnswer(block, "q1", T0 + 9_000, "B", { certainty: "sure" });
    // The learner marks the key as wrong (no trusted key any more) and flags the question.
    const later = run(block, { type: "mark" });
    expect(playerAnswer(later, "q1", T0 + 90_000, undefined, { checked: saved })).toEqual({ ...saved, flagged: true });
  });
});

describe("the AXOM player's resume snapshot", () => {
  const exam: PlayerSnapshot = {
    mode: "exam", index: 1, startedAt: "2026-07-10T01:00:00.000Z", revealed: false, picked: "C",
    answers: [
      { questionId: "q1", answerKey: "A", correct: false, flagged: true, seconds: 20, certainty: "unsure" },
      { questionId: "q2", answerKey: "B", correct: true, flagged: false, seconds: 7 },
    ],
    certainty: "sure",
  };

  it("brings an exam block back with its picks, flags and times, and the pick on screen", () => {
    const block = blockFromPlayerSnapshot(exam, ids, T0);
    expect(block).toMatchObject({ mode: "exam", phase: "testing", index: 1, startedAt: exam.startedAt });
    expect(itemState(block, "q1")).toMatchObject({ answerKey: "A", marked: true, revealed: false });
    // The pick on screen is newer than the answer recorded on an earlier visit.
    expect(itemState(block, "q2")).toMatchObject({ answerKey: "C", visited: true });
    expect(recordedSeconds(block.times, "q1", T0 + 60_000)).toBe(20);
    // The question on screen goes on counting from where it stopped.
    expect(recordedSeconds(block.times, "q2", T0 + 3_000)).toBe(10);
  });

  it("brings a tutor block back with checked answers checked, and their time closed", () => {
    const tutor: PlayerSnapshot = { ...exam, mode: "tutor", index: 0, picked: "A", revealed: true };
    const block = blockFromPlayerSnapshot(tutor, ids, T0);
    expect(itemState(block, "q1")).toMatchObject({ answerKey: "A", revealed: true });
    expect(itemState(block, "q2")).toMatchObject({ answerKey: "B", revealed: true });
    expect(recordedSeconds(block.times, "q1", T0 + 60_000)).toBe(20);
    expect(checkedFromPlayerSnapshot(tutor)).toEqual({ q1: tutor.answers[0], q2: tutor.answers[1] });
    expect(checkedFromPlayerSnapshot(exam)).toEqual({});
  });

  it("brings back a tutor pick that was not checked yet as a pick, not an answer", () => {
    const tutor: PlayerSnapshot = { mode: "tutor", index: 2, startedAt: exam.startedAt, answers: [], picked: "B", revealed: false };
    const block = blockFromPlayerSnapshot(tutor, ids, T0);
    expect(itemState(block, "q3")).toMatchObject({ answerKey: "B", revealed: false });
    expect(playerAnswer(block, "q3", T0, "B")).toEqual({ questionId: "q3", flagged: false });
  });

  it("reads a snapshot written before the engine, and one whose position no longer exists", () => {
    // Before the engine, moving forward onto a checked tutor question showed it
    // as unanswered. Its answer was saved, so it comes back checked.
    const old: PlayerSnapshot = { mode: "tutor", index: 9, startedAt: exam.startedAt, revealed: false, answers: [{ questionId: "q3", answerKey: "A", correct: false, flagged: false }] };
    const block = blockFromPlayerSnapshot(old, ids, T0);
    expect(block.index).toBe(2);
    expect(itemState(block, "q3")).toMatchObject({ answerKey: "A", revealed: true });
  });

  it("keeps how sure the learner was, by question", () => {
    expect(certaintiesFromPlayerSnapshot(exam, ids)).toEqual({ q1: "unsure", q2: "sure" });
  });
});
