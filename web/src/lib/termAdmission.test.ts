import { beforeEach, describe, expect, it } from "vitest";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import type { Term, TrackerItem } from "./types";
import type { PrimaryTrackerScope } from "./trackerFocus";
import { planTermAdmission } from "./termAdmission";

const terms: Term[] = [{ id: "term-1", name: "Term 1" }, { id: "term-2", name: "Term 2" }];
const row = (path: string): TrackerItem => ({
  id: "original-row", path, label: "Original lecture", kind: "Lecture",
  passes: 3, ankiPasses: 2, yield: "high", updated: "2026-11-01T09:00:00Z",
  attendance: "missed", templateKey: "source-47",
  passEvents: [{ id: "original-pass", method: "study", at: "2026-11-01T09:00:00Z" }],
});
const original = [row("Term 1/BPM500/Week 3")];

describe("Add Term canonical root admission", () => {
  it("rejects exact and normalized case/whitespace duplicate names", () => {
    for (const name of ["Term 1", "term 1", "  tErM    1  ", "TERM 2"]) {
      const result = planTermAdmission(terms, original, undefined, name);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/term|name|root/i);
    }
  });

  it("rejects empty and slash/nested-root names rather than creating conflicting tracker identities", () => {
    for (const name of ["", "  ", "Term 3/Semester 2", "/Term 3", "Term 3/"]) {
      expect(planTermAdmission(terms, original, undefined, name).ok).toBe(false);
    }
    const historicalNested: Term[] = [...terms, { id: "nested", name: "Term 4/Semester 2" }];
    expect(planTermAdmission(historicalNested, original, undefined, "Term 4").ok).toBe(false);
  });

  it("refuses to claim orphan tracker or primary focus roots", () => {
    expect(planTermAdmission(terms, [...original, row("Orphan/Week 1")], undefined, "Orphan").ok).toBe(false);
    const focus: PrimaryTrackerScope[] = [{ path: "Independent/Week 2", since: "2026-11-01T09:00:00Z" }];
    expect(planTermAdmission(terms, original, focus, "independent").ok).toBe(false);
    // Tracker root normalization must not ignore malformed historical leading separators.
    expect(planTermAdmission(terms, [row(" /Free/Week 2")], undefined, "Free").ok).toBe(false);
  });

  it("admits only distinct, whitespace-normalized root names and never mutates caller data", () => {
    const focus: PrimaryTrackerScope[] = [{ path: "Term 1/Week 3", since: "2026-11-01T09:00:00Z" }];
    const before = JSON.stringify({ terms, original, focus });
    expect(planTermAdmission(terms, original, focus, "  Term   3  ")).toEqual({ ok: true, name: "Term 3" });
    expect(JSON.stringify({ terms, original, focus })).toBe(before);
  });
});

describe("Add Term store boundary preserves existing learner data on rejection", () => {
  beforeEach(() => {
    useStore.setState(makeSeed());
    useStore.setState({ terms, tracker: original });
  });

  it("rejects duplicate and source-reserved roots without changing term/tracker or profile records", () => {
    const state = useStore.getState();
    const before = JSON.stringify({ terms: state.terms, tracker: state.tracker, profile: state.profile, courses: state.courses });
    for (const name of ["TERM 1", "Term 1/Week 4", "Free"]) {
      if (name === "Free") useStore.setState({ tracker: [...original, row("Free/Week 2")] });
      const attemptBefore = JSON.stringify({ terms: useStore.getState().terms, tracker: useStore.getState().tracker, profile: useStore.getState().profile, courses: useStore.getState().courses });
      expect(useStore.getState().addTerm(name).ok).toBe(false);
      expect(JSON.stringify({ terms: useStore.getState().terms, tracker: useStore.getState().tracker, profile: useStore.getState().profile, courses: useStore.getState().courses })).toBe(attemptBefore);
    }
    useStore.setState({ tracker: original });
    expect(JSON.stringify({ terms: useStore.getState().terms, tracker: useStore.getState().tracker, profile: useStore.getState().profile, courses: useStore.getState().courses })).toBe(before);
  });

  it("adds a disjoint term once while preserving source identity, attendance and passes", () => {
    const prev = useStore.getState().tracker;
    const outcome = useStore.getState().addTerm("  Term   3 ");
    expect(outcome).toEqual({ ok: true });
    const after = useStore.getState();
    expect(after.terms).toHaveLength(3);
    expect(after.terms[2].name).toBe("Term 3");
    expect(after.terms[2].id).toBeTruthy();
    expect(after.tracker).toEqual(prev);
    expect(after.tracker[0].templateKey).toBe("source-47");
    expect(after.tracker[0].attendance).toBe("missed");
    expect(after.tracker[0].passes).toBe(3);
  });
});
