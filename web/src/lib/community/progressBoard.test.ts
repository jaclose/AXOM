import { describe, expect, it } from "vitest";
import type { CommunityPost } from "./community";
import { addDays, dayProgress, formatBoardValue, progressBoard, shareModeFrom, SHARE_MODE_KEY } from "./progressBoard";
import type { StudyLog } from "../types";

const today = "2026-11-05";
let serial = 0;
function post(user_id: string, activity_day: string, minutes: number, visibility: CommunityPost["visibility"] = "friends", extra: Partial<CommunityPost> = {}): CommunityPost {
  serial++;
  return { id: `p${serial}`, user_id, kind: "progress", visibility, activity_day, minutes, cards: 0, questions: 0,
    set_title: null, caption: "", created_at: `${activity_day}T20:00:00Z`, ...extra };
}
const board = (posts: CommunityPost[], patch: Partial<Parameters<typeof progressBoard>[1]> = {}) =>
  progressBoard(posts, { scope: "friends", metric: "minutes", periodDays: 7, today, me: "me", friendIds: new Set(["ana", "ben"]), ...patch });

describe("progress leaderboards", () => {
  it("keeps the friends board to you and accepted friends, and never counts private days", () => {
    const rows = board([
      post("me", today, 60), post("ana", today, 90), post("stranger", today, 500, "community"),
      post("ben", today, 400, "private"),
    ]);
    expect(rows.map(row => [row.userId, row.minutes, row.rank])).toEqual([["ana", 90, 1], ["me", 60, 2]]);
  });

  it("ranks the community board on days shared with everyone only", () => {
    const rows = board([post("me", today, 60, "friends"), post("ana", today, 30, "community"), post("stranger", today, 45, "community")],
      { scope: "community" });
    expect(rows.map(row => row.userId)).toEqual(["stranger", "ana"]);
  });

  it("sums the chosen period, gives equal values one rank and breaks ties on the other measures", () => {
    const rows = board([
      post("me", today, 30, "friends", { questions: 10 }), post("me", addDays(today, -6), 30),
      post("ana", today, 60, "friends", { questions: 5 }), post("ana", addDays(today, -7), 600),
      post("ben", today, 60, "friends", { questions: 1 }),
    ]);
    expect(rows.map(row => [row.userId, row.minutes, row.rank, row.days])).toEqual([["me", 60, 1, 2], ["ana", 60, 1, 1], ["ben", 60, 1, 1]]);
    expect(board([post("me", today, 1, "friends", { questions: 9 }), post("ana", today, 99, "friends", { questions: 3 })], { metric: "questions" })
      .map(row => row.userId)).toEqual(["me", "ana"]);
    expect(board([post("ana", addDays(today, -7), 600)], { periodDays: 30 })[0].minutes).toBe(600);
  });

  it("reports today's totals and a streak that survives until today closes", () => {
    const [open] = board([post("me", addDays(today, -1), 20), post("me", addDays(today, -2), 20), post("me", addDays(today, -4), 20)]);
    expect(open.today).toBeNull();
    expect(open.streak).toBe(2);
    expect(open.lastDay).toBe(addDays(today, -1));
    const [studied] = board([post("me", today, 25), post("me", addDays(today, -1), 20)]);
    expect(studied.today).toEqual({ minutes: 25, cards: 0, questions: 0 });
    expect(studied.streak).toBe(2);
  });

  it("ignores future days and duplicate rows for one day", () => {
    const rows = board([post("me", addDays(today, 1), 300), post("me", today, 10), post("me", today, 99)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].minutes).toBe(10);
  });
});

describe("daily totals and helpers", () => {
  it("adds only academic logs once each, within the server's limits", () => {
    const log = (patch: Partial<StudyLog>) => ({ id: `l${serial++}`, dayKey: today, minutes: 0, cards: 0, ...patch }) as StudyLog;
    const repeated = log({ minutes: 30, cards: 20 });
    expect(dayProgress([repeated, repeated, log({ minutes: 15, quantityKind: "questions", quantity: 12 }),
      log({ minutes: 500, academic: false }), log({ dayKey: addDays(today, -1), minutes: 60 })], today))
      .toEqual({ minutes: 45, cards: 20, questions: 12 });
    expect(dayProgress([log({ minutes: 5000, cards: 90000 })], today)).toEqual({ minutes: 1440, cards: 20000, questions: 0 });
  });

  it("reads the sharing choice from account metadata and defaults to off", () => {
    expect(shareModeFrom({ [SHARE_MODE_KEY]: "friends" })).toBe("friends");
    expect(shareModeFrom({ [SHARE_MODE_KEY]: "community" })).toBe("community");
    expect(shareModeFrom({ [SHARE_MODE_KEY]: "everyone" })).toBe("off");
    expect(shareModeFrom(undefined)).toBe("off");
  });

  it("formats values and walks calendar days across month ends", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(formatBoardValue(45, "minutes")).toBe("45 min");
    expect(formatBoardValue(150, "minutes")).toBe("2.5 h");
    expect(formatBoardValue(1, "questions")).toBe("1 question");
    expect(formatBoardValue(1200, "cards")).toBe(`${(1200).toLocaleString()} cards`);
  });
});
