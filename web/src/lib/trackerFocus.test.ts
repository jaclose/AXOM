import { describe, expect, it } from "vitest";
import { activePrimaryPaths, normalizePrimaryScopes, renamePrimaryScopes, togglePrimaryScope } from "./trackerFocus";
import { rankTrackerItems } from "./recommendationFactors";
import type { TrackerItem } from "./types";

function item(id: string, path: string): TrackerItem {
  return { id, path, label: id, kind: "Lecture", passes: 0, ankiPasses: 0, yield: "none", updated: "2026-09-01T12:00:00.000Z" };
}

describe("primary tracker focus", () => {
  it("toggles, replaces overlapping scopes and expires on its until date", () => {
    let scopes = togglePrimaryScope(undefined, "T2/NB3");
    scopes = togglePrimaryScope(scopes, "T2/NB3/Renal");
    expect(scopes.map((scope) => scope.path)).toEqual(["T2/NB3/Renal"]);
    scopes = togglePrimaryScope(scopes, "T2/NB4");
    scopes = scopes.map((scope) => (scope.path === "T2/NB4" ? { ...scope, until: "2026-09-10" } : scope));
    expect(activePrimaryPaths(scopes, "2026-09-10")).toEqual(["T2/NB3/Renal", "T2/NB4"]);
    expect(activePrimaryPaths(scopes, "2026-09-11")).toEqual(["T2/NB3/Renal"]);
    expect(togglePrimaryScope(scopes, "T2/NB3/Renal").map((scope) => scope.path)).toEqual(["T2/NB4"]);
  });

  it("normalizes stored scopes and follows renames", () => {
    expect(normalizePrimaryScopes([{ path: " A/B/ ", since: "x" }, { path: "a/b" }, { path: "" }, { path: "C", until: "bad" }]))
      .toEqual([{ path: "A/B", since: "x" }, { path: "C", since: expect.any(String), until: undefined }]);
    expect(renamePrimaryScopes([{ path: "T2/NB3/Renal", since: "x" }], "T2/NB3", "Term 2/Renal block")?.[0].path).toBe("Term 2/Renal block/Renal");
  });

  it("lifts primary items in every recommendation", () => {
    const items = [item("elsewhere", "T2/NB4/Cardio"), item("focus", "T2/NB3/Renal")];
    const now = new Date("2026-09-02T12:00:00Z");
    expect(rankTrackerItems(items, { now })[0].item.id).toBe("elsewhere");
    const ranked = rankTrackerItems(items, { now, primaryScopes: ["T2/NB3"] });
    expect(ranked[0].item.id).toBe("focus");
    expect(ranked[0].reason).toContain("In your primary focus");
  });
});
