import { describe, expect, it } from "vitest";
import { mergeReviewedCommunityKeywords } from "./communityReviewedKeywords";

describe("explicitly reviewed Community AI keywords", () => {
  it("preserves authored tags and adds only canonical, unique reviewed keywords", () => {
    const authored = ["Anatomy", "tunica media"];
    const result = mergeReviewedCommunityKeywords(authored, "Tunica media; Vascular  Smooth Muscle, histology, HISTOLOGY");
    expect(result).toEqual(["Anatomy", "tunica media", "vascular smooth muscle", "histology"]);
    expect(authored).toEqual(["Anatomy", "tunica media"]);
  });

  it("rejects overlong or excessive proposals instead of silently truncating or dropping tags", () => {
    expect(() => mergeReviewedCommunityKeywords([], "x".repeat(65))).toThrow(/64 characters/);
    expect(() => mergeReviewedCommunityKeywords([], Array(9).fill("keyword").join(","))).toThrow(/eight/);
    expect(() => mergeReviewedCommunityKeywords(Array.from({ length: 100 }, (_, i) => `tag-${i}`), "new tag"))
      .toThrow(/maximum 100/);
  });

  it("allows a full question's existing tags to remain unchanged when all reviewed proposals are duplicates", () => {
    const original = Array.from({ length: 100 }, (_, i) => `tag-${i}`);
    expect(mergeReviewedCommunityKeywords(original, "tag-1")).toEqual(original);
    expect(mergeReviewedCommunityKeywords(original, " ")).toEqual(original);
  });
});
