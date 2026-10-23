import { describe, expect, it } from "vitest";
import { validateQuestionRecord } from "../questions";
import type { QuestionSet } from "../library";
import { prepareSelectedSetUpload, type SetLibraryDetails } from "./selectedSet";

const details: SetLibraryDetails = { title: "Synthetic transport", description: "Permitted synthetic acceptance content", module: "SAMPLE", term: "Term 1", topic: "Example", version: "v1", rights: "original" };
const result = validateQuestionRecord({ id: "private-question-id", stem: "Which label is first?", options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }], correctKey: "A", source: "manual", explanation: "A is the first label.", choiceRationales: { B: "B is the second label." }, tags: [], notes: "PRIVATE-NOTE-SENTINEL", annotations: [], attempts: [{ at: "2026-10-23T00:00:00Z", answerKey: "B", status: "incorrect" }], extraction: { reviewed: true, confidence: "high" } });
if (!result.ok || !result.value) throw new Error(result.errors.join(", "));
const question = result.value;
const set: QuestionSet = { id: "private-set-id", title: "Private original title", sourceDocumentIds: ["private-source-id"], questionIds: [question.id], tags: ["PRIVATE-TAG-SENTINEL"], aiEnhanced: false, createdAt: "2026-10-23T00:00:00Z", parserWarnings: [] };

describe("selected question set to the existing academic library", () => {
  it("constructs a validated private package while excluding learner and local identities", async () => {
    const prepared = await prepareSelectedSetUpload(set, [question], details);
    expect(prepared).toMatchObject({ questions: 1, images: 0, excludedNoteImages: 0 });
    expect(prepared.upload.metadata).toMatchObject({ title: details.title, ready_questions: 1, review_questions: 0 });
    expect(prepared.upload.provenance.weekAssignment).toBe("unassigned");
    const allText = prepared.upload.files.map(file => new TextDecoder().decode(file.bytes)).join("\n");
    for (const secret of ["PRIVATE-NOTE-SENTINEL", "PRIVATE-TAG-SENTINEL", "private-question-id", "private-set-id", "private-source-id", '"attempts"', '"annotations"']) expect(allText).not.toContain(secret);
    expect(allText).toContain("B is the second label.");
    expect(allText).toContain('"rights"');
    const repeat = await prepareSelectedSetUpload(set, [question], details);
    expect(repeat.upload.hash).toBe(prepared.upload.hash);
  });
  it("rejects partial membership and unresolved questions instead of silently uploading a subset", async () => {
    await expect(prepareSelectedSetUpload({ ...set, questionIds: [question.id, "missing"] }, [question], details)).rejects.toThrow(/Every selected question/);
    await expect(prepareSelectedSetUpload(set, [{ ...question, correctKey: undefined }], details)).rejects.toThrow(/Every selected question/);
  });
});
