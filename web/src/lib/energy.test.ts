import { describe, expect, it } from "vitest";
import { calculateReadiness, explainLowEnergy, inferJournalSignals, LOW_ENERGY_THRESHOLD } from "./energy";
import type { EnergyFactor, JournalEntry } from "./types";

const baseInput = {
  date: "2026-06-24",
  factors: [] as EnergyFactor[],
  journal: [] as JournalEntry[],
  logs: [],
  tasks: [],
  dayPlans: [],
  productivityTrackers: [],
};

function factor(patch: Partial<EnergyFactor>): EnergyFactor {
  return {
    id: "factor",
    date: "2026-06-24",
    source: "manual",
    label: "Manual factor",
    category: "recovery",
    delta: 10,
    confidence: 1,
    carryoverDays: 0,
    decayPerDay: 1,
    userConfirmed: true,
    ...patch,
  };
}

describe("energy readiness engine", () => {
  it("applies confirmed manual factors to estimated readiness", () => {
    const result = calculateReadiness({
      ...baseInput,
      factors: [factor({ label: "Movement", category: "movement", delta: 8 })],
    });
    expect(result.estimatedReadiness).toBe(70);
    expect(result.contributions[0].label).toBe("Movement");
  });

  it("decays carryover factors across following days", () => {
    const result = calculateReadiness({
      ...baseInput,
      factors: [factor({
        date: "2026-06-23",
        label: "All-nighter",
        category: "sleep",
        delta: -20,
        carryoverDays: 3,
        decayPerDay: 0.25,
      })],
    });
    expect(result.carryoverImpact).toBe(-15);
    expect(result.estimatedReadiness).toBe(47);
  });

  it("surfaces journal language as possible signals without applying it", () => {
    const result = calculateReadiness({
      ...baseInput,
      journal: [{
        id: "j1",
        date: "2026-06-24T20:00:00",
        today: "Pulled an all-nighter and doomscrolling made the day worse.",
        tomorrow: "",
        blockers: "",
        energy: "",
        rating: "",
      }],
    });
    expect(result.estimatedReadiness).toBe(62);
    expect(result.possibleSignals.map((signal) => signal.label)).toContain("All-nighter possible");
  });

  it("recognizes positive and behind/late wording as uncertain, user-reviewable signals", () => {
    const result = calculateReadiness({
      ...baseInput,
      journal: [{
        id: "language", date: "2026-06-24T20:00:00", today: "I felt calm and made steady progress, but I am late on one deadline.", tomorrow: "", blockers: "", energy: "", rating: "",
      }],
    });
    expect(result.possibleSignals.map((signal) => signal.label)).toEqual(expect.arrayContaining([
      "Positive momentum possible",
      "Overload possible",
    ]));
    expect(result.contributions).toHaveLength(0);
    expect(result.estimatedReadiness).toBe(62);
  });

  it("uses today's latest one-tap energy check ahead of the journal label", () => {
    const result = calculateReadiness({
      ...baseInput,
      journal: [{ id: "journal", date: "2026-06-24T08:00:00", today: "", tomorrow: "", blockers: "", energy: "High", rating: "" }],
      energyChecks: [
        { at: "2026-06-23T21:00:00", score: 90 },
        { at: "2026-06-24T09:00:00", score: 70 },
        { at: "2026-06-24T15:00:00", score: 30 },
      ],
    });
    expect(result.selfReportedEnergy).toMatchObject({ label: "Low", score: 30, source: "energy-check:2026-06-24T15:00:00" });
    expect(result.contributions[0]).toMatchObject({ label: "Self-reported energy", explanation: "Your latest one-tap energy check today." });
    expect(explainLowEnergy(result)).toMatchObject({ triggered: true, trigger: "Self-reported energy", currentValue: 30 });
  });

  it("lets explicit self-reported energy remain authoritative while text inference stays unapplied", () => {
    const result = calculateReadiness({
      ...baseInput,
      journal: [{
        id: "corrected", date: "2026-06-24T20:00:00", today: "I am falling behind.", tomorrow: "", blockers: "", energy: "High", rating: "",
      }],
    });
    expect(result.selfReportedEnergy).toMatchObject({ label: "High", score: 82, source: "corrected" });
    expect(result.possibleSignals.map((signal) => signal.label)).toContain("Overload possible");
    expect(result.contributions.some((item) => item.label === "Overload possible")).toBe(false);
    expect(result.estimatedReadiness).toBeGreaterThan(62);
  });

  it("applies a journal signal after the user confirms it", () => {
    const journal: JournalEntry[] = [{
      id: "j2",
      date: "2026-06-24T20:00:00",
      today: "Poor sleep and overload.",
      tomorrow: "",
      blockers: "",
      energy: "",
      rating: "",
    }];
    const [signal] = inferJournalSignals(journal, "2026-06-24");
    const result = calculateReadiness({
      ...baseInput,
      journal,
      factors: [{ ...signal, userConfirmed: true }],
    });
    expect(result.possibleSignals).toHaveLength(0);
    expect(result.estimatedReadiness).toBeLessThan(62);
  });

  it("keeps self-reported energy separate but visible in the readiness estimate", () => {
    const result = calculateReadiness({
      ...baseInput,
      journal: [{
        id: "j3",
        date: "2026-06-24T20:00:00",
        today: "Normal day.",
        tomorrow: "",
        blockers: "",
        energy: "High",
        rating: "",
      }],
    });
    expect(result.selfReportedEnergy.score).toBe(82);
    expect(result.estimatedReadiness).toBeGreaterThan(62);
  });

  it("explains low self-reported energy even when the blended estimate stays above the threshold", () => {
    const readiness = calculateReadiness({
      ...baseInput,
      journal: [{
        id: "low", date: "2026-06-24T20:00:00", today: "Tired day.", tomorrow: "", blockers: "", energy: "Low", rating: "",
      }],
    });
    const explanation = explainLowEnergy(readiness);
    expect(readiness.estimatedReadiness).toBeGreaterThan(LOW_ENERGY_THRESHOLD);
    expect(explanation).toMatchObject({
      triggered: true,
      trigger: "Self-reported energy",
      currentValue: 35,
      threshold: 40,
    });
    expect(explanation.unchanged).toContain("Tasks and deadlines");
  });

  it("explains confirmed factors when estimated readiness is below threshold", () => {
    const explanation = explainLowEnergy(calculateReadiness({
      ...baseInput,
      factors: [factor({ label: "Severe sleep debt", category: "sleep", delta: -30 })],
    }));
    expect(explanation.triggered).toBe(true);
    expect(explanation.trigger).toBe("Estimated readiness");
    expect(explanation.contributions[0]).toMatchObject({ label: "Severe sleep debt", value: -30 });
  });

  it("does not recommend from an empty baseline or an unconfirmed text signal", () => {
    expect(explainLowEnergy(calculateReadiness(baseInput))).toMatchObject({ hasEvidence: false, triggered: false });
    const possibleOnly = calculateReadiness({
      ...baseInput,
      journal: [{
        id: "possible", date: "2026-06-24T20:00:00", today: "No sleep at all.", tomorrow: "", blockers: "", energy: "", rating: "",
      }],
    });
    expect(possibleOnly.possibleSignals.length).toBeGreaterThan(0);
    expect(explainLowEnergy(possibleOnly)).toMatchObject({ hasEvidence: false, triggered: false });
  });

  it("does not trigger above the threshold when evidence is present", () => {
    const readiness = calculateReadiness({ ...baseInput, factors: [factor({ label: "Movement", delta: 8 })] });
    expect(explainLowEnergy(readiness)).toMatchObject({ hasEvidence: true, triggered: false });
  });
});
