import { describe, expect, it } from "vitest";
import { makeSeed } from "./seed";
import { localDateKey } from "./dailyRollover";
import { quizPracticeLogId } from "./quizPracticeProgress";
import type { NoctyriumState, StudyLog, TrackerItem } from "./types";
import type { QuestionAttempt, QuestionRecord } from "./questions";
import { buildStudyPlan, observedDay } from "./studyPlan";

const NOW = new Date("2026-11-15T15:00:00");
const daysAgo = (days: number, hour = 10) => new Date(NOW.getTime() - days * 86_400_000 + (hour - 15) * 3_600_000).toISOString();

function question(id: string, patch: Partial<QuestionRecord> = {}, attempts: QuestionAttempt[] = []): QuestionRecord {
  return { id, source: "imported", stem: `Synthetic stem ${id}`, options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }], correctKey: "A",
    status: "unseen", tags: [], attempts, createdAt: daysAgo(30), updatedAt: daysAgo(30), module: "GOER", ...patch };
}
const wrong = (days: number, patch: Partial<QuestionAttempt> = {}): QuestionAttempt => ({ at: daysAgo(days), status: "incorrect", answerKey: "B", ...patch });
const right = (days: number, patch: Partial<QuestionAttempt> = {}): QuestionAttempt => ({ at: daysAgo(days), status: "correct", answerKey: "A", ...patch });
function row(id: string, path: string, patch: Partial<TrackerItem> = {}): TrackerItem {
  return { id, path, label: `Lecture ${id}`, kind: "Lecture", passes: 0, ankiPasses: 0, yield: "none", updated: daysAgo(20), ...patch } as TrackerItem;
}
function workspace(patch: Partial<NoctyriumState>): NoctyriumState {
  return { ...makeSeed(), questions: [], tracker: [], logs: [], quizSessions: [], cardReviews: [], questionSets: [],
    activeDayKey: localDateKey(NOW), ...patch };
}
const ids = (plan: ReturnType<typeof buildStudyPlan>, index: number) => {
  const launch = plan.actions[index].launch;
  return launch.type === "practice" ? launch.questionIds : [];
};

