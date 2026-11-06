import { describe, expect, it } from "vitest";
import type { AxomState } from "./types";
import {
  dailyWordProtectedStreak,
  dateKeyInTimeZone,
  normalizeStudyStreaks,
  protectedCalendarStreak,
  reachedProductivityGoal,
  reconcileDailyWordStreak,
  reconcileProductivityStreak,
  studyCreditsBalance,
} from "./studyStreaks";

const DAY = "2026-07-12";
const emptyBar = { eligibleCount: 1, progress: 0 };

describe("study streak rewards", () => {
  it("uses the daily bar's 80% threshold, with an eligible scheduled target", () => {
    expect(reachedProductivityGoal({ eligibleCount: 1, progress: 79 })).toBe(false);
    expect(reachedProductivityGoal({ eligibleCount: 1, progress: 80 })).toBe(true);
    expect(reachedProductivityGoal({ eligibleCount: 0, progress: 100 })).toBe(false);
  });

  it("credits a reached day once and adds a bonus after three earned days", () => {
    let ledger = normalizeStudyStreaks(undefined, "2026-07-10");
    for (const day of ["2026-07-10", "2026-07-11", DAY]) {
      ledger = reconcileProductivityStreak(ledger, day, { eligibleCount: 1, progress: 80 }, emptyBar).ledger;
    }
    const again = reconcileProductivityStreak(ledger, DAY, { eligibleCount: 1, progress: 80 }, emptyBar);
    expect(again.creditedToday).toBe(false);
    expect(again.ledger.productivity.creditedDays).toEqual(["2026-07-10", "2026-07-11", DAY]);
    expect(again.ledger.productivity.bonusDays).toEqual([DAY]);
    expect(again.ledger.productivity.freezesLeft).toBe(2);
  });

  it("spends one freeze for one missed day and never turns it into a credit", () => {
    const initial = normalizeStudyStreaks(undefined, "2026-07-10");
    initial.productivity.creditedDays = ["2026-07-10"];
    const first = reconcileProductivityStreak(initial, DAY, emptyBar, emptyBar);
    const repeat = reconcileProductivityStreak(first.ledger, DAY, emptyBar, emptyBar);
    expect(first.frozenDay).toBe("2026-07-11");
    expect(repeat.frozenDay).toBeUndefined();
    expect(repeat.ledger.productivity).toMatchObject({
      creditedDays: ["2026-07-10"],
      frozenDays: ["2026-07-11"],
      bonusDays: [],
      freezesLeft: 1,
    });
    expect(protectedCalendarStreak(repeat.ledger.productivity.creditedDays, repeat.ledger.productivity.frozenDays, DAY)).toBe(1);
  });

  it("allows two isolated freezes while consecutive missed days break a streak", () => {
    expect(protectedCalendarStreak(
      ["2026-07-10", DAY, "2026-07-14"],
      ["2026-07-11", "2026-07-13"],
      "2026-07-14",
    )).toBe(3);
    expect(protectedCalendarStreak(
      ["2026-07-10", "2026-07-13"],
      ["2026-07-11", DAY],
      "2026-07-13",
    )).toBe(1);
    const initial = normalizeStudyStreaks(undefined, "2026-07-10");
    initial.productivity.creditedDays = ["2026-07-10"];
    const late = reconcileProductivityStreak(initial, "2026-07-13", emptyBar, emptyBar);
    expect(late.frozenDay).toBeUndefined();
    expect(late.ledger.productivity.freezesLeft).toBe(2);
  });

  it("refills one spent study freeze after two new earned streak days, once", () => {
    let ledger = normalizeStudyStreaks(undefined, "2026-07-10");
    ledger.productivity.freezesLeft = 1;
    ledger = reconcileProductivityStreak(ledger, "2026-07-10", { eligibleCount: 1, progress: 80 }, emptyBar).ledger;
    expect(ledger.productivity).toMatchObject({ freezesLeft: 1, refillProgress: 1 });
    ledger = reconcileProductivityStreak(ledger, "2026-07-11", { eligibleCount: 1, progress: 80 }, { eligibleCount: 1, progress: 80 }).ledger;
    expect(ledger.productivity).toMatchObject({ freezesLeft: 2, refillProgress: 0 });
    const repeated = reconcileProductivityStreak(ledger, "2026-07-11", { eligibleCount: 1, progress: 80 }, { eligibleCount: 1, progress: 80 });
    expect(repeated.ledger).toEqual(ledger);
    expect(studyCreditsBalance({ profile: { studyStreaks: ledger }, sessions: [] } as unknown as Pick<AxomState, "profile" | "sessions">)).toBe(2);
  });

  it("does not count a frozen day as refill progress, but lets later earned days refill", () => {
    let ledger = normalizeStudyStreaks(undefined, "2026-07-10");
    ledger.productivity.creditedDays = ["2026-07-10"];
    ledger.productivity.freezesLeft = 1;
    ledger = reconcileProductivityStreak(ledger, DAY, emptyBar, emptyBar).ledger;
    expect(ledger.productivity).toMatchObject({ frozenDays: ["2026-07-11"], freezesLeft: 0, refillProgress: 0 });
    ledger = reconcileProductivityStreak(ledger, DAY, { eligibleCount: 1, progress: 90 }, emptyBar).ledger;
    expect(ledger.productivity).toMatchObject({ freezesLeft: 0, refillProgress: 1 });
    ledger = reconcileProductivityStreak(ledger, "2026-07-13", { eligibleCount: 1, progress: 80 }, { eligibleCount: 1, progress: 90 }).ledger;
    expect(ledger.productivity).toMatchObject({ freezesLeft: 1, refillProgress: 0 });
  });

  it("separates the selected Daily Word zone from the device calendar", () => {
    const instant = new Date("2026-11-02T01:00:00.000Z");
    expect(dateKeyInTimeZone(instant, "America/Grenada")).toBe("2026-11-01");
    expect(dateKeyInTimeZone(instant, "Asia/Tokyo")).toBe("2026-11-02");
  });

  it("uses one protected Daily Word count across page, dashboard, and sidebar", () => {
    const history = [
      { completed: true, puzzleDate: "2026-07-10" },
      { completed: false, puzzleDate: "2026-07-11" },
      { completed: true, puzzleDate: DAY },
    ];
    const ledger = normalizeStudyStreaks(undefined, "2026-07-10");
    ledger.dailyWord.frozenDays = ["2026-07-11"];
    const count = dailyWordProtectedStreak(history, ledger.dailyWord.frozenDays, DAY);
    expect(count).toBe(2);
    expect(protectedCalendarStreak(["2026-07-10", DAY], ledger.dailyWord.frozenDays, DAY)).toBe(count);
  });

  it("protects an existing Daily Word streak only for one missed date", () => {
    const ledger = normalizeStudyStreaks(undefined, "2026-07-10");
    const first = reconcileDailyWordStreak(ledger, DAY, ["2026-07-10"]);
    const repeated = reconcileDailyWordStreak(first.ledger, DAY, ["2026-07-10"]);
    expect(first.frozenDay).toBe("2026-07-11");
    expect(repeated.frozenDay).toBeUndefined();
    expect(repeated.ledger.dailyWord.freezesLeft).toBe(1);
    const next = reconcileDailyWordStreak(repeated.ledger, "2026-07-13", ["2026-07-10"]);
    expect(next.frozenDay).toBeUndefined();
    expect(next.ledger.dailyWord.freezesLeft).toBe(1);
    const second = reconcileDailyWordStreak(repeated.ledger, "2026-07-14", ["2026-07-10", DAY]);
    expect(second.frozenDay).toBe("2026-07-13");
    expect(second.ledger.dailyWord.freezesLeft).toBe(1);
    expect(dailyWordProtectedStreak([
      { completed: true, puzzleDate: "2026-07-10" },
      { completed: true, puzzleDate: DAY },
      { completed: true, puzzleDate: "2026-07-14" },
    ], second.ledger.dailyWord.frozenDays, "2026-07-14")).toBe(3);
  });

  it("refills Daily Word after two new completed days, without re-awarding a replay", () => {
    let ledger = normalizeStudyStreaks(undefined, "2026-07-10");
    ledger.dailyWord.freezesLeft = 1;
    ledger = reconcileDailyWordStreak(ledger, "2026-07-10", ["2026-07-10"]).ledger;
    expect(ledger.dailyWord).toMatchObject({ freezesLeft: 1, refillProgress: 1, lastRewardedDay: "2026-07-10" });
    ledger = reconcileDailyWordStreak(ledger, "2026-07-11", ["2026-07-10", "2026-07-11"]).ledger;
    expect(ledger.dailyWord).toMatchObject({ freezesLeft: 2, refillProgress: 0, lastRewardedDay: "2026-07-11" });
    expect(reconcileDailyWordStreak(ledger, "2026-07-11", ["2026-07-10", "2026-07-11"]).ledger).toEqual(ledger);
  });

  it("settles a saved Daily Word completion after reopening on the next date", () => {
    let ledger = normalizeStudyStreaks(undefined, "2026-07-10");
    ledger.dailyWord.freezesLeft = 1;
    ledger = reconcileDailyWordStreak(ledger, "2026-07-10", ["2026-07-10"]).ledger;
    const reopened = reconcileDailyWordStreak(ledger, "2026-07-12", ["2026-07-10", "2026-07-11"]);
    expect(reopened.frozenDay).toBeUndefined();
    expect(reopened.ledger.dailyWord).toMatchObject({ freezesLeft: 2, refillProgress: 0, lastRewardedDay: "2026-07-11" });
    const restored = normalizeStudyStreaks(JSON.parse(JSON.stringify(reopened.ledger)), "2026-07-12");
    expect(reconcileDailyWordStreak(restored, "2026-07-12", ["2026-07-10", "2026-07-11"]).ledger).toEqual(restored);
  });

  it("credits a pending Daily Word completion before debiting the next missed day", () => {
    let ledger = normalizeStudyStreaks(undefined, "2026-07-10");
    ledger.dailyWord.freezesLeft = 1;
    ledger = reconcileDailyWordStreak(ledger, "2026-07-10", ["2026-07-10"]).ledger;
    const reopened = reconcileDailyWordStreak(ledger, "2026-07-13", ["2026-07-10", "2026-07-11"]);
    expect(reopened.frozenDay).toBe("2026-07-12");
    expect(reopened.ledger.dailyWord).toMatchObject({ freezesLeft: 1, refillProgress: 0, lastRewardedDay: "2026-07-11", frozenDays: ["2026-07-12"] });
  });

  it("preserves completed-session credits and earns once for a new unique session", () => {
    const ledger = normalizeStudyStreaks(undefined, DAY);
    ledger.productivity.creditedDays = ["2026-07-10", "2026-07-11", DAY];
    ledger.productivity.bonusDays = [DAY];
    const before = {
      profile: { studyStreaks: ledger, journalNotebook: { unlockedStyles: ["copper"] } },
      sessions: [{ id: "old-session", status: "completed" }],
    } as unknown as Pick<AxomState, "profile" | "sessions">;
    expect(studyCreditsBalance(before)).toBe(3);
    const after = {
      ...before,
      sessions: [...before.sessions, { ...before.sessions[0], id: "new-session" }, { ...before.sessions[0], id: "new-session" }],
    } as Pick<AxomState, "profile" | "sessions">;
    expect(studyCreditsBalance(after)).toBe(4);
  });
});
