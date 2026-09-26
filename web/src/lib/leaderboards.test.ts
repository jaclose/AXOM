import { describe, expect, it } from "vitest";
import type { StudyLog } from "./types";
import { personalActivityWeeks, rankPersonalWeeks } from "./leaderboards";

const log = (id: string, dayKey: string, minutes = 60, cards = 10, academic = true): StudyLog => ({ id, dayKey, minutes, cards, academic } as StudyLog);
const now = new Date(2026, 8, 22, 12);
describe("personal standings", () => {
  it("uses complete Monday–Sunday periods and separates the current week", () => {
    const weeks = personalActivityWeeks([log("sunday", "2026-09-20"), log("monday", "2026-09-21")], now);
    expect(weeks).toHaveLength(9);
    expect(weeks[0]).toMatchObject({ start: "2026-09-21", end: "2026-09-27", current: true, activeDays: 1 });
    expect(rankPersonalWeeks(weeks, "activeDays")).toMatchObject([{ start: "2026-09-14", rank: 1 }]);
  });
  it("excludes future and nonacademic logs, duplicates, invalid values and empty weeks", () => {
    const entry = log("one", "2026-09-15");
    const weeks = personalActivityWeeks([entry, entry, log("private", "2026-09-16", 90, 30, false), log("future", "2026-09-26"), log("invalid", "2026-09-16", NaN, -3)], now);
    expect(weeks[1]).toMatchObject({ activeDays: 1, minutes: 60, cards: 10 });
    expect(weeks[0].minutes).toBe(0);
    expect(rankPersonalWeeks(weeks, "minutes")).toHaveLength(1);
  });
  it("uses deterministic shared ranks for ties and preserves original totals", () => {
    const weeks = personalActivityWeeks([log("a", "2026-09-15", 60), log("b", "2026-09-08", 60), log("c", "2026-09-01", 30)], now);
    expect(rankPersonalWeeks(weeks, "minutes").map(week => week.rank)).toEqual([1, 1, 3]);
    expect(rankPersonalWeeks(weeks, "minutes").map(week => week.start)).toEqual(["2026-09-14", "2026-09-07", "2026-08-31"]);
    expect(weeks[0].current).toBe(true);
  });
});

describe("race your past self", () => {
  it("compares this week so far with the typical and best completed weeks", async () => {
    const { weekPace, longestActiveStreak, bestDay } = await import("./leaderboards");
    // Wednesday 2026-09-23: three days elapsed.
    const wednesday = new Date(2026, 8, 23, 12);
    const logs = [
      log("t1", "2026-09-21", 120), log("t2", "2026-09-22", 120), log("t3", "2026-09-23", 60),
      log("a1", "2026-09-14", 60), log("a2", "2026-09-15", 60), log("a3", "2026-09-16", 60), log("a4", "2026-09-17", 60),
      log("b1", "2026-09-07", 30), log("b2", "2026-09-08", 30),
    ];
    const pace = weekPace(logs, "minutes", wednesday);
    expect(pace.elapsedDays).toBe(3);
    expect(pace.current).toBe(300);
    expect(pace.typicalSoFar).toBe(120); // (180 + 60) / 2 by Wednesday
    expect(pace.status).toBe("ahead");
    expect(pace.best?.start).toBe("2026-09-14");
    expect(pace.series.you).toEqual([120, 240, 300]);
    expect(pace.projectedRank).toBe(1);
    expect(pace.neededPerDayToBeatBest).toBe(0);
    expect(longestActiveStreak(logs, wednesday)).toBe(4);
    expect(bestDay(logs, "minutes", wednesday)).toEqual({ dayKey: "2026-09-22", value: 120 });
  });

  it("treats a learner without history as setting the baseline", async () => {
    const { weekPace } = await import("./leaderboards");
    const pace = weekPace([log("x", "2026-09-22", 45)], "minutes", new Date(2026, 8, 23, 12));
    expect(pace.status).toBe("no-history");
    expect(pace.best).toBeUndefined();
    expect(pace.neededPerDayToBeatBest).toBeNull();
  });
});

describe("beat-your-best wording", () => {
  it("speaks in days for study days and in amounts for time", async () => {
    const { weekPace } = await import("./leaderboards");
    const { beatYourBestMessage } = await import("../pages/LeaderboardsPage");
    const logs = [log("a1", "2026-09-14", 60), log("a2", "2026-09-15", 60), log("a3", "2026-09-16", 60), log("t1", "2026-09-21", 30)];
    const tuesday = new Date(2026, 8, 22, 12);
    expect(beatYourBestMessage(weekPace(logs, "activeDays", tuesday))?.text).toBe("To beat your best week: study on 3 of the next 6 days.");
    expect(beatYourBestMessage(weekPace(logs, "minutes", tuesday))?.text).toBe("To beat your best week: about 25 min per day for the next 6 days.");
    const sunday = new Date(2026, 8, 27, 12);
    expect(beatYourBestMessage(weekPace(logs, "activeDays", sunday))?.text).toMatch(/out of reach this week/);
  });
});