describe("study plan", () => {
  it("says so when there is nothing to plan from, and invents no action", () => {
    const plan = buildStudyPlan(workspace({}), NOW);
    expect(plan).toMatchObject({ actions: [], empty: true });
    expect(plan.observed).toEqual({ answered: 0, correct: 0, accuracy: null, trackerPasses: 0, cardReviews: 0, observedMinutes: 0, reportedMinutes: 0 });
  });

  it("puts an unfinished block first and sends the learner back to it", () => {
    const plan = buildStudyPlan(workspace({ questions: [question("q1", {}, [wrong(1)])] }), NOW, { total: 12 });
    expect(plan.actions[0]).toMatchObject({ kind: "resume-run", actionLabel: "Resume", launch: { type: "route", route: "questions" } });
    expect(plan.actions[0].reason).toContain("12 questions");
    expect(plan.actions[1].kind).toBe("retry-missed");
  });

  it("rechecks recent confident misses before ordinary misses and never repeats a question", () => {
    const plan = buildStudyPlan(workspace({ questions: [
      question("sure-recent", {}, [wrong(2, { certainty: "sure" })]),
      question("sure-old", {}, [wrong(30, { certainty: "sure" })]),
      question("plain", {}, [wrong(3)]),
      question("fixed", {}, [wrong(5, { certainty: "sure" }), right(1)]),
    ] }), NOW);
    expect(plan.actions.map((action) => action.kind)).toEqual(["sure-and-wrong", "retry-missed"]);
    expect(ids(plan, 0)).toEqual(["sure-recent"]);
    // A confident miss older than the window is still a miss; a question answered right since is not.
    expect(ids(plan, 1)).toEqual(["plain", "sure-old"]);
    expect(plan.actions[1].title).toBe("Retry 2 missed questions in GOER");
    expect(plan.actions[1].reason).toContain("oldest miss is 30 days old");
  });

  it("retries the module with the most misses, capped at twenty most recent, with exact ids and its real term", () => {
    const state = workspace({ questions: [
      ...Array.from({ length: 23 }, (_, index) => question(`goer-${String(index).padStart(2, "0")}`, {}, [wrong(index + 1)])),
      question("ftm-1", { module: "FTM 1" }, [wrong(1)]),
      question("held", { needsReview: true }, [wrong(1)]),
    ] });
    const plan = buildStudyPlan(state, NOW);
    const action = plan.actions[0];
    expect(action.title).toBe("Retry 20 missed questions in GOER");
    expect(action.reason).toContain("each of 23 questions");
    expect(action.reason).toContain("the 20 most recent");
    expect(action.launch.type).toBe("practice");
    expect(ids(plan, 0)).toEqual(Array.from({ length: 20 }, (_, index) => `goer-${String(index).padStart(2, "0")}`));
    // A question held for answer review can never enter a block.
    expect(plan.actions.flatMap((_, index) => ids(plan, index))).not.toContain("held");
  });

  it("continues the course last worked in at its earliest unfinished week, and offers its unanswered questions", () => {
    const plan = buildStudyPlan(workspace({
      tracker: [
        row("done", "T5/GOER/Week 1", { passes: 1, updated: daysAgo(1), passEvents: [{ id: "p1", method: "study", at: daysAgo(1) }] }),
        row("w2a", "T5/GOER/Week 2"), row("w2b", "T5/GOER/Week 2"), row("w3", "T5/GOER/Week 3"),
        row("snoozed", "T5/GOER/Week 2", { recommendationSnoozedUntil: new Date(NOW.getTime() + 86_400_000).toISOString() }),
        row("archived", "T5/GOER/Week 2", { archivedAt: daysAgo(2) }),
        row("other", "T1/FTM 1/Week 1"),
      ],
      questions: [question("new-1"), question("new-2"), question("seen", {}, [right(4)]), question("elsewhere", { module: "FTM 1" })],
    }), NOW);
    expect(plan.actions.map((action) => action.kind)).toEqual(["continue-course", "new-questions"]);
    expect(plan.actions[0]).toMatchObject({ title: "Continue GOER, Week 2", launch: { type: "route", route: "tracker" } });
    expect(plan.actions[0].reason).toContain("2 activities are not started in the earliest unfinished week");
    expect(plan.actions[1].title).toBe("Meet 2 new questions in GOER");
    expect(ids(plan, 1)).toEqual(["new-1", "new-2"]);
  });

  it("does not guess a course when no tracker work was ever recorded", () => {
    const plan = buildStudyPlan(workspace({ tracker: [row("a", "T5/GOER/Week 1"), row("b", "T5/GOER/Week 2")], questions: [question("unanswered")] }), NOW);
    expect(plan.actions).toEqual([]);
    expect(plan.empty).toBe(false);
  });

  it("estimates minutes only from the learner's own timed answers, once there are enough", () => {
    const few = buildStudyPlan(workspace({ questions: [question("m", {}, [wrong(1, { timeSpentSeconds: 90 })])] }), NOW);
    expect(few.actions[0].minutes).toBeUndefined();
    const timed = Array.from({ length: 6 }, (_, index) => question(`t-${index}`, {}, [right(index + 2, { timeSpentSeconds: 60 })]));
    const enough = buildStudyPlan(workspace({ questions: [...timed, question("m1", {}, [wrong(1, { timeSpentSeconds: 60 })]), question("m2", {}, [wrong(1, { timeSpentSeconds: 60 })])] }), NOW);
    expect(enough.actions[0]).toMatchObject({ kind: "retry-missed", minutes: 2 });
  });

  it("offers flagged questions last and keeps the plan to four actions", () => {
    const plan = buildStudyPlan(workspace({
      tracker: [row("done", "T5/GOER/Week 1", { passes: 1, updated: daysAgo(1) }), row("next", "T5/GOER/Week 2")],
      questions: [question("sure", {}, [wrong(1, { certainty: "sure" })]), question("miss", {}, [wrong(1)]),
        question("new"), question("flag", { marked: true, module: "FTM 1" }, [right(2)])],
    }), NOW, { total: 5 });
    expect(plan.actions.map((action) => action.kind)).toEqual(["resume-run", "sure-and-wrong", "retry-missed", "continue-course"]);
    const withoutRun = buildStudyPlan(workspace({ questions: [question("flag", { marked: true }, [right(2)])] }), NOW);
    expect(withoutRun.actions.map((action) => action.kind)).toEqual(["flagged"]);
  });
});

