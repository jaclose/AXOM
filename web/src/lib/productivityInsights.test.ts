import { describe, expect, it } from "vitest";
import { makeDailyRequirement } from "./dailySuccess";
import { makeSeed } from "./seed";
import { formatStudyMinutes, productivityInsight, recordedActivityEvidence } from "./productivityInsights";

describe("productivity projections", () => {
  it("formats elapsed minutes without rounding the hour", () => {
    expect(formatStudyMinutes(157)).toBe("2h 37m");
  });
  it("prioritizes an actual save failure over the running timer", () => {
    expect(productivityInsight(makeSeed(), true, true).title).toBe("Check your save");
    expect(productivityInsight(makeSeed(), false, true).title).toBe("Your focus session is running");
  });
  it("plans a weekly target on another day once today is recorded", () => {
    const state = makeSeed();
    state.activeDayKey = "2026-07-13";
    const requirement = makeDailyRequirement({ id: "q", label: "Questions", source: { kind: "practice-questions" }, target: 10, unit: "questions", trackingStartsAt: "2026-07-13", schedule: { kind: "times-per-week", times: 3, weekStartsOn: 1 } }, state.activeDayKey);
    state.profile.dailySuccess = { version: 1, configuredAt: state.activeDayKey, requirements: [requirement] };
    state.logs = [{ id: "qbank-session:1", dayKey: state.activeDayKey, ts: "2026-07-13T12:00:00Z", type: "Question Bank", minutes: 0, cards: 0, quantity: 10, quantityKind: "questions" }];
    expect(productivityInsight(state, false, false).title).toBe("Plan another day");
  });
  it("flags only today's unlinked finished question sessions", () => {
    const state = makeSeed();
    state.activeDayKey = "2026-07-13";
    const session = { id: "quiz", mode: "tutor" as const, timed: false, filters: { count: 1, status: "all" as const }, startedAt: "2026-07-12T12:00:00", endedAt: "2026-07-12T12:30:00", questionIds: ["q"], answers: [{ questionId: "q", answerKey: "A", flagged: false }] };
    state.quizSessions = [session];
    expect(productivityInsight(state, false, true).title).toBe("Your focus session is running");
    state.quizSessions = [{ ...session, endedAt: "2026-07-13T12:30:00" }];
    expect(productivityInsight(state, false, true).href).toBe("#activity");
    state.logs = [{ id: "qbank-session:quiz", dayKey: state.activeDayKey, ts: "2026-07-13T12:30:00", type: "Question Bank", minutes: 0, cards: 0 }];
    expect(productivityInsight(state, false, true).title).toBe("Your focus session is running");
  });
  it("reports dated card and tracker records as separate evidence", () => {
    const state = makeSeed();
    state.cardReviews = [{ id: "review", cardId: "card", at: "2026-07-13T12:00:00", rating: "good" }];
    state.tracker = [{ ...state.tracker[0], passEvents: [{ id: "pass", method: "anki", at: "2026-07-13T12:00:00" }] }];
    expect(recordedActivityEvidence(state, "2026-07-13")).toEqual({ cardReviews: 1, trackerPasses: 1 });
    expect(recordedActivityEvidence(state, "2026-07-14")).toEqual({ cardReviews: 0, trackerPasses: 0 });
  });
  it("resolves repeated evidence identities before choosing the local date", () => {
    const state = makeSeed();
    state.cardReviews = [
      { id: "review", cardId: "card", at: "2026-07-13T12:00:00", rating: "good" },
      { id: "review", cardId: "card", at: "2026-07-14T12:00:00", rating: "good" },
      { id: "invalid", cardId: "card", at: "invalid", rating: "good" },
    ];
    state.tracker = [{ ...state.tracker[0], passEvents: [
      { id: "pass", method: "anki", at: "2026-07-13T12:00:00" },
      { id: "pass", method: "anki", at: "2026-07-14T12:00:00" },
    ] }];
    const original = structuredClone({ cardReviews: state.cardReviews, tracker: state.tracker });
    expect(recordedActivityEvidence(state, "2026-07-13")).toEqual({ cardReviews: 0, trackerPasses: 0 });
    expect(recordedActivityEvidence(state, "2026-07-14")).toEqual({ cardReviews: 1, trackerPasses: 1 });
    expect({ cardReviews: state.cardReviews, tracker: state.tracker }).toEqual(original);
  });
});
