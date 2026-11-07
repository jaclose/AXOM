import { describe, expect, it } from "vitest";
import { NAV, SIDEBAR_LEARN, SIDEBAR_REVIEW, SIDEBAR_TOOLS, SIDEBAR_MISC, SIDEBAR_BOTTOM, navById } from "./nav";

describe("AXOM consolidated navigation", () => {
  it("provides one discoverable entry for each preserved daily and study workflow", () => {
    expect(SIDEBAR_REVIEW).toContain("productivity");
    expect(SIDEBAR_LEARN).toContain("studio");
    expect(SIDEBAR_TOOLS).toContain("library");
    expect(navById("studio")?.label).toBe("Study Studio");
    expect(navById("library")?.label).toBe("Library");
  });

  it("retires Misc without deleting deep-linked feature routes", () => {
    expect(SIDEBAR_MISC).toHaveLength(0);
    expect(SIDEBAR_TOOLS).not.toContain("habits");
    expect(SIDEBAR_BOTTOM).not.toContain("building");
    for (const id of ["tasks", "habits", "methods", "prompts", "folders", "resources", "patch-notes", "building"]) {
      expect(NAV.some(item => item.id === id)).toBe(true);
    }
    expect(SIDEBAR_BOTTOM).toContain("host");
  });
});
