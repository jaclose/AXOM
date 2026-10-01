import { describe, expect, it } from "vitest";
import {
  blockAnswers, countBlock, currentId, elapsedSeconds, examReducer, filterCounts, itemSeconds, itemState, matchesFilter,
  navigatorEntries, resumeBlock, reviewBlock, shownResult, startBlock, suspendBlock, type ExamAction, type ExamBlock,
} from "./engine";

const T0 = 1_800_000_000_000;
const at = (seconds: number) => T0 + seconds * 1000;
const IDS = ["q1", "q2", "q3", "q4"];
/** q4 has no trusted key (its source disputes it). */
const KEYS: Record<string, string | undefined> = { q1: "B", q2: "B", q3: "C", q4: undefined };
const keyFor = (id: string) => KEYS[id];

const run = (block: ExamBlock, ...actions: ExamAction[]) => actions.reduce(examReducer, block);
const exam = () => startBlock({ ids: IDS, mode: "exam", now: at(0) });
const tutor = () => startBlock({ ids: IDS, mode: "tutor", now: at(0) });

describe("exam block engine", () => {
  it("opens on the first item, with its clock and the block clock running", () => {
    const block = exam();
    expect(currentId(block)).toBe("q1");
    expect(itemState(block, "q1").visited).toBe(true);
    expect(itemState(block, "q2").visited).toBe(false);
    expect(itemSeconds(block, "q1", at(12))).toBe(12);
    expect(elapsedSeconds(block, at(12))).toBe(12);
    expect(block.startedAt).toBe(new Date(T0).toISOString());
  });

  it("moves anywhere in the block and nowhere outside it", () => {
    const block = run(exam(), { type: "go", index: 2, now: at(10) });
    expect(currentId(block)).toBe("q3");
    expect(itemState(block, "q3").visited).toBe(true);
    for (const index of [-1, 4, 2, 1.5, Number.NaN]) expect(examReducer(block, { type: "go", index, now: at(20) })).toBe(block);
  });

  it("gives each item the time it was on screen, across visits", () => {
    const block = run(exam(),
      { type: "go", index: 1, now: at(30) },
      { type: "go", index: 0, now: at(50) },
      { type: "go", index: 3, now: at(65) },
    );
    expect(itemSeconds(block, "q1", at(100))).toBe(45);
    expect(itemSeconds(block, "q2", at(100))).toBe(20);
    expect(itemSeconds(block, "q4", at(100))).toBe(35);
    expect(itemSeconds(block, "q3", at(100))).toBe(0);
  });

  it("stops an item's time while AXOM is hidden, but not the block clock", () => {
    const block = run(exam(), { type: "hide", now: at(10) }, { type: "show", now: at(310) });
    expect(itemSeconds(block, "q1", at(315))).toBe(15);
    expect(elapsedSeconds(block, at(315))).toBe(315);
    // Showing twice, or hiding twice, changes nothing.
    expect(examReducer(block, { type: "show", now: at(400) })).toBe(block);
    const hidden = examReducer(block, { type: "hide", now: at(320) });
    expect(examReducer(hidden, { type: "hide", now: at(999) })).toBe(hidden);
  });

  it("records an answer, lets it change, and clears it on a second click only where the exam does", () => {
    let block = run(exam(), { type: "pick", key: "A" }, { type: "pick", key: "C" });
    expect(itemState(block, "q1").answerKey).toBe("C");
    expect(examReducer(block, { type: "pick", key: "C" })).toBe(block);
    block = examReducer(block, { type: "pick", key: "C", toggle: true });
    expect(itemState(block, "q1").answerKey).toBeUndefined();
  });

  it("strikes answers out: the chosen one is un-chosen, and choosing a struck one restores it", () => {
    let block = run(exam(), { type: "pick", key: "A" }, { type: "strike", key: "B" }, { type: "strike", key: "A" });
    expect(itemState(block, "q1")).toMatchObject({ answerKey: undefined, struck: ["B", "A"] });
    block = run(block, { type: "pick", key: "B" }, { type: "strike", key: "A" });
    expect(itemState(block, "q1")).toMatchObject({ answerKey: "B", struck: [] });
  });

  it("flags and unflags the item on screen", () => {
    let block = run(exam(), { type: "mark" });
    expect(itemState(block, "q1").marked).toBe(true);
    block = examReducer(block, { type: "mark" });
    expect(itemState(block, "q1").marked).toBe(false);
  });

  it("reveals a tutor answer once: the time stops there and the answer is final", () => {
    const answered = run(tutor(), { type: "pick", key: "C" });
    // Nothing to reveal without an answer, and never in exam mode.
    expect(examReducer(tutor(), { type: "reveal", now: at(5) })).toEqual(tutor());
    const examBlock = run(exam(), { type: "pick", key: "C" });
    expect(examReducer(examBlock, { type: "reveal", now: at(5) })).toBe(examBlock);

    const revealed = examReducer(answered, { type: "reveal", now: at(47) });
    expect(itemState(revealed, "q1").revealed).toBe(true);
    expect(itemSeconds(revealed, "q1", at(47))).toBe(47);
    expect(itemSeconds(revealed, "q1", at(600))).toBe(47);
    for (const action of [{ type: "pick", key: "B" }, { type: "strike", key: "C" }, { type: "reveal", now: at(60) }] as ExamAction[]) {
      expect(examReducer(revealed, action)).toBe(revealed);
    }
    // Leaving and coming back does not start it again.
    const back = run(revealed, { type: "go", index: 1, now: at(100) }, { type: "go", index: 0, now: at(130) });
    expect(itemSeconds(back, "q1", at(500))).toBe(47);
  });

  it("counts answered, unanswered, flagged and seen", () => {
    const block = run(exam(), { type: "pick", key: "A" }, { type: "go", index: 2, now: at(5) }, { type: "mark" });
    expect(countBlock(block)).toEqual({ answered: 1, unanswered: 3, flagged: 1, seen: 2, total: 4 });
  });
});

