// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { afterLater, readGuideOffer, writeGuideOffer } from "./guideOffer";

afterEach(() => localStorage.clear());

describe("guide offer", () => {
  it("starts pending, and survives a reload", () => {
    expect(readGuideOffer()).toBe("pending");
    writeGuideOffer("snoozed");
    expect(readGuideOffer()).toBe("snoozed");
  });
  it("re-offers once after the first Later, then stays in Help", () => {
    expect(afterLater("pending")).toBe("snoozed");
    expect(afterLater("snoozed")).toBe("declined");
  });
});
