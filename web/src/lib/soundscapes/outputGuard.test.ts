import { describe, expect, it } from "vitest";
import { outputRemoved } from "./outputGuard";

describe("output guard", () => {
  it("pauses only when a specific, known output disappears", () => {
    expect(outputRemoved(["default", "speakers", "headphones"], ["default", "speakers"])).toBe(true);
    expect(outputRemoved(["default", "speakers"], ["default", "speakers", "headphones"])).toBe(false);
  });
  it("does nothing when the browser hides device ids", () => {
    expect(outputRemoved([""], [""])).toBe(false);
    expect(outputRemoved(["default"], [])).toBe(false);
  });
});
