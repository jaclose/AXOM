import { describe, expect, it } from "vitest";
import type { StudyLog } from "../types";
import { dayProgress, sharedWeeklyStandings, type CommunityPost } from "./community";

const log = (id: string, dayKey: string, patch: Partial<StudyLog> = {}): StudyLog => ({
  id, dayKey, ts: dayKey + "T14:00:00Z", type: "Anki", minutes: 20, cards: 30, ...patch,
});
const post = (id: string, user_id: string, activity_day: string, minutes: number,
  patch: Partial<CommunityPost> = {}): CommunityPost => ({
  id, user_id, kind: "progress", visibility: "friends", activity_day,
  minutes, cards: 10, questions: 5, set_title: null, caption: "",
  created_at: activity_day + "T14:00:00Z", ...patch,
});

describe("voluntary community aggregates", () => {
  it("counts only academic logs from the explicitly selected day and deduplicates IDs", () => {
    const logs = [
      log("a","2026-10-24"),
      log("a","2026-10-24"),
      log("b","2026-10-24",{ minutes: 12, cards: 5, quantityKind: "questions", quantity: 17 }),
      log("c","2026-10-24",{ academic: false, minutes: 500, cards: 1000 }),
      log("d","2026-10-23"),
    ];
    expect(dayProgress(logs,"2026-10-24")).toEqual({ minutes:32,cards:35,questions:17 });
    expect(dayProgress(logs,"2026-10-22")).toEqual({ minutes:0,cards:0,questions:0 });
  });
  it("caps malformed local aggregates before preparing a publishable value", () => {
    const logs = [log("large","2026-10-24",{ minutes: 10000,cards:70000,quantityKind:"questions",quantity:90000 })];
    expect(dayProgress(logs,"2026-10-24")).toEqual({ minutes:1440,cards:20000,questions:20000 });
  });
  it("ranks only explicitly shared progress, not Question Set posts or older days", () => {
    const posts = [
      post("1","friend","2026-10-24",120),
      post("2","me","2026-10-23",60),
      post("3","friend","2026-10-20",45),
      post("4","me","2026-10-10",900),
      post("5","friend","2026-10-24",500,{kind:"question_set",activity_day:null,set_title:"My bank"}),
    ];
    expect(sharedWeeklyStandings(posts,"2026-10-24")).toEqual([
      { userId:"friend", minutes:165,cards:20,questions:10,days:2 },
      { userId:"me", minutes:60,cards:10,questions:5,days:1 },
    ]);
  });
});