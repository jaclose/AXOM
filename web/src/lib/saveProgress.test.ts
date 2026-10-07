// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { afterCreate, afterNotNow, hasMeaningfulData, readSaveProgress, shouldOfferSaveProgress, writeSaveProgress } from "./saveProgress";

const empty = { logs: [], questions: [], tracker: [], journal: [], userSounds: 0 };
const now = new Date("2026-09-30T12:00:00Z");

beforeEach(() => localStorage.clear());

describe("save your progress", () => {
  it("counts only what the student made, never the seed or the Promise", () => {
    expect(hasMeaningfulData(empty)).toBe(false);
    expect(hasMeaningfulData({ ...empty, tracker: [{ label: "Example lecture: Sleep" }], journal: [{ rating: "Promise" }] })).toBe(false);
    expect(hasMeaningfulData({ ...empty, logs: [{ minutes: 0, cards: 0 }] })).toBe(false);
    for (const input of [
      { logs: [{ minutes: 25 }] }, { questions: [{}] }, { questionSets: [{}] }, { documents: [{}] }, { tracker: [{ label: "Renal clearance" }] },
      { journal: [{ rating: "Good" }] }, { dayPlans: [{}] }, { userSounds: 1 },
    ]) expect(hasMeaningfulData({ ...empty, ...input })).toBe(true);
  });

  it("asks only a signed-out student with saved work, and respects Not now", () => {
    const base = { phase: "signed-out" as const, meaningful: true, ledger: readSaveProgress(), now };
    expect(shouldOfferSaveProgress(base)).toBe(true);
    expect(shouldOfferSaveProgress({ ...base, phase: "signed-in" })).toBe(false);
    expect(shouldOfferSaveProgress({ ...base, phase: "unconfigured" })).toBe(false);
    expect(shouldOfferSaveProgress({ ...base, meaningful: false })).toBe(false);

    const once = afterNotNow(base.ledger, now);
    expect(shouldOfferSaveProgress({ ...base, ledger: once })).toBe(false);
    expect(shouldOfferSaveProgress({ ...base, ledger: once, now: new Date("2026-10-07T12:00:01Z") })).toBe(true);
    const twice = afterNotNow(once, now);
    expect(twice).toEqual({ state: "retired" });
    expect(shouldOfferSaveProgress({ ...base, ledger: twice, now: new Date("2027-01-01") })).toBe(false);
  });

  it("asks again a week after Make an account if the student never signed in", () => {
    const ledger = afterCreate(now);
    expect(shouldOfferSaveProgress({ phase: "signed-out", meaningful: true, ledger, now })).toBe(false);
    expect(shouldOfferSaveProgress({ phase: "signed-out", meaningful: true, ledger, now: new Date("2026-10-08T00:00:00Z") })).toBe(true);
  });

  it("remembers its state on this device and survives bad storage", () => {
    writeSaveProgress({ state: "retired" });
    expect(readSaveProgress()).toEqual({ state: "retired" });
    localStorage.setItem("axom.saveProgress.v1", "{bad");
    expect(readSaveProgress()).toEqual({ state: "pending" });
  });
});
