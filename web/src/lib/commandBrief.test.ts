import { describe, expect, it } from "vitest";
import {
  assessCommandBriefEvidence, buildCommandBrief, deriveMinimumViableWin, deriveMode, deriveNextBestMove, deriveSignals,
  rankCommandBriefCandidates,
  type BriefEvidenceState, type BriefStateSlice, type BriefSignals,
} from "./commandBrief";
import type { NoctyriumState, Task, TrackerItem } from "./types";
import type { Habit } from "./types";
import { newSchedule, type AnkiCard } from "./ankiCards";
import { makeSeed } from "./seed";
import type { QuestionRecord } from "./questions";
import type { DailySuccessResult } from "./dailySuccess";
import type { ReadinessResult } from "./energy";
import { rankTrackerItems } from "./recommendationFactors";

const TODAY = "2026-07-07";

describe("personalized tracker recommendations across surfaces", () => {
  const now = new Date(`${TODAY}T08:00:00Z`);
  const course = { id: "course", termId: "term", code: "BPM 501", name: "Renal course", files: 0, modules: [], studyPlanOverride: { lecturePasses: 4, reviewAfterDays: 5 } };

  it("uses the same inherited plan and factors as Course Tracker, including work past the legacy target", () => {
    const state = slice({
      tracker: [tracker({ id: "renal", label: "Renal transport", passes: 3 })],
      courses: [course],
      studyWorkflow: { configured: true, lecturePasses: 2, methods: [{ id: "anki", enabled: false }, { id: "notes", enabled: true }] },
    });
    const [shared] = rankTrackerItems(state.tracker, { preferences: state.studyWorkflow, courses: state.courses, now });
    const [candidate] = rankCommandBriefCandidates(state, "maintain", now);
    expect(candidate.link.id).toBe(shared.item.id);
    expect(candidate.score).toBe(shared.score);
    expect(candidate.resources).toEqual(["Notes"]);
    expect(candidate.expectedOutcome).toBe("Complete pass 4 of 4 in your study plan.");
    expect(candidate.studyPlan).toEqual({ summary: "3 of 4 passes complete · Review after 5 days.", sources: ["learner defaults", "course override"] });
    expect(assessCommandBriefEvidence(evidenceState({ ...state, courses: [course] }), { now }).actionableCount).toBe(1);
  });

  it("applies item-kind and item overrides without changing saved preferences", () => {
    const state = slice({
      tracker: [tracker({ id: "renal", passes: 3, studyPlanOverride: { lecturePasses: 6, reviewAfterDays: 7 } })],
      courses: [course],
      studyWorkflow: { configured: true, lecturePasses: 2, itemKindDefaults: { Lecture: { lecturePasses: 5 } } },
    });
    const before = structuredClone(state);
    const [candidate] = rankCommandBriefCandidates(state, "maintain", now);
    expect(candidate.studyPlan?.summary).toBe("3 of 6 passes complete · Review after 7 days.");
    expect(candidate.studyPlan?.sources).toEqual(["learner defaults", "course override", "item-kind default", "item override"]);
    expect(state).toEqual(before);
    state.tracker[0] = { ...state.tracker[0], studyPlanOverride: undefined };
    expect(rankCommandBriefCandidates(state, "maintain", now)[0].expectedOutcome).toMatch(/4 of 5/);
  });

  it("omits completed and snoozed work from activation, backlog, primary moves, and small wins", () => {
    const state = slice({
      tracker: [tracker({ id: "done", passes: 1, yield: "review" }), tracker({ id: "later", passes: 1, yield: "review", studyPlanOverride: { lecturePasses: 3 }, recommendationSnoozedUntil: "2026-07-09T08:00:00Z" })],
      studyWorkflow: { configured: true, lecturePasses: 1 },
    });
    expect(rankCommandBriefCandidates(state, "maintain", now)).toEqual([]);
    expect(deriveSignals(state, now)).toMatchObject({ reviewFlagged: 0, backlogScore: 0 });
    expect(deriveMinimumViableWin(state, deriveSignals(state, now), now).link.kind).toBe("free");
    expect(assessCommandBriefEvidence(evidenceState({ ...state, courses: [] }), { now }).actionableCount).toBe(0);
    expect(rankCommandBriefCandidates(state, "maintain", new Date("2026-07-10T08:00:00Z"))[0].link.id).toBe("later");
  });
});

