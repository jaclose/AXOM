import { describe, expect, it } from "vitest";
import { otherWorkspaceUrl } from "./otherWorkspace";

describe("other AXOM workspace address", () => {
  it("offers the separate www workspace only from the apex origin", () => {
    expect(otherWorkspaceUrl("axom.info")).toBe("https://www.axom.info/?app=1");
    expect(otherWorkspaceUrl("www.axom.info")).toBeNull();
    expect(otherWorkspaceUrl("axom.info.example.com")).toBeNull();
    expect(otherWorkspaceUrl("localhost")).toBeNull();
  });
});
