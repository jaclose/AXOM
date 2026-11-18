import { describe, expect, it } from "vitest";
import type { QuestionRecord } from "../questions";
import { summarizeQuestionSetSubmissionReadiness } from "./questionSetSubmissionReadiness";

function question(id: string, reviewed: boolean, key: string | null = "A"): QuestionRecord {
  return {
    id, source: "pasted", stem: "Which option is supported?",
    options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }],
    correctKey: key ?? undefined, status: "unseen", tags: [], attempts: [],
    createdAt: "2026-11-18T10:00:00.000Z", updatedAt: "2026-11-18T10:00:00.000Z",
    explanation: "A source-grounded explanation.", extraction: { reviewed, confidence: "high" },
  };
}

describe("Community Question Set submission readiness", () => {
  it("does not mislabel 120 absent records as 120 source-review holds", () => {
    expect(summarizeQuestionSetSubmissionReadiness(Array(120).fill(undefined))).toEqual({
      missing: 120, held: 0, ready: 0,
    });
  });

  it("recognizes backed-up reviewed keys as potentially ready when all records are loaded", () => {
    const loaded = Array.from({ length: 120 }, (_, i) => question(`q-${i + 1}`, true));
    expect(summarizeQuestionSetSubmissionReadiness(loaded)).toEqual({
      missing: 0, held: 0, ready: 120,
    });
  });

  it("keeps absent records distinct from existing answer and extraction holds", () => {
    expect(summarizeQuestionSetSubmissionReadiness([
      undefined, question("verified", true), question("no-key", true, null),
      question("unreviewed-source", false),
    ])).toEqual({ missing: 1, held: 2, ready: 1 });
  });
});
