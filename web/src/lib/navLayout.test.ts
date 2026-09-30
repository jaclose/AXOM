import { describe, expect, it } from "vitest";
import { applyNavOrder, moveNavItem, normalizeNavOrder, stepNavItem, upgradeNavLayout } from "./navLayout";

describe("sidebar layout", () => {
  it("upgrades an existing layout once: hides the Misc tools, keeps Soundscapes and Daily Games on", () => {
    const first = upgradeNavLayout(["courses", "soundscapes", "daily-word"], undefined);
    expect(first.navLayoutVersion).toBe(2);
    expect(first.hiddenNav).toEqual(expect.arrayContaining(["courses", "tasks", "methods", "prompts", "folders"]));
    expect(first.hiddenNav).not.toContain("soundscapes");
    expect(first.hiddenNav).not.toContain("daily-word");
    // Later the learner re-enables Tasks: the upgrade never runs again.
    const afterChoice = upgradeNavLayout(first.hiddenNav.filter((id) => id !== "tasks"), first.navLayoutVersion);
    expect(afterChoice.hiddenNav).not.toContain("tasks");
  });

  it("orders a section by the learner's choice and leaves unmoved items in place after", () => {
    expect(applyNavOrder(["a", "b", "c"], undefined)).toEqual(["a", "b", "c"]);
    expect(applyNavOrder(["a", "b", "c"], ["c", "a"])).toEqual(["c", "a", "b"]);
  });

  it("moves by drag target or one step with the keyboard, touching only that section", () => {
    const order = moveNavItem(["a", "b", "c"], ["x", "y"], "c", "a");
    expect(applyNavOrder(["a", "b", "c"], order)).toEqual(["c", "a", "b"]);
    expect(applyNavOrder(["x", "y"], order)).toEqual(["x", "y"]);
    expect(applyNavOrder(["a", "b", "c"], stepNavItem(["a", "b", "c"], order, "a", 1))).toEqual(["c", "b", "a"]);
    expect(stepNavItem(["a"], undefined, "a", -1)).toEqual([]);
    // A gated neighbour (not displayed) must not absorb the step.
    const skip = stepNavItem(["a", "gated", "c"], undefined, "c", -1, ["a", "c"]);
    expect(applyNavOrder(["a", "gated", "c"], skip).filter((id) => id !== "gated")).toEqual(["c", "a"]);
  });

  it("normalizes stored orders defensively", () => {
    expect(normalizeNavOrder("nope")).toBeUndefined();
    expect(normalizeNavOrder(["a", "a", 3, "", "b"])).toEqual(["a", "b"]);
  });
});
