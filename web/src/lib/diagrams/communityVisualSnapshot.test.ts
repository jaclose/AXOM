import { describe, expect, it } from "vitest";
import { validateShare, type SharedQuestionSetSnapshot } from "../sharing/questionSetShare";
import { enrichPublicQuestionSetVisualTags } from "./communityVisualSnapshot";

const original: SharedQuestionSetSnapshot = {
  shareFormatVersion: 1,
  title: "Anatomy and pathology",
  tags: ["reviewed"],
  orderedQuestionIds: ["shared-question-1", "shared-question-2"],
  questions: [
    {
      id: "shared-question-1",
      stem: "Which nerve is injured after a lesion of the posterior cord of the brachial plexus?",
      options: [{ key: "A", text: "Axillary nerve" }, { key: "B", text: "Long thoracic nerve" }],
      correctKey: "A", explanation: "Posterior cord anatomy can explain the site of injury and affected branches.",
      tags: ["anatomy"], topic: "Brachial plexus",
    },
    {
      id: "shared-question-2",
      stem: "A gross specimen shows a yellow cut surface. What organ is shown?",
      options: [{ key: "A", text: "Liver" }, { key: "B", text: "Lung" }],
      correctKey: "A", explanation: "The gross appearance requires comparison with the actual specimen.",
      tags: [], topic: "Gross specimen",
    },
  ],
  createdAt: "2026-11-07T18:00:00.000Z",
  copyrightNotice: "Only redistribute licensed questions.",
};

describe("community visual intent publication", () => {
  it("embeds searchable visual intent into a valid v1 snapshot without introducing an asset", () => {
    const result = enrichPublicQuestionSetVisualTags(original);
    expect(result.shareFormatVersion).toBe(1);
    expect(result.questions[0].tags).toContain("visual:intent:anatomical-schematic");
    expect(result.questions[0].tags).toContain("visual:keyword:brachial plexus");
    expect(result.questions[1].tags).toContain("visual:intent:gross-pathology-specimen");
    expect(result.tags).toContain("visual:intent:anatomical-schematic");
    expect(result.tags).toContain("visual:intent:gross-pathology-specimen");
    expect(JSON.stringify(result)).not.toMatch(/assetId|sourceDocumentId|rightsReviewed/);
    expect(() => validateShare(result)).not.toThrow();
  });

  it("preserves the source and produces the same result if enriched twice", () => {
    const once = enrichPublicQuestionSetVisualTags(original);
    expect(enrichPublicQuestionSetVisualTags(once)).toEqual(once);
    expect(original.tags).toEqual(["reviewed"]);
    expect(original.questions[0].tags).toEqual(["anatomy"]);
    expect(original.questions[1].tags).toEqual([]);
  });

  it("does not infer a diagnosis or request a diagram from vague symptoms", () => {
    const source = { ...original, questions: [{ ...original.questions[0],
      stem: "A patient has cough and fever. What is the next step?", topic: undefined, tags: [] }] };
    const result = enrichPublicQuestionSetVisualTags(source);
    expect(result.questions[0].tags).toEqual([]);
    expect(result.tags).toEqual(["reviewed"]);
  });

  it("respects the existing 100-tag limit without dropping author tags", () => {
    const tags = Array.from({ length: 100 }, (_, index) => `topic-${index}`);
    const source = { ...original, tags,
      questions: [{ ...original.questions[0], tags }] };
    const result = enrichPublicQuestionSetVisualTags(source);
    expect(result.tags).toEqual(tags);
    expect(result.questions[0].tags).toEqual(tags);
    expect(() => validateShare({ ...result, orderedQuestionIds: ["shared-question-1"] })).not.toThrow();
  });

  it("does not truncate long explicit keywords into misleading labels", () => {
    const topic = "A".repeat(63);
    const source = { ...original, questions: [{ ...original.questions[0], topic }] };
    const result = enrichPublicQuestionSetVisualTags(source);
    expect(result.questions[0].tags.some(tag => tag.startsWith("visual:keyword:") && tag.includes("aaa"))).toBe(false);
  });
});
