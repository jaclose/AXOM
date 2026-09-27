import { describe, expect, it } from "vitest";
import { personalizedSuggestions, rankTrackerItems, trackerStudyAction } from "./recommendationFactors";
import type { TrackerItem } from "./types";

const make = (patch: Partial<TrackerItem>): TrackerItem => ({ id: crypto.randomUUID(), path: "Course", label: "Item", kind: "Lecture", passes: 0, ankiPasses: 0, yield: "none", updated: "2026-08-01T00:00:00Z", ...patch });
const now = new Date("2026-08-08T00:00:00Z");

describe("deterministic recommendation factors", () => {
  it("lets a high-yield untouched lecture outrank an already-covered DLA", () => {
    const lecture = make({ id: "lecture", label: "Renal clearance", yield: "high" });
    const dla = make({ id: "dla", label: "DLA", kind: "DLA", passes: 1, updated: "2026-08-07T20:00:00Z" });
    expect(rankTrackerItems([dla, lecture], { now })[0].item.id).toBe("lecture");
  });

  it("raises a second pass after the learner review window", () => {
    const due = make({ id: "due", passes: 1, updated: "2026-08-03T00:00:00Z" });
    const fresh = make({ id: "fresh", passes: 1, updated: "2026-08-07T12:00:00Z" });
    const ranked = rankTrackerItems([fresh, due], { now, preferences: { configured: true, reviewAfterDays: 3 } });
    expect(ranked[0].item.id).toBe("due");
    expect(ranked[0].factors.some((factor) => factor.id === "review-urgency")).toBe(true);
  });

  it("does not force Anki for a learner who disabled it", () => {
    const suggestions = personalizedSuggestions([make({ id: "x", passes: 2 })], 3, { now, preferences: { configured: true, methods: [{ id: "anki", enabled: false }, { id: "practice-questions", enabled: true }] } });
    expect(suggestions.map((suggestion) => `${suggestion.title} ${suggestion.reason}`).join(" ")).not.toMatch(/anki/i);
  });

  it("returns stable ordering for identical evidence", () => {
    const items = [make({ id: "b" }), make({ id: "a" })];
    expect(rankTrackerItems(items, { now }).map((entry) => entry.item.id)).toEqual(["a", "b"]);
    expect(rankTrackerItems(items, { now }).map((entry) => entry.item.id)).toEqual(["a", "b"]);
  });

  it("uses explicit difficulty and assessment proximity without inventing either", () => {
    const urgent = make({ id: "urgent", difficulty: "hard", assessmentDate: "2026-08-09" });
    const unknown = make({ id: "unknown" });
    const ranked = rankTrackerItems([unknown, urgent], { now });
    expect(ranked[0].item.id).toBe("urgent");
    expect(ranked[0].factors.map((factor) => factor.id)).toEqual(expect.arrayContaining(["difficulty", "assessment-urgency"]));
    expect(ranked[1].factors.map((factor) => factor.id)).not.toContain("difficulty");
  });

  it("temporarily omits snoozed work without deleting it", () => {
    const snoozed = make({ id: "later", recommendationSnoozedUntil: "2026-08-09T08:00:00Z" });
    expect(rankTrackerItems([snoozed], { now })).toEqual([]);
    expect(rankTrackerItems([snoozed], { now: new Date("2026-08-10T00:00:00Z") })[0].item.id).toBe("later");
  });

  it("ranks 2,000 tracker items without pairwise comparison", () => {
    const items = Array.from({ length: 2000 }, (_, index) => make({ id: `item-${index}`, label: `Lecture ${index}`, yield: index % 7 === 0 ? "high" : "none" }));
    const started = performance.now();
    expect(rankTrackerItems(items, { now })).toHaveLength(2000);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("uses the resolved learner pass target to decide completion", () => {
    const item = make({ id: "four-pass", passes: 3 });
    expect(rankTrackerItems([item], { now, preferences: { configured: true, lecturePasses: 4 } })).toHaveLength(1);
    expect(rankTrackerItems([item], { now, preferences: { configured: true, lecturePasses: 3 } })).toHaveLength(0);
  });

  it("distinguishes snoozed unfinished work from completed work without mutating either", () => {
    const item = make({ recommendationSnoozedUntil: "2026-08-09T08:00:00Z" });
    expect(personalizedSuggestions([item], 3, { now })[0].title).toBe("Remaining work is snoozed");
    expect(item.recommendationSnoozedUntil).toBe("2026-08-09T08:00:00Z");
    expect(personalizedSuggestions([{ ...item, passes: 2 }], 3, { now })[0].title).toBe("This scope is complete");
  });

  it("describes enabled methods, custom labels, timing, and the actual next pass", () => {
    const [ranked] = rankTrackerItems([make({ passes: 2 })], { now, preferences: {
      configured: true, lecturePasses: 4, reviewAfterDays: 5,
      methods: [{ id: "anki", enabled: false }, { id: "noji", enabled: true },
        { id: "practice-questions", enabled: true, timing: "after-first-pass" },
        { id: "custom", enabled: true, label: "Whiteboard recall" }],
    } });
    expect(trackerStudyAction(ranked)).toMatchObject({
      resources: ["Noji", "Practice questions (after the first pass)", "Whiteboard recall"],
      expectedOutcome: "Complete pass 3 of 4 in your study plan.",
      summary: "2 of 4 passes complete · Review after 5 days.",
    });
  });

  it("keeps practice and completion targets separate from lecture preferences", () => {
    const ranked = rankTrackerItems([
      make({ id: "practice", kind: "PQ", passes: 1 }),
      make({ id: "requirement", kind: "Requirement" }),
    ], { now, preferences: { configured: true, lecturePasses: 6, methods: [{ id: "anki", enabled: false }] } });
    const practice = ranked.find(({ item }) => item.id === "practice")!;
    const requirement = ranked.find(({ item }) => item.id === "requirement")!;
    expect(practice.target).toBe(3);
    expect(trackerStudyAction(practice).expectedOutcome).toMatch(/round 2 of 3/);
    expect(trackerStudyAction(practice).resources).not.toContain("Anki");
    expect(requirement.target).toBe(1);
    expect(trackerStudyAction(requirement).resources).toEqual([]);
  });
});