function tracker(patch: Partial<TrackerItem>): TrackerItem {
  return {
    id: crypto.randomUUID(), path: "Term 2/BPM 501/NB3/Lectures", label: "Lecture",
    kind: "Lecture", passes: 0, ankiPasses: 0, yield: "none", updated: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

function task(patch: Partial<Task>): Task {
  return { id: crypto.randomUUID(), title: "Task", done: false, created: "2026-07-01T00:00:00.000Z", ...patch };
}

function slice(patch: Partial<BriefStateSlice> = {}): BriefStateSlice {
  return {
    tasks: [],
    tracker: [],
    logs: [],
    boardPrep: {} as NoctyriumState["boardPrep"],
    activeDayKey: TODAY,
    sessions: [],
    closeouts: [],
    questions: [],
    ankiCards: [],
    ...patch,
  };
}

function signals(patch: Partial<BriefSignals> = {}): BriefSignals {
  return {
    daysSinceLastStudy: 0, missedDaysLast7: 0, overdueTasks: 0, carriedTasks: 0, openTasks: 0,
    backlogScore: 0, examDaysAway: null, reviewFlagged: 0, dueQuestionCount: 0, dueCardCount: 0,
    yesterdayMinutes: 60, todayMinutes: 0,
    ...patch,
  };
}

function evidenceState(patch: Partial<BriefEvidenceState> = {}): BriefEvidenceState {
  return {
    courses: [],
    tracker: [],
    logs: [],
    tasks: [],
    questions: [],
    documents: [],
    questionSets: [],
    activeDayKey: TODAY,
    dayPlans: [],
    sessions: [],
    ...patch,
  };
}

function question(patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: crypto.randomUUID(),
    source: "manual",
    stem: "Which option is supported?",
    options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
    correctKey: "B",
    status: "unseen",
    tags: [],
    attempts: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

function dailyTarget(patch: {
  id?: string;
  label?: string;
  current?: number;
  target?: number;
  status?: "awaiting" | "in-progress" | "met" | "not-eligible";
  eligible?: boolean;
  unit?: string;
  weight?: number;
  source?: DailySuccessResult["requirements"][number]["requirement"]["source"];
} = {}): DailySuccessResult {
  const current = patch.current ?? 0;
  const target = patch.target ?? 30;
  const status = patch.status ?? (current > 0 ? "in-progress" : "awaiting");
  const eligible = patch.eligible ?? status !== "not-eligible";
  const id = patch.id ?? "target";
  const unit = patch.unit ?? "minutes";
  return {
    mode: "configured",
    dayKey: TODAY,
    requirements: [{
      requirement: {
        id,
        label: patch.label ?? "Focused study",
        enabled: true,
        source: patch.source ?? { kind: "study-minutes" },
        weight: patch.weight ?? 1,
        target,
        unit,
        schedule: { kind: "daily" },
        trackingStartsAt: TODAY,
        createdAt: `${TODAY}T08:00:00.000Z`,
        updatedAt: `${TODAY}T08:00:00.000Z`,
      },
      eligible,
      current,
      target,
      ratio: Math.min(1, current / target),
      status,
      sourceLabel: "Study activity",
      sourceRecordIds: [],
      contributions: [],
      calculation: `${current} of ${target} ${unit}`,
    }],
    eligibleCount: eligible ? 1 : 0,
    metCount: status === "met" ? 1 : 0,
    progress: Math.round(Math.min(1, current / target) * 100),
    status: status === "met" ? "met" : current > 0 ? "in-progress" : "neutral",
    statusLabel: status === "met" ? "Daily requirements met" : "In progress",
  };
}

function habit(patch: Partial<Habit> = {}): Habit {
  return {
    id: "habit-1",
    name: "Review anatomy",
    type: "scheduled",
    schedule: [2],
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
    ...patch,
  };
}

function readiness(score: number, grounded = true): ReadinessResult {
  return {
    date: TODAY,
    selfReportedEnergy: {
      score,
      label: score < 45 ? "Low" : score < 75 ? "Medium" : "High",
      source: grounded ? "journal-today" : undefined,
    },
    estimatedReadiness: score,
    readinessLabel: score < 40 ? "Low" : score < 55 ? "Recovering" : score < 78 ? "Ready" : "High",
    baseline: 62,
    totalImpact: score - 62,
    carryoverImpact: 0,
    contributions: [],
    possibleSignals: [],
    primarySignal: grounded ? "Self-reported energy" : "No readiness factors logged yet",
    recommendation: "Use the available evidence.",
  };
}

describe("mode derivation (transparent rules)", () => {
  it("stable workload with no backlog → Maintain", () => {
    expect(deriveMode(signals()).mode).toBe("maintain");
  });

  it("exam within 3 days → Exam Week regardless of backlog", () => {
    expect(deriveMode(signals({ examDaysAway: 2 })).mode).toBe("exam-week");
    expect(deriveMode(signals({ examDaysAway: 2, backlogScore: 80 })).mode).toBe("exam-week");
  });

  it("exam within 7 days plus backlog → Sprint", () => {
    expect(deriveMode(signals({ examDaysAway: 6, backlogScore: 40 })).mode).toBe("sprint");
  });

  it("exam within 7 days without backlog stays Maintain-ish, not Sprint", () => {
    expect(deriveMode(signals({ examDaysAway: 6, backlogScore: 5 })).mode).toBe("maintain");
  });

  it("multiple missed study days plus unfinished work → Recovery", () => {
    expect(deriveMode(signals({ daysSinceLastStudy: 4 })).mode).toBe("recovery");
    expect(deriveMode(signals({ missedDaysLast7: 4, backlogScore: 45 })).mode).toBe("recovery");
  });

  it("behind but with time → Catch-Up", () => {
    expect(deriveMode(signals({ overdueTasks: 3, backlogScore: 36 })).mode).toBe("catch-up");
  });

  it("a closeout mode preference overrides the rules", () => {
    const result = deriveMode(signals({ daysSinceLastStudy: 5 }), "maintain");
    expect(result.mode).toBe("maintain");
    expect(result.reason).toMatch(/closeout/i);
  });

  it("every mode ships a plain-language reason", () => {
    for (const s of [signals(), signals({ examDaysAway: 1 }), signals({ daysSinceLastStudy: 4 })]) {
      expect(deriveMode(s).reason.length).toBeGreaterThan(20);
    }
  });
});

describe("next best move priority", () => {
  it("picks exactly one move and explains it", () => {
    const s = slice({
      tracker: [
        tracker({ label: "Untouched high-yield", yield: "high", passes: 0 }),
        tracker({ label: "Needs review", yield: "review", passes: 1 }),
      ],
    });
    const move = deriveNextBestMove(s, "maintain", deriveSignals(s));
    expect(move.title).toContain("Untouched high-yield"); // first exposure can outrank an additional pass
    expect(move.reason.length).toBeGreaterThan(10);
    expect(move.expectedOutcome.length).toBeGreaterThan(10);
    expect(move.estimatedMinutes).toBeGreaterThan(0);
  });

  it("exam week with a due question backlog points at question rework", () => {
    const dueQuestion = (id: string) => ({
      id, source: "manual" as const, stem: "q", options: [{ key: "A", text: "x" }, { key: "B", text: "y" }], correctKey: "B", status: "incorrect" as const,
      tags: [], attempts: [], reviewDueAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const s = slice({ questions: Array.from({ length: 6 }, (_, i) => dueQuestion(String(i))) });
    const move = deriveNextBestMove(s, "exam-week", deriveSignals(s));
    expect(move.link.kind).toBe("question-set");
  });

  it("never ranks starter or template rows", () => {
    const seed = makeSeed();
    const ranked = rankCommandBriefCandidates(slice({
      tasks: seed.tasks,
      tracker: seed.tracker,
    }), "maintain", new Date(`${TODAY}T08:00:00Z`));

    expect(ranked).toEqual([]);
  });

  it("uses a stable tie-break and exposes weights that sum to the score", () => {
    const s = slice({
      tasks: [
        task({ id: "task-z", title: "Z task", created: `${TODAY}T08:00:00Z` }),
        task({ id: "task-a", title: "A task", created: `${TODAY}T08:00:00Z` }),
      ],
    });
    const first = rankCommandBriefCandidates(s, "maintain", new Date(`${TODAY}T08:00:00Z`));
    const second = rankCommandBriefCandidates(s, "maintain", new Date(`${TODAY}T08:00:00Z`));

    expect(first.map((candidate) => candidate.candidateId)).toEqual(["task:task-a", "task:task-z"]);
    expect(second).toEqual(first);
    for (const candidate of first) {
      expect(candidate.contributions.reduce((sum, item) => sum + item.weight, 0)).toBe(candidate.score);
    }
  });

  it("prioritizes a one-day overdue task over an untouched high-yield item", () => {
    const ranked = rankCommandBriefCandidates(slice({
      tasks: [task({ id: "due", title: "Submit renal worksheet", due: "2026-07-06" })],
      tracker: [tracker({ id: "high", label: "High-yield lecture", yield: "high", passes: 0 })],
    }), "maintain", new Date(`${TODAY}T08:00:00Z`));

    expect(ranked[0].candidateId).toBe("task:due");
  });

  it("does not turn an unsupported closeout phrase into a recommendation", () => {
    const s = slice({
      tasks: [task({ id: "real", title: "Review renal notes" })],
      closeouts: [{
        id: "co", dayKey: "2026-07-06", completedSummary: "x", tomorrowFirstTask: "Imaginary task",
        tomorrowMode: "auto", createdAt: "2026-07-06T21:00:00.000Z", updatedAt: "2026-07-06T21:00:00.000Z",
      }],
    });

    const brief = buildCommandBrief(s, new Date(`${TODAY}T08:00:00Z`));
    expect(brief.move.title).toBe("Review renal notes");
    expect(brief.move.contributions?.some((item) => item.id === "commitment")).toBe(false);
  });

  it("falls back to the oldest task, then to setup, when the tracker is empty", () => {
    const withTask = slice({ tasks: [task({ title: "Email the registrar", due: "2026-07-01" })] });
    expect(deriveNextBestMove(withTask, "maintain", deriveSignals(withTask)).title).toBe("Email the registrar");

    const empty = slice();
    const move = deriveNextBestMove(empty, "maintain", deriveSignals(empty));
    expect(move.title).toMatch(/tracker/i);
  });

  it("ranks an unfinished scheduled target and omits completed or off-day targets", () => {
    const unfinished = rankCommandBriefCandidates(slice({
      dailySuccess: dailyTarget({ id: "questions", label: "Practice questions", current: 4, target: 10, unit: "questions" }),
    }), "maintain", new Date(`${TODAY}T08:00:00Z`));

    expect(unfinished[0]).toMatchObject({
      candidateId: "target:questions",
      title: "Complete Practice questions",
      estimatedMinutes: 12,
    });
    expect(unfinished[0].contributions).toContainEqual(expect.objectContaining({
      id: "scheduled-target:questions",
      sourceLabel: "Today’s targets",
    }));

    expect(rankCommandBriefCandidates(slice({
      dailySuccess: dailyTarget({ status: "met", current: 30 }),
    }), "maintain")).toEqual([]);
    expect(rankCommandBriefCandidates(slice({
      dailySuccess: dailyTarget({ status: "not-eligible", eligible: false }),
    }), "maintain")).toEqual([]);
  });

  it("uses the pinned priority, planned time, and grounded low energy without inventing evidence", () => {
    const ranked = rankCommandBriefCandidates(slice({
      tasks: [
        task({ id: "priority", title: "Review renal transport" }),
        task({ id: "other", title: "Organize notes" }),
      ],
      dayPlans: [{
        dayKey: TODAY,
        intention: "Protect one focused block",
        priority: "Review renal transport",
        wins: [],
        expectedStudyMinutes: 20,
        createdAt: `${TODAY}T08:00:00.000Z`,
      }],
      readiness: readiness(35),
    }), "maintain", new Date(`${TODAY}T09:00:00Z`));

    expect(ranked[0].candidateId).toBe("task:priority");
    expect(ranked[0].estimatedMinutes).toBe(20);
    expect(ranked[0].reason).toBe("You pinned this as today’s priority.");
    expect(ranked[0].contributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pinned-priority", weight: 72 }),
      expect.objectContaining({ id: "available-time", sourceLabel: "Daily Check-In" }),
      expect.objectContaining({ id: "readiness-context", label: "Adjusted for reported readiness (35/100)" }),
    ]));
    expect(ranked[0].contributions.reduce((sum, item) => sum + item.weight, 0)).toBe(ranked[0].score);
  });

  it("does not let the neutral readiness baseline alter ranking or effort", () => {
    const [candidate] = rankCommandBriefCandidates(slice({
      tasks: [task({ id: "task", title: "Review renal transport" })],
      readiness: readiness(35, false),
    }), "maintain", new Date(`${TODAY}T09:00:00Z`));

    expect(candidate.estimatedMinutes).toBe(45);
    expect(candidate.contributions.some((item) => item.id === "readiness-context")).toBe(false);
  });

  it("keeps an active linked focus session ahead of a competing task and estimates remaining effort", () => {
    const ranked = rankCommandBriefCandidates(slice({
      tasks: [
        task({ id: "active", title: "Review renal transport" }),
        task({ id: "late", title: "Submit worksheet", due: "2026-07-06" }),
      ],
      sessions: [{
        id: "session",
        title: "Review renal transport",
        link: { kind: "task", id: "active", label: "Review renal transport" },
        plannedMinutes: 30,
        segments: [{ startedAt: `${TODAY}T08:50:00.000Z` }],
        status: "active",
        quickLogs: [],
        source: "manual",
        dayKey: TODAY,
        createdAt: `${TODAY}T08:50:00.000Z`,
      }],
    }), "maintain", new Date(`${TODAY}T09:00:00.000Z`));

    expect(ranked[0].candidateId).toBe("task:active");
    expect(ranked[0].estimatedMinutes).toBe(20);
    expect(ranked[0].contributions).toContainEqual(expect.objectContaining({ id: "active-session", weight: 95 }));
  });

  it("preserves a free active focus session as a grounded action instead of falling back to setup", () => {
    const ranked = rankCommandBriefCandidates(slice({
      sessions: [{
        id: "free-session",
        title: "Outline renal mechanisms",
        link: { kind: "free", label: "Renal outline" },
        plannedMinutes: 25,
        segments: [{ startedAt: `${TODAY}T08:55:00.000Z` }],
        status: "active",
        quickLogs: [],
        source: "manual",
        dayKey: TODAY,
        createdAt: `${TODAY}T08:55:00.000Z`,
      }],
    }), "maintain", new Date(`${TODAY}T09:00:00.000Z`));

    expect(ranked[0]).toMatchObject({
      candidateId: "session:free-session",
      title: "Continue Outline renal mechanisms",
      estimatedMinutes: 20,
      reason: "This is the focus session already in progress.",
    });
  });

  it("ranks only genuinely due recurring habits and avoids a second candidate for a linked target", () => {
    const due = habit();
    const done = habit({ id: "done", name: "Hydrate" });
    const weekly = habit({ id: "weekly", name: "Weekly review", type: "weekly", schedule: undefined, weeklyTarget: 3 });
    const offDay = habit({ id: "off-day", name: "Monday planning", schedule: [1] });
    const future = habit({ id: "future", name: "Future habit", trackingStartsAt: "2026-07-08" });
    const ranked = rankCommandBriefCandidates(slice({
      habits: [due, done, weekly, offDay, future],
      habitEntries: [{
        id: "done-entry", habitId: "done", date: TODAY, status: "done", createdAt: `${TODAY}T09:00:00.000Z`,
      }],
    }), "maintain");

    expect(ranked.map((candidate) => candidate.candidateId)).toEqual(["habit:habit-1"]);

    const linked = rankCommandBriefCandidates(slice({
      habits: [due],
      habitEntries: [],
      dailySuccess: dailyTarget({
        id: "habit-target",
        label: due.name,
        target: 1,
        unit: "times",
        source: { kind: "habit", habitId: due.id },
      }),
    }), "maintain");
    expect(linked.map((candidate) => candidate.candidateId)).toEqual(["target:habit-target"]);
  });

  it("uses only a repeated grounded defer/block pattern as avoidance evidence", () => {
    const blockedSession = (id: string, dayKey: string, log: "blocked" | "rescheduled") => ({
      id,
      title: "Review renal transport",
      link: { kind: "task" as const, id: "task", label: "Review renal transport" },
      segments: [],
      status: "completed" as const,
      quickLogs: [{ at: `${dayKey}T10:00:00.000Z`, log }],
      source: "manual" as const,
      dayKey,
      createdAt: `${dayKey}T09:00:00.000Z`,
    });
    const ranked = rankCommandBriefCandidates(slice({
      tasks: [task({ id: "task", title: "Review renal transport" })],
      sessions: [
        blockedSession("one", "2026-07-04", "blocked"),
        blockedSession("two", "2026-07-06", "rescheduled"),
      ],
    }), "maintain", new Date(`${TODAY}T09:00:00.000Z`));

    expect(ranked[0].contributions).toContainEqual(expect.objectContaining({
      id: "recent-avoidance",
      label: "Deferred or blocked 2 times recently",
    }));
  });
});

describe("minimum viable win", () => {
  it("prefers due cards, then due questions, then a fragile skim, then one sentence", () => {
    const dueCard: AnkiCard = {
      id: "c1", type: "basic", front: "f", back: "b", tags: [], aiGenerated: false,
      schedule: { ...newSchedule(new Date("2026-07-01")), dueAt: "2026-07-01T00:00:00.000Z" },
      createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    };
    const withCards = slice({ ankiCards: [dueCard] });
    expect(deriveMinimumViableWin(withCards, deriveSignals(withCards)).title).toMatch(/card/i);

    const bare = slice();
    expect(deriveMinimumViableWin(bare, deriveSignals(bare)).title).toMatch(/one sentence/i);
  });
});

describe("full brief assembly", () => {
  it("does not invent missed-study history in a fresh workspace", () => {
    const result = deriveSignals(slice());
    expect(result.daysSinceLastStudy).toBe(0);
    expect(result.missedDaysLast7).toBe(0);
    expect(detectMode(result)).not.toBe("recovery");
  });

  it("does not call earlier blank dates missed when the first activity is today", () => {
    const result = deriveSignals(slice({
      logs: [{ id: "first", dayKey: TODAY, ts: `${TODAY}T09:00:00Z`, type: "Study", minutes: 30, cards: 0, academic: true, productive: true }],
    }));
    expect(result.daysSinceLastStudy).toBe(0);
    expect(result.missedDaysLast7).toBe(0);
    expect(deriveMode(result).mode).toBe("maintain");
  });

  it("honors yesterday's closeout first-task commitment", () => {
    const s = slice({
      tracker: [tracker({ label: "Renal physiology", yield: "high" })],
      closeouts: [{
        id: "co", dayKey: "2026-07-06", completedSummary: "x", tomorrowFirstTask: "Renal physiology",
        tomorrowMode: "auto", createdAt: "2026-07-06T21:00:00.000Z", updatedAt: "2026-07-06T21:00:00.000Z",
      }],
    });
    const brief = buildCommandBrief(s, new Date(`${TODAY}T08:00:00`));
    expect(brief.move.contributions).toContainEqual(expect.objectContaining({ id: "commitment", sourceLabel: "Yesterday’s closeout" }));
    expect(brief.move.link.kind).toBe("tracker");
    expect(brief.generatedFor).toBe(TODAY);
    expect(brief.source).toBe("rules");
  });

  it("flags recovery when the signals warrant it", () => {
    const s = slice({
      tasks: [task({ due: "2026-07-01" }), task({ due: "2026-07-02" }), task({ due: "2026-07-03" })],
    });
    const brief = buildCommandBrief(s, new Date(`${TODAY}T08:00:00`));
    // Overdue work still produces catch-up without inventing study history.
    expect(brief.signals.overdueTasks).toBe(3);
    expect(["recovery", "catch-up"]).toContain(brief.mode);
  });

  it("does not create catch-up or recovery pressure from seed records", () => {
    const seed = makeSeed();
    const result = deriveSignals(slice({ tasks: seed.tasks, tracker: seed.tracker }));
    expect(result.overdueTasks).toBe(0);
    expect(result.reviewFlagged).toBe(0);
    expect(result.backlogScore).toBe(0);
    expect(deriveMode(result).mode).toBe("maintain");
  });
});

function detectMode(value: BriefSignals) {
  return deriveMode(value).mode;
}

describe("Command Brief evidence readiness", () => {
  it("excludes every canonical seed course, example tracker row, and starter task", () => {
    const seed = makeSeed();
    const evidence = assessCommandBriefEvidence(evidenceState({
      courses: seed.courses,
      tracker: seed.tracker,
      logs: seed.logs,
      tasks: seed.tasks,
      questions: seed.questions,
      documents: seed.documents,
      questionSets: seed.questionSets,
    }));

    expect(evidence.ready).toBe(false);
    expect(evidence.confidence).toBe("none");
    expect(evidence.canActivateManually).toBe(false);
    expect(evidence.workload.count).toBe(0);
    expect(evidence.activeItems.count).toBe(0);
    expect(evidence.activity.count).toBe(0);
    expect(evidence.rankedEvidence).toEqual([]);
    expect(evidence.starter?.id).toBe("empty");
  });

  it("recognises one manually added tracker item and offers an honest limited-confidence activation", () => {
    const state = evidenceState({
      tracker: [tracker({ id: "real-1", path: "Renal/Week 1", label: "Glomerular physiology", passes: 0 })],
    });
    const evidence = assessCommandBriefEvidence(state);

    expect(evidence.workload.count).toBe(1);
    expect(evidence.activeItems.ready).toBe(true);
    expect(evidence.actionableCount).toBe(1);
    expect(evidence.activity.ready).toBe(false);
    expect(evidence.ready).toBe(false);
    expect(evidence.confidence).toBe("limited");
    expect(evidence.canActivateManually).toBe(true);
    expect(evidence.starter).toMatchObject({ id: "limited-action", destination: "tracker" });

    const activated = assessCommandBriefEvidence(state, { manualActivation: true });
    expect(activated.ready).toBe(true);
    expect(activated.activation).toBe("manual");
    expect(activated.confidence).toBe("limited");
    expect(activated.starter).toBeNull();
  });

  it("automatically activates from two independently actionable records without an opaque activity gate", () => {
    const evidence = assessCommandBriefEvidence(evidenceState({
      courses: [{ id: "course-real", termId: "term-real", code: "CARD", name: "Cardiology", files: 0, modules: [] }],
      tracker: [
        tracker({ id: "real-1", path: "Cardiology/Lectures", label: "Heart failure", passes: 0 }),
        tracker({ id: "real-2", path: "Cardiology/PQs", label: "Cardiology questions", kind: "PQ", passes: 0 }),
      ],
    }));

    expect(evidence.ready).toBe(true);
    expect(evidence.activation).toBe("automatic");
    expect(evidence.confidence).toBe("strong");
    expect(evidence.workload.count).toBe(3);
    expect(evidence.actionableCount).toBe(2);
    expect(evidence.currentSignalCount).toBe(0);
  });

  it("treats progress beyond a template baseline as meaningful without preserving the old two-tracker-row rule", () => {
    const seed = makeSeed();
    const progressed = seed.tracker.slice(0, 2).map((item) => ({ ...item, passes: item.passes + 1 }));
    const evidence = assessCommandBriefEvidence(evidenceState({
      courses: seed.courses,
      tracker: progressed,
      logs: [],
      tasks: [{ id: "user-task", title: "Review renal notes", done: false, created: `${TODAY}T08:00:00.000Z` }],
      questions: [],
      documents: [{
        id: "source-1", title: "Renal notes", fileName: "renal.pdf", fileType: "application/pdf",
        uploadedAt: `${TODAY}T08:00:00.000Z`, rawText: "", sizeBytes: 100, tags: [], linkedQuestionSetIds: [], libraryOnly: true,
      }],
      questionSets: [],
    }));

    expect(evidence.workload.ready).toBe(true);
    expect(evidence.actionableCount).toBe(3);
    expect(evidence.activity.ready).toBe(false);
    expect(evidence.ready).toBe(true);
  });

  it("uses only same-day activity, intention, timer, and practice as current context", () => {
    const realTask = task({ id: "today-task", title: "Review renal physiology" });
    const oldOnly = assessCommandBriefEvidence(evidenceState({
      tasks: [realTask],
      logs: [{
        id: "old", dayKey: "2026-07-06", ts: "2026-07-06T09:00:00.000Z", type: "Study",
        minutes: 60, cards: 0, academic: true, productive: true,
      }],
    }));
    expect(oldOnly.currentSignalCount).toBe(0);
    expect(oldOnly.ready).toBe(false);

    const current = assessCommandBriefEvidence(evidenceState({
      tasks: [realTask],
      logs: [{
        id: "today", dayKey: TODAY, ts: `${TODAY}T09:00:00.000Z`, type: "Study",
        minutes: 30, cards: 0, academic: true, productive: true,
      }],
      dayPlans: [{
        dayKey: TODAY, intention: "Finish renal review", wins: [], createdAt: `${TODAY}T08:00:00.000Z`,
      }],
      sessions: [{
        id: "session", title: "Renal block", link: { kind: "task", id: realTask.id, label: realTask.title },
        segments: [{ startedAt: `${TODAY}T10:00:00.000Z` }], status: "active", quickLogs: [],
        source: "manual", dayKey: TODAY, createdAt: `${TODAY}T10:00:00.000Z`,
      }],
      questions: [question({
        id: "practice", attemptedAt: `${TODAY}T11:00:00.000Z`,
        attempts: [{ at: `${TODAY}T11:00:00.000Z`, answerKey: "B", status: "correct" }],
      })],
    }));

    expect(current.currentSignalCount).toBe(4);
    expect(current.ready).toBe(true);
    expect(current.rankedEvidence.map((item) => item.id)).toEqual(expect.arrayContaining([
      "activity-log", "day-intention", "focus-session", "question-practice",
    ]));
  });

  it("treats scheduled targets and due habits as actions, with grounded readiness only as context", () => {
    const targetOnly = assessCommandBriefEvidence(evidenceState({
      dailySuccess: dailyTarget({ id: "focus", label: "Focused study" }),
    }));
    expect(targetOnly).toMatchObject({
      ready: false,
      confidence: "limited",
      actionableCount: 1,
      currentSignalCount: 0,
    });
    expect(targetOnly.rankedEvidence).toContainEqual(expect.objectContaining({ id: "scheduled-targets", count: 1 }));
    expect(targetOnly.starter).toMatchObject({ id: "limited-action", destination: "productivity" });

    const grounded = assessCommandBriefEvidence(evidenceState({
      dailySuccess: dailyTarget({ id: "focus", label: "Focused study" }),
      readiness: readiness(35),
    }));
    expect(grounded).toMatchObject({ ready: true, actionableCount: 1, currentSignalCount: 1 });
    expect(grounded.rankedEvidence).toContainEqual(expect.objectContaining({ id: "readiness", count: 1 }));

    const neutral = assessCommandBriefEvidence(evidenceState({
      dailySuccess: dailyTarget({ id: "focus", label: "Focused study" }),
      readiness: readiness(35, false),
    }));
    expect(neutral).toMatchObject({ ready: false, currentSignalCount: 0 });

    const habits = assessCommandBriefEvidence(evidenceState({ habits: [habit()] }));
    expect(habits).toMatchObject({ actionableCount: 1, confidence: "limited" });
    expect(habits.rankedEvidence).toContainEqual(expect.objectContaining({ id: "due-habits", count: 1 }));
  });

  it("counts a planned time block as same-day context while a completed plan does not qualify", () => {
    const realTask = task({ id: "today-task", title: "Review renal physiology" });
    const planned = assessCommandBriefEvidence(evidenceState({
      tasks: [realTask],
      dayPlans: [{
        dayKey: TODAY,
        intention: "",
        wins: [],
        expectedStudyMinutes: 25,
        createdAt: `${TODAY}T08:00:00.000Z`,
      }],
    }));
    expect(planned).toMatchObject({ ready: true, actionableCount: 1, currentSignalCount: 1 });

    const completed = assessCommandBriefEvidence(evidenceState({
      tasks: [realTask],
      dayPlans: [{
        dayKey: TODAY,
        intention: "Review renal physiology",
        wins: [],
        outcome: "won",
        createdAt: `${TODAY}T08:00:00.000Z`,
      }],
    }));
    expect(completed).toMatchObject({ ready: false, actionableCount: 1, currentSignalCount: 0 });
  });

  it("counts only trusted due questions as actionable while retaining current practice as context", () => {
    const dueAt = "2026-07-01T00:00:00.000Z";
    const ready = question({
      id: "ready", reviewDueAt: dueAt, attemptedAt: `${TODAY}T09:00:00.000Z`,
      attempts: [{ at: `${TODAY}T09:00:00.000Z`, answerKey: "B", status: "incorrect" }],
    });
    const unresolved = question({ id: "unresolved", correctKey: undefined, reviewDueAt: dueAt, needsReview: true });
    const evidence = assessCommandBriefEvidence(evidenceState({ questions: [unresolved, ready] }), {
      now: new Date(`${TODAY}T12:00:00.000Z`),
    });

    expect(evidence.actionableCount).toBe(1);
    expect(evidence.currentSignalCount).toBe(1);
    expect(evidence.ready).toBe(true);
    expect(evidence.rankedEvidence).toContainEqual(expect.objectContaining({ id: "due-questions", count: 1 }));
  });

  it("provides deterministic starter guidance for imports and courses that do not yet contain rankable work", () => {
    const imported = assessCommandBriefEvidence(evidenceState({
      documents: [{
        id: "source-1", title: "Renal notes", fileName: "renal.pdf", fileType: "application/pdf",
        uploadedAt: `${TODAY}T08:00:00.000Z`, rawText: "", sizeBytes: 100, tags: [], linkedQuestionSetIds: [], libraryOnly: true,
      }],
    }));
    expect(imported.ready).toBe(false);
    expect(imported.canActivateManually).toBe(true);
    expect(imported.starter).toMatchObject({ id: "source-needs-review", destination: "questions" });
    expect(assessCommandBriefEvidence(evidenceState({ documents: importedDocument() }), { manualActivation: true })).toMatchObject({
      ready: true,
      activation: "manual",
      confidence: "limited",
    });

    const courseOnly = assessCommandBriefEvidence(evidenceState({
      courses: [{ id: "course", termId: "term", code: "REN", name: "Renal", files: 0, modules: [] }],
    }));
    expect(courseOnly.starter).toMatchObject({ id: "course-needs-items", destination: "tracker" });

    const seed = makeSeed();
    const importedTemplateCourse = { ...seed.courses[0], origin: "import" as const };
    const importedCourse = assessCommandBriefEvidence(evidenceState({ courses: [importedTemplateCourse] }));
    expect(importedCourse.workload.count).toBe(1);
    expect(importedCourse.starter?.id).toBe("course-needs-items");
  });

  it("allows an explicit limited brief from every user-backed evidence family", () => {
    const cases: Array<[string, BriefEvidenceState]> = [
      ["activity", evidenceState({ logs: [{
        id: "log", dayKey: TODAY, ts: `${TODAY}T09:00:00.000Z`, type: "Exercise",
        minutes: 20, cards: 0, academic: false, productive: true,
      }] })],
      ["intention", evidenceState({ dayPlans: [{
        dayKey: TODAY, intention: "Choose a renal review target", wins: [], createdAt: `${TODAY}T08:00:00.000Z`,
      }] })],
      ["question", evidenceState({ questions: [question({ correctKey: undefined, needsReview: true })] })],
    ];

    for (const [label, state] of cases) {
      const learning = assessCommandBriefEvidence(state);
      expect(learning.canActivateManually, label).toBe(true);
      expect(learning.confidence, label).toBe("limited");
      expect(assessCommandBriefEvidence(state, { manualActivation: true }), label).toMatchObject({
        ready: true,
        activation: "manual",
        confidence: "limited",
      });
    }
  });

  it("is deterministic after JSON hydration and independent of input ordering", () => {
    const original = evidenceState({
      tasks: [task({ id: "b", title: "B" }), task({ id: "a", title: "A" })],
      tracker: [tracker({ id: "tracker", path: "Renal/Week 1", label: "Renal transport" })],
      logs: [{
        id: "today", dayKey: TODAY, ts: `${TODAY}T09:00:00.000Z`, type: "Study",
        minutes: 30, cards: 0, academic: true, productive: true,
      }],
    });
    const reversed = { ...original, tasks: [...original.tasks].reverse(), tracker: [...original.tracker].reverse() };
    const hydrated = JSON.parse(JSON.stringify(original)) as BriefEvidenceState;

    const first = assessCommandBriefEvidence(original, { now: new Date(`${TODAY}T12:00:00.000Z`) });
    const second = assessCommandBriefEvidence(reversed, { now: new Date(`${TODAY}T12:00:00.000Z`) });
    const third = assessCommandBriefEvidence(hydrated, { now: new Date(`${TODAY}T12:00:00.000Z`) });

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.rankedEvidence.map((item) => item.id)).toEqual([
      "open-tasks", "active-tracker", "activity-log",
    ]);
  });

  it("never lets an empty or seed-only workspace bypass learning mode manually", () => {
    const empty = assessCommandBriefEvidence(evidenceState(), { manualActivation: true });
    expect(empty).toMatchObject({ ready: false, activation: "learning", confidence: "none", canActivateManually: false });
    expect(empty.manualActivationReason).toMatch(/add real work/i);
  });
});

function importedDocument(): BriefEvidenceState["documents"] {
  return [{
    id: "source-1", title: "Renal notes", fileName: "renal.pdf", fileType: "application/pdf",
    uploadedAt: `${TODAY}T08:00:00.000Z`, rawText: "", sizeBytes: 100, tags: [], linkedQuestionSetIds: [], libraryOnly: true,
  }];
}