describe("testing and review stay apart", () => {
  it("shows no result at all while an exam is being sat", () => {
    const block = run(exam(), { type: "pick", key: "B" }, { type: "go", index: 1, now: at(5) }, { type: "pick", key: "A" });
    for (const id of IDS) expect(shownResult(block, id, keyFor(id))).toBeUndefined();
    const entries = navigatorEntries(block, keyFor);
    expect(entries.every((entry) => entry.result === undefined)).toBe(true);
    expect(entries.map((entry) => [entry.position, entry.current, entry.answered, entry.visited])).toEqual([
      [0, false, true, true], [1, true, true, true], [2, false, false, false], [3, false, false, false],
    ]);
    // Result filters match nothing while results are hidden.
    expect(filterCounts(entries)).toEqual({ all: 4, flagged: 0, unanswered: 2, answered: 2, incorrect: 0, correct: 0 });
  });

  it("shows a tutor item's result only once that item has been submitted", () => {
    let block = run(tutor(), { type: "pick", key: "C" });
    expect(shownResult(block, "q1", "B")).toBeUndefined();
    block = examReducer(block, { type: "reveal", now: at(10) });
    expect(shownResult(block, "q1", "B")).toBe("incorrect");
    block = run(block, { type: "go", index: 1, now: at(12) }, { type: "pick", key: "B" });
    expect(shownResult(block, "q2", "B")).toBeUndefined();
    expect(navigatorEntries(block, keyFor).map((entry) => entry.result)).toEqual(["incorrect", undefined, undefined, undefined]);
  });

  it("shows every result in review, and review changes nothing", () => {
    const sat = run(exam(),
      { type: "pick", key: "B" }, { type: "go", index: 1, now: at(20) },
      { type: "pick", key: "A" }, { type: "mark" }, { type: "go", index: 3, now: at(50) },
      { type: "pick", key: "D" },
    );
    const answers = blockAnswers(sat, at(70), keyFor);
    const review = reviewBlock({ ids: IDS, answers, mode: "exam", startedAt: sat.startedAt, elapsedSeconds: 70 });
    expect(review.phase).toBe("review");
    const entries = navigatorEntries(review, keyFor);
    expect(entries.map((entry) => entry.result)).toEqual(["correct", "incorrect", "omitted", "unscored"]);
    expect(entries[1].flagged).toBe(true);
    expect(filterCounts(entries)).toEqual({ all: 4, flagged: 1, unanswered: 1, answered: 3, incorrect: 1, correct: 1 });
    expect(entries.filter((entry) => matchesFilter(entry, "incorrect")).map((entry) => entry.id)).toEqual(["q2"]);

    for (const action of [{ type: "pick", key: "C" }, { type: "strike", key: "A" }, { type: "mark" }, { type: "reveal", now: at(80) }, { type: "note", text: "x" }, { type: "show", now: at(80) }, { type: "hide", now: at(80) }] as ExamAction[]) {
      expect(examReducer(review, action)).toBe(review);
    }
    // Moving about a review costs no time.
    const moved = examReducer(review, { type: "go", index: 1, now: at(500) });
    expect(currentId(moved)).toBe("q2");
    expect(itemSeconds(moved, "q2", at(9_000))).toBe(30);
    expect(elapsedSeconds(moved, at(9_000))).toBe(70);
  });
});

