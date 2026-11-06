import { describe, expect, it } from "vitest";
import { enrichCommunitySnapshotVisualTags, suggestCommunityVisualTags } from "./communityVisualTags";
import type { SharedQuestionSetSnapshot } from "./questionSetShare";

const fixture: SharedQuestionSetSnapshot = {
  shareFormatVersion: 1, title: "Test set", tags: [], orderedQuestionIds: ["shared-question-1"],
  createdAt: "2026-11-06T00:00:00.000Z", copyrightNotice: "Test",
  questions: [{ id: "shared-question-1", stem: "Biopsy histology shows foam cells within an atherosclerotic plaque.", options: [
    { key: "A", text: "Option one" }, { key: "B", text: "Option two" } ], correctKey: "A", tags: [] }],
};

describe("community visual keyword metadata", () => {
  it("derives relevant, bounded intent without pretending an image exists", () => {
    expect(suggestCommunityVisualTags("Biopsy histology of a carcinoma")).toEqual([
      "visual:histology", "visual:pathology",
    ]);
    expect(suggestCommunityVisualTags("Unrelated question on a written ethics principle")).toEqual([]);
  });
  it("enriches only the shared snapshot and does not mutate saved questions", () => {
    const enriched = enrichCommunitySnapshotVisualTags(fixture);
    expect(enriched.questions[0].tags).toEqual(["visual:histology", "visual:pathology"]);
    expect(enriched.tags).toEqual(enriched.questions[0].tags);
    expect(fixture.questions[0].tags).toEqual([]);
    expect(fixture.tags).toEqual([]);
  });
  it("is repeatable and deduplicates tags", () => {
    const once = enrichCommunitySnapshotVisualTags(fixture);
    expect(enrichCommunitySnapshotVisualTags(once)).toEqual(once);
  });
  it("never exceeds the existing 100-tag snapshot limit", () => {
    const many = { ...fixture, tags: Array.from({ length: 100 }, (_, i) => "topic" + i),
      questions: [{ ...fixture.questions[0], tags: Array.from({ length: 100 }, (_, i) => "topic" + i) }] };
    const enriched = enrichCommunitySnapshotVisualTags(many);
    expect(enriched.tags).toHaveLength(100);
    expect(enriched.questions[0].tags).toHaveLength(100);
  });
});
