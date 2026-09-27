import { describe, expect, it } from "vitest";
import { gradeLegend, gradeThresholds, heatColor, todayGrade } from "./scoring";

describe("personal day grades", () => {
  it("reproduces the original Swift thresholds without targets", () => {
    expect([299, 300, 360, 480].map((minutes) => todayGrade(minutes, 0))).toEqual(["red", "orange", "green", "blue"]);
    expect([149, 150, 250, 350].map((cards) => todayGrade(0, cards))).toEqual(["red", "orange", "green", "blue"]);
  });

  it("scales with the learner's own targets", () => {
    const targets = { minutes: 120, cards: 60 };
    expect(todayGrade(119, 0, targets)).toBe("red");
    expect(todayGrade(120, 0, targets)).toBe("orange");
    expect(todayGrade(144, 0, targets)).toBe("green");
    expect(todayGrade(192, 0, targets)).toBe("blue");
    expect(todayGrade(0, 100, targets)).toBe("green");
  });

  it("ignores cards when the card target is zero", () => {
    expect(gradeThresholds({ minutes: 240, cards: 0 }).orange.cards).toBe(Number.POSITIVE_INFINITY);
    expect(todayGrade(30, 900, { minutes: 240, cards: 0 })).toBe("red");
    expect(gradeLegend({ minutes: 240, cards: 0 })[1].label).toBe("On target (4h)");
  });

  it("names the real thresholds in the legend and colors the heatmap by grade", () => {
    expect(gradeLegend({ minutes: 240, cards: 120 }).map((row) => row.label)).toEqual([
      "Below target (under 4h)",
      "On target (4h or 120 cards)",
      "Strong (4.8h or 200 cards)",
      "👑 Excellent (6.4h or 280 cards)",
    ]);
    expect(heatColor(0, 0)).toBe("rgba(255,255,255,0.055)");
    expect(heatColor(240, 0, { minutes: 240 })).toContain("--grade-orange");
  });
});
