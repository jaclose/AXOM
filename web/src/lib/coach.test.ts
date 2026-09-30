// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  COACH_GAP_MS, OVERWHELMED_ID, eligiblePageHint, markCoachShown, overwhelmedDue,
  readCoachLedger, resetPageHints, writeCoachLedger, type PageHint,
} from "./coach";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const hint = (id: string, route: string, done?: () => boolean): PageHint => ({ id, route, target: "#x", title: id, body: id, done });

beforeEach(() => localStorage.clear());

describe("coach ledger", () => {
  it("round-trips through localStorage and ignores junk", () => {
    expect(readCoachLedger()).toEqual({ seen: [], lastShownAt: undefined, off: undefined });
    writeCoachLedger(markCoachShown({ seen: [] }, OVERWHELMED_ID, NOW));
    expect(readCoachLedger()).toEqual({ seen: [OVERWHELMED_ID], lastShownAt: NOW, off: undefined });
    localStorage.setItem("axom.coach.v1", "{\"seen\":[1,\"a\"],\"lastShownAt\":\"soon\"}");
    expect(readCoachLedger()).toEqual({ seen: ["a"], lastShownAt: undefined, off: undefined });
  });
});

describe("Overwhelmed?", () => {
  it("shows once, and never after hints were turned off", () => {
    expect(overwhelmedDue({ seen: [] }, NOW)).toBe(true);
    expect(overwhelmedDue(markCoachShown({ seen: [] }, OVERWHELMED_ID, NOW), NOW + COACH_GAP_MS)).toBe(false);
    expect(overwhelmedDue({ seen: [], off: true }, NOW)).toBe(false);
  });
});

describe("page hints", () => {
  const hints = [hint("a", "dashboard"), hint("b", "tracker"), hint("c", "tracker")];
  const ready = markCoachShown({ seen: [] }, OVERWHELMED_ID, NOW - COACH_GAP_MS);

  it("wait for Overwhelmed? to have had its moment", () => {
    expect(eligiblePageHint("dashboard", { seen: [] }, NOW, hints)).toBeUndefined();
    expect(eligiblePageHint("dashboard", ready, NOW, hints)?.id).toBe("a");
  });

  it("offer one per route, each once, with a gap between any two", () => {
    const afterB = markCoachShown(ready, "b", NOW);
    expect(eligiblePageHint("tracker", afterB, NOW + 1_000, hints)).toBeUndefined();
    expect(eligiblePageHint("tracker", afterB, NOW + COACH_GAP_MS, hints)?.id).toBe("c");
  });

  it("drop a hint once the learner has already done the thing", () => {
    const done = [hint("a", "dashboard", () => true)];
    expect(eligiblePageHint("dashboard", ready, NOW, done)).toBeUndefined();
  });

  it("stop after No more hints, and come back from Help without replaying Overwhelmed?", () => {
    const off = { ...markCoachShown(ready, "a", NOW - COACH_GAP_MS), off: true };
    expect(eligiblePageHint("tracker", off, NOW, hints)).toBeUndefined();
    const reset = resetPageHints(off);
    expect(reset).toEqual({ seen: [OVERWHELMED_ID] });
    expect(eligiblePageHint("dashboard", reset, NOW, hints)?.id).toBe("a");
    expect(overwhelmedDue(reset, NOW)).toBe(false);
  });
});
