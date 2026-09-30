import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_PICKS, dashboardQuickPicks } from "./quickPicks";
import { EMPTY_TASTE } from "./taste";

describe("dashboardQuickPicks", () => {
  it("falls back to the study-first defaults for a new student", () => {
    expect(dashboardQuickPicks([], EMPTY_TASTE, "gamma-40")).toEqual([...DEFAULT_QUICK_PICKS]);
  });

  it("leads with pinned sounds, then the last one played, without duplicates", () => {
    expect(dashboardQuickPicks(["ocean", "brown-noise"], EMPTY_TASTE, "cafe")).toEqual(["ocean", "brown-noise", "cafe", "gamma-40"]);
  });

  it("skips an empty Your sounds shelf", () => {
    expect(dashboardQuickPicks(["yours"], EMPTY_TASTE, "alpha-10")).toEqual(["alpha-10", "gamma-40", "beta-20", "brown-noise"]);
  });
});
