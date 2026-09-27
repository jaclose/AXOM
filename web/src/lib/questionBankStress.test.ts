import { describe, expect, it } from "vitest";
import { parseQuestionBlocks } from "./questionParse";
import { draftImportStatus } from "./questionImportTrust";

function cleanQuestions(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const answer = ["A", "B", "C", "D"][index % 4];
    return `${number}. A learner presents with synthetic finding ${number}. Which mechanism best explains it?\nA. Mechanism alpha ${number}\nB. Mechanism beta ${number}\nC. Mechanism gamma ${number}\nD. Mechanism delta ${number}\nAnswer: ${answer}\nExplanation: The numbered synthetic clue maps deterministically to option ${answer}.`;
  }).join("\n\n");
}

describe("Question Bank launch-volume stress corpus", () => {
  it.each([50, 200, 500])("parses %i clean questions without review burden or loss", (count) => {
    const started = performance.now();
    const drafts = parseQuestionBlocks(cleanQuestions(count));
    const elapsed = performance.now() - started;
    expect(drafts).toHaveLength(count);
    expect(drafts.filter((draft) => draftImportStatus(draft) !== "ready")).toHaveLength(0);
    expect(new Set(drafts.map((draft) => draft.questionNumber)).size).toBe(count);
    // A generous regression ceiling catches accidental quadratic work while
    // remaining stable on slower CI hosts.
    expect(elapsed).toBeLessThan(3_000);
  });

  it("isolates malformed and ambiguous records inside a 200-question batch", () => {
    const blocks = cleanQuestions(200).split("\n\n");
    blocks[74] = "75. Ambiguous synthetic question?\nA. First\nA. Duplicate label\nB. Second";
    blocks[149] = "150. Unresolved synthetic question?\nA. First\nB. Second\nC. Third";
    const drafts = parseQuestionBlocks(blocks.join("\n\n"));
    expect(drafts).toHaveLength(200);
    expect(drafts[73].correctKey).toBe("B");
    expect(drafts[75].correctKey).toBe("D");
    expect(draftImportStatus(drafts[74])).not.toBe("ready");
    expect(draftImportStatus(drafts[149])).not.toBe("ready");
    expect(drafts.filter((draft) => draftImportStatus(draft) !== "ready")).toHaveLength(2);
  });
});
