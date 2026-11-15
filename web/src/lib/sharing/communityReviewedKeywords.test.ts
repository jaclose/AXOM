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
  it.each([
    "visual:intent:histology",
    "rights:approved",
    "source:reviewed",
    "license:cc-by",
    "moderation:approved",
    "answer-key:verified",
    "https://example.edu/article",
    "Arterial reference https://example.edu/case",
    "https://example.edu/case?token=DEMO_NOT_SECRET",
  ])("rejects reserved publication metadata and citation references (%s)", keyword => {
    expect(() => mergeReviewedCommunityKeywords(["original"], keyword))
      .toThrow(/subject phrases.*publication metadata/i);
  });

  it.each([
    ["zero-width rights attestation", "rig\u200Bhts:approved"],
    ["word-joiner source review", "source\u2060:reviewed"],
    ["zero-width visual-intent claim", "visual\u200D:intent:histology"],
    ["bidi-hidden moderation claim", "moderation\u202E:approved"],
    ["fullwidth rights attestation", "ＲＩＧＨＴＳ：approved"],
    ["zero-width web citation", "https\u200B://example.edu/clinical"],
    ["fullwidth web citation", "ｈｔｔｐｓ：／／example.edu/clinical"],
    ["hidden private file URI", "file\u200B:///Users/student/private.pdf"],
    ["invisible-only subject tag", "\u200B\uFEFF"],
  ])("rejects unicode-disguised publication evidence or reference: %s", (_label, keyword) => {
    const authored = ["original", "rights:reviewed"];
    expect(() => mergeReviewedCommunityKeywords(authored, keyword))
      .toThrow(/subject phrases.*publication metadata/i);
    expect(authored).toEqual(["original", "rights:reviewed"]);
  });

  it("preserves legitimate clinical and non-Latin subject phrases with joining marks", () => {
    expect(mergeReviewedCommunityKeywords(["author"], "CD4/CD8, بافت\u200Cشناسی"))
      .toEqual(["author", "cd4/cd8", "بافت\u200Cشناسی"]);
  });

  it("preserves existing legacy metadata without letting AI proposals create more", () => {
    const original = ["visual:intent:anatomy", "rights:reviewed", "CD4/CD8"];
    expect(mergeReviewedCommunityKeywords(original, "Histology: vessel layers, CD4/CD8"))
      .toEqual([...original, "histology: vessel layers"]);
    expect(original).toEqual(["visual:intent:anatomy", "rights:reviewed", "CD4/CD8"]);
  });


});
