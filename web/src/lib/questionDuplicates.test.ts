import { describe, expect, it } from "vitest";
import { findQuestionDuplicate, flagImportDuplicates } from "./questionDuplicates";
import type { ParsedQuestionDraft } from "./questionParse";
import type { QuestionRecord } from "./questions";

const draft = (stem: string, option = "Aldosterone"): ParsedQuestionDraft => ({ stem, options: [{ key: "A", text: option }, { key: "B", text: "Cortisol" }], confidence: "high", warnings: [] });
const record = (stem: string, option = "Aldosterone"): QuestionRecord => ({ id: "existing", source: "pdf", stem, options: [{ key: "A", text: option }, { key: "B", text: "Cortisol" }], status: "unseen", tags: [], attempts: [], createdAt: "x", updatedAt: "x" });

describe("question duplicate detection", () => {
  it("classifies punctuation/case-only changes as exact", () => {
    expect(findQuestionDuplicate(draft("Which hormone raises sodium?"), [record("WHICH hormone raises sodium !")])).toMatchObject({ kind: "exact", questionId: "existing" });
  });
  it("flags a close medical variant but does not delete it", () => {
    const source = record("A patient with primary adrenal insufficiency has hypotension and hyperkalemia. Which hormone is deficient?");
    const incoming = draft("A patient with adrenal insufficiency has hypotension and severe hyperkalemia. Which hormone is deficient?");
    expect(findQuestionDuplicate(incoming, [source]).kind).toBe("likely");
    const [flagged] = flagImportDuplicates([incoming], [source]);
    expect(flagged.needsReview).toBe(true);
    expect(flagged.parserRuleIds).toContain("duplicate.likely-existing");
  });
  it("keeps a distinct question unflagged", () => {
    expect(flagImportDuplicates([draft("Which nerve supplies the diaphragm?", "Phrenic nerve")], [record("Which hormone raises sodium?")])[0].needsReview).toBeUndefined();
  });
});