describe("study plan for one surface", () => {
  it("lists a retry for each module with misses and only the kinds a surface asks for", () => {
    const state = workspace({
      tracker: [row("done", "T5/GOER/Week 1", { passes: 1, updated: daysAgo(1) }), row("next", "T5/GOER/Week 2")],
      questions: [question("g1", {}, [wrong(1)]), question("g2", {}, [wrong(2)]), question("f1", { module: "FTM 1" }, [wrong(1)]),
        question("unfiled", { module: undefined }, [wrong(4)]), question("new")],
    });
    const bank = buildStudyPlan(state, NOW, { total: 3 }, { kinds: ["sure-and-wrong", "retry-missed", "new-questions", "flagged"], limit: 6, everyMissedModule: true });
    expect(bank.actions.map((action) => action.title)).toEqual([
      "Retry 2 missed questions in GOER", "Retry 1 missed question in FTM 1", "Retry 1 missed question in Unfiled questions", "Meet 1 new question in GOER",
    ]);
    expect(bank.actions.every((action) => action.launch.type === "practice")).toBe(true);
    expect(bank.actions[2].launch).toEqual({ type: "practice", questionIds: ["unfiled"] });
    // The default plan keeps one retry so that the course itself stays in view.
    expect(buildStudyPlan(state, NOW).actions.map((action) => action.kind)).toEqual(["retry-missed", "continue-course", "new-questions"]);
  });
});

describe("a partly restored workspace", () => {
  it("reads absent collections as empty instead of failing", () => {
    const partial = { questions: [question("m", {}, [wrong(1)])], activeDayKey: localDateKey(NOW) } as unknown as NoctyriumState;
    const plan = buildStudyPlan(partial, NOW);
    expect(plan.actions.map((action) => action.kind)).toEqual(["retry-missed"]);
    expect(plan.observed.trackerPasses).toBe(0);
  });
});

describe("what AXOM saw today", () => {
  it("counts recorded answers, passes and reviews for the day and keeps timed minutes apart from typed ones", () => {
    const log = (patch: Partial<StudyLog>): StudyLog => ({ id: "l", dayKey: localDateKey(NOW), ts: daysAgo(0), type: "Manual", minutes: 0, cards: 0, ...patch });
    const state = workspace({
      questions: [question("a", {}, [right(0), wrong(3)]), question("b", {}, [wrong(0)]), question("c", {}, [right(0)])],
      tracker: [row("t", "T5/GOER/Week 1", { passes: 1, passEvents: [{ id: "p", method: "study", at: daysAgo(0) }, { id: "old", method: "study", at: daysAgo(2) }] })],
      cardReviews: [{ id: "r1", at: daysAgo(0) }, { id: "r2", at: daysAgo(1) }] as NoctyriumState["cardReviews"],
      quizSessions: [{ id: "run-1" }] as NoctyriumState["quizSessions"],
      logs: [log({ id: "focus", type: "Pomodoro", minutes: 50 }), log({ id: quizPracticeLogId("run-1"), type: "Question Bank", minutes: 18 }),
        log({ id: "typed", type: "Lecture", minutes: 40 }), log({ id: "yesterday", type: "Pomodoro", minutes: 25, dayKey: "2026-11-14" })],
    });
    expect(observedDay(state, state.activeDayKey)).toEqual({ answered: 3, correct: 2, accuracy: 67, trackerPasses: 1, cardReviews: 1, observedMinutes: 68, reportedMinutes: 40 });
  });
});
