import { beforeEach, describe, expect, it } from "vitest";
import { resetCommunityShare, setCommunityShareMode, useCommunityShare } from "./shareStore";
beforeEach(resetCommunityShare);
describe("Community consent generation state", () => {
  it("ignores an older response arriving after a settings save", () => {
    setCommunityShareMode("a", "friends", 2);
    setCommunityShareMode("a", "off", 3);
    setCommunityShareMode("a", "friends", 2);
    expect(useCommunityShare.getState()).toMatchObject({ accountId: "a", mode: "off", revision: 3 });
  });
  it("preserves a local leave fence until a genuinely newer response arrives", () => {
    setCommunityShareMode("a", "friends", 2);
    setCommunityShareMode("a", "off");
    setCommunityShareMode("a", "friends", 2);
    expect(useCommunityShare.getState().mode).toBe("off");
    setCommunityShareMode("a", "community", 4);
    expect(useCommunityShare.getState()).toMatchObject({ mode: "community", revision: 4 });
  });
  it("uses a separate generation for another account", () => {
    setCommunityShareMode("a", "off", 8);
    setCommunityShareMode("b", "friends", 1);
    expect(useCommunityShare.getState()).toMatchObject({ accountId: "b", mode: "friends", revision: 1 });
  });
});
