import { describe, expect, it } from "vitest";
import type { QuestionSet } from "./library";
import type { QuestionRecord } from "./questions";
import { captureMissingQuestionRecovery, inspectMissingQuestionRecovery } from "./questionRecovery";

const question = (id: string, needsReview = false): QuestionRecord => ({
  id, stem: "Same source wording", source: "imported", correctKey: "A", needsReview,
  options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  status: "unseen", tags: [], attempts: [], createdAt: "2026-10-17", updatedAt: "2026-10-17",
});
const collection = (): QuestionSet => ({
  id: "original", title: "Same source title", questionIds: ["present", "lost-b", "lost-a", "lost-b"],
  scope: { courseId: "course", module: "Neuro", week: 2 }, sourceDocumentIds: ["source"],
  createdAt: "2026-10-17", tags: [], aiEnhanced: false, parserWarnings: [],
});
const capture = (set = collection()) => captureMissingQuestionRecovery(set, new Map([["present", question("present")]]));

describe("exact missing-question recovery", () => {
  it("captures ordered unique missing IDs, excluding every existing record, without retaining mutable arrays", () => {
    const set = collection();
    const request = capture(set);
    expect(request.missingQuestionIds).toEqual(["lost-b", "lost-a"]);
    expect(request.expectedQuestionIds).toEqual(set.questionIds);
    set.questionIds.push("later");
    set.sourceDocumentIds.push("later-source");
    set.scope!.module = "Changed";
    expect(request.expectedQuestionIds).not.toContain("later");
    expect(request.sourceDocumentIds).toEqual(["source"]);
    expect(request.scope?.module).toBe("Neuro");
  });

  it("does not count same-text fresh IDs or expand immutable membership", () => {
    const set = collection();
    const before = structuredClone(set);
    const result = inspectMissingQuestionRecovery(capture(set), [set, { ...set, id: "fresh-set", questionIds: ["fresh"] }], [question("fresh")]);
    expect(result).toMatchObject({ state: "pending", restoredIds: [], remainingIds: ["lost-b", "lost-a"], ready: 0 });
    expect(set).toEqual(before);
  });

  it("reports exact partial and full recovery separately from answer readiness", () => {
    const set = collection();
    const request = capture(set);
    expect(inspectMissingQuestionRecovery(request, [set], [question("lost-a")])).toMatchObject({
      state: "pending", restoredIds: ["lost-a"], remainingIds: ["lost-b"], ready: 1, review: 0,
    });
    expect(inspectMissingQuestionRecovery(request, [set], [question("lost-a"), question("lost-b", true)])).toMatchObject({
      state: "complete", restoredIds: ["lost-b", "lost-a"], remainingIds: [], ready: 1, review: 1,
    });
  });

  it("never trusts another same-named collection or conflicting question identities", () => {
    const set = collection();
    expect(inspectMissingQuestionRecovery(capture(set), [{ ...set, id: "other" }], [])).toEqual({ state: "removed" });
    expect(inspectMissingQuestionRecovery(capture(set), [set, { ...set }], [])).toEqual({ state: "ambiguous" });
    expect(inspectMissingQuestionRecovery(capture(set), [set], [question("lost-a"), question("lost-a")])).toMatchObject({
      state: "pending", restoredIds: [], remainingIds: ["lost-b", "lost-a"], ambiguousIds: ["lost-a"],
    });
  });

  it.each<Partial<QuestionSet>>([
    { questionIds: ["present", "lost-a", "lost-b"] },
    { questionIds: ["present", "replacement"] },
    { sourceDocumentIds: ["other-source"] },
    { scope: { courseId: "other", module: "Neuro", week: 2 } },
    { scope: { courseId: "course", module: "Changed", week: 2 } },
    { scope: { courseId: "course", module: "Neuro", week: 3 } },
    { createdAt: "recreated" },
  ])("fails closed after original collection identity changes: %j", (change) => {
    const set = collection();
    expect(inspectMissingQuestionRecovery(capture(set), [{ ...set, ...change }], [question("lost-a"), question("lost-b")])).toEqual({ state: "changed" });
  });
});