describe("leaving a block", () => {
  it("scores only where the key is trusted, and writes whole seconds", () => {
    const block = run(exam(),
      { type: "pick", key: "B" }, { type: "go", index: 1, now: at(20.4) },
      { type: "pick", key: "A" }, { type: "mark" }, { type: "go", index: 3, now: at(31) },
      { type: "pick", key: "D" },
    );
    expect(blockAnswers(block, at(40.6), keyFor)).toEqual([
      { questionId: "q1", answerKey: "B", correct: true, flagged: false, seconds: 20 },
      { questionId: "q2", answerKey: "A", correct: false, flagged: true, seconds: 11 },
      { questionId: "q3", answerKey: undefined, correct: false, flagged: false, seconds: 0 },
      { questionId: "q4", answerKey: "D", correct: undefined, flagged: false, seconds: 10 },
    ]);
  });

  it("suspends with the clock and the item's time stopped, and resumes without losing a second", () => {
    const sat = run(tutor(),
      { type: "pick", key: "C" }, { type: "reveal", now: at(40) }, { type: "go", index: 1, now: at(70) },
      { type: "strike", key: "A" }, { type: "mark" }, { type: "note", text: "check renal" },
    );
    const suspended = suspendBlock(sat, at(100), { skin: "examsoft", timeLimitSeconds: 1800 });
    expect(suspended).toMatchObject({
      version: 1, skin: "examsoft", mode: "tutor", poolIds: IDS, index: 1, elapsedMs: 100_000, timeLimitSeconds: 1800, notes: "check renal",
      suspendedAt: new Date(at(100)).toISOString(),
    });
    expect(suspended.items.q1).toEqual({ answerKey: "C", marked: false, struck: [], seconds: 40, visited: true, submitted: true });
    expect(suspended.items.q2).toEqual({ answerKey: undefined, marked: true, struck: ["A"], seconds: 30, visited: true });
    expect(suspended.items.q3).toBeUndefined();

    // A day later.
    const resumed = resumeBlock(suspended, IDS, at(86_500));
    expect(currentId(resumed)).toBe("q2");
    expect(elapsedSeconds(resumed, at(86_510))).toBe(110);
    expect(itemSeconds(resumed, "q2", at(86_510))).toBe(40);
    expect(itemSeconds(resumed, "q1", at(86_510))).toBe(40);
    expect(itemState(resumed, "q1")).toMatchObject({ answerKey: "C", revealed: true });
    expect(shownResult(resumed, "q1", "B")).toBe("incorrect");
    expect(itemState(resumed, "q2")).toMatchObject({ marked: true, struck: ["A"] });
    expect(resumed.notes).toBe("check renal");
  });

  it("resumes a block saved by the earlier simulator, and one whose pool shrank", () => {
    const legacy = {
      version: 1 as const, skin: "uworld" as const, mode: "exam" as const, poolIds: ["q1", "q2", "gone"], index: 2,
      items: { q1: { answerKey: "A", marked: true, struck: ["B"], seconds: 12.5, visited: true }, gone: { marked: false, struck: [], seconds: 3, visited: true } },
      elapsedMs: 60_000, notes: "", startedAt: "2026-09-30T10:00:00.000Z", suspendedAt: "2026-09-30T10:01:00.000Z",
    };
    const resumed = resumeBlock(legacy, ["q1", "q2"], at(0));
    expect(currentId(resumed)).toBe("q2");
    expect(itemSeconds(resumed, "q1", at(50))).toBe(13);
    expect(itemState(resumed, "q1")).toMatchObject({ answerKey: "A", marked: true, struck: ["B"], revealed: false });
    expect(resumed.items.gone).toBeUndefined();
  });
});
