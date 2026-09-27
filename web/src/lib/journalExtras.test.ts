import { describe, expect, it } from "vitest";
import { buildDayExtraSections, questionAccuracy } from "./journalExtras";
import type { StudySession } from "./sessions";

const DAY = "2026-09-26";
const at = (h: number, m = 0) => new Date(2026, 8, 26, h, m).toISOString();

function session(partial: Partial<StudySession>): StudySession {
  return {
    id: "s1", title: "Renal transport", link: { kind: "free", label: "Free" }, segments: [{ startedAt: at(9), endedAt: at(9, 45) }],
    status: "completed", quickLogs: [], source: "manual", dayKey: DAY, createdAt: at(9), ...partial,
  } as StudySession;
}

describe("journal extras", () => {
  it("records sessions with takeaways, accuracy, listening, rests and check-ins for the day", () => {
    const sections = buildDayExtraSections({
      day: DAY,
      sessions: [session({ capture: { outcome: "completed", takeaway: "PCT reabsorbs most sodium" } }), session({ id: "s2", dayKey: "2026-09-25" })],
      attempts: [{ at: at(10), status: "correct" }, { at: at(10, 5), status: "incorrect" }, { at: at(10, 6), status: "flagged" }, { at: new Date(2026, 8, 25, 10).toISOString(), status: "correct" }],
      listening: [{ presetId: "gamma-40", start: at(9), end: at(9, 50) }, { presetId: "soft-rain", start: at(13), end: at(13, 20) }],
      rests: [{ startedAt: at(14), endedAt: at(14, 15), plannedMinutes: 15, completed: true }],
      checkIns: { day: DAY, prompts: 3, lockedIn: 2, drifted: 1 },
    });
    const byKey = Object.fromEntries(sections.map((section) => [section.key, section.value]));
    expect(byKey.sessions).toBe("Renal transport (45 min) — PCT reabsorbs most sodium");
    expect(byKey.accuracy).toBe("50% correct (1/2)");
    expect(byKey.sound).toBe("40 Hz Gamma 50 min · Soft rain 20 min");
    expect(byKey.rest).toBe("1 rest · 15 min");
    expect(byKey.checkins).toBe("Locked in 2 of 3");
    expect(sections.every((section) => section.hasEvidence)).toBe(true);
  });

  it("says plainly when nothing happened, and ignores other days' check-ins", () => {
    const sections = buildDayExtraSections({ day: DAY, sessions: [], attempts: [], listening: [], rests: [], checkIns: { day: "2026-09-25", prompts: 4, lockedIn: 4, drifted: 0 } });
    expect(sections.map((section) => section.hasEvidence)).toEqual([false, false, false, false, false]);
    expect(sections.find((section) => section.key === "checkins")?.value).toBe("No check-ins answered");
    expect(questionAccuracy([], DAY)).toBeNull();
  });
});
