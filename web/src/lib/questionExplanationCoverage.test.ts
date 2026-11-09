import { describe, expect, it } from "vitest";
import { hasExplanationBlocks, hasExplanationProse, hasMainExplanation } from "./questionExplanationCoverage";

const notice = "PowerPoint slide note 12 explicitly marks B. The supplied notes do not provide a teaching rationale.";

describe("explanation prose coverage", () => {
  it.each([undefined, "", "  ", notice, "Correct answer: B", "Answer is A.", "Explanation pending",
    "No explanation provided.", "Source: source.pdf, page 12", "[Image: teaching diagram]", "Answer: J",
    "PowerPoint slide note 12 explicitly marks J. The supplied notes do not provide a teaching rationale."])("excludes empty, key-only and provenance-only text: %s", text => {
    expect(hasExplanationProse(text)).toBe(false);
  });

  it("counts authored rationale, including text added after a retained source notice", () => {
    for (const text of ["The observed mechanism supports the answer.",
      "Correct answer: B because the observed mechanism supports it.",
      `${notice}\n\nThe observed mechanism supports the answer.`,
      `${notice} The observed mechanism supports the answer.`]) {
      expect(hasExplanationProse(text)).toBe(true);
    }
  });

  it("excludes image-only blocks and preserves useful rich-text and table explanations", () => {
    expect(hasExplanationBlocks([{ type: "image", assetId: "figure", alt: "Explanation diagram" }])).toBe(false);
    expect(hasExplanationBlocks([{ type: "text", text: notice }])).toBe(false);
    expect(hasExplanationBlocks([{ type: "rich_text", html: "<p>The source explains the mechanism.</p>" }])).toBe(true);
    expect(hasExplanationBlocks([{ type: "table", rows: [["Mechanism", "Source-supported relationship"]] }])).toBe(true);
  });

  it("honors edited prose despite a retained missing-source flag, without altering any evidence", () => {
    const source = { explanation: notice, content: {
      explanation: [{ type: "text" as const, text: notice }],
      flags: [{ type: "missing_explanation", message: "Original source has no rationale." }],
    }, correctKey: "B", attempts: [{ answerKey: "B" }] };
    const before = JSON.stringify(source);
    expect(hasMainExplanation(source)).toBe(false);
    expect(hasMainExplanation({ ...source, explanation: "A reviewed author has explained the mechanism." })).toBe(true);
    expect(hasMainExplanation({ ...source, explanation: "" })).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });
});
