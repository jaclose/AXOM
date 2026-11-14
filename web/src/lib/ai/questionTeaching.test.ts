import { describe, expect, it, vi } from "vitest";
import type { AIProvider } from "./types";
import type { QuestionRecord } from "../questions";
import {
  draftQuestionExplanation, eligibleForExplanationDraft, questionExplanationFingerprint,
} from "./questionTeaching";

function question(patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: "q1", source: "manual", stem: "Which layer contains smooth muscle in an artery?",
    options: [{ key: "A", text: "Tunica media" }, { key: "B", text: "Tunica intima" },
      { key: "C", text: "Tunica adventitia" }],
    correctKey: "A", status: "unseen", tags: [], attempts: [],
    createdAt: "2026-11-06T12:00:00.000Z", updatedAt: "2026-11-06T12:00:00.000Z", ...patch,
  };
}
function provider(value: unknown): AIProvider {
  return {
    info: { kind: "openai-compat", label: "Test provider", local: false, requiresKey: false },
    available: vi.fn(async () => ({ ok: true, detail: "ready" })),
    completeJson: vi.fn(async () => value),
  };
}

describe("review-gated explanation drafting", () => {
  it("generates a draft and distractor rationales without editing the confirmed answer", async () => {
    const source = question({ citation: "Reviewed source, page 3" });
    const model = provider({
      explanation: "The tunica media contains layers of vascular smooth muscle that regulate vascular tone and resistance.",
      choiceRationales: {
        A: "The media contains the smooth muscle cells.",
        B: "The intima primarily contains endothelial lining.",
        C: "The adventitia is primarily connective tissue.",
      },
      keywords: ["Tunica media", "Vascular smooth muscle"],
    });
    const result = await draftQuestionExplanation(model, source);
    expect(result.questionId).toBe("q1");
    expect(result.explanation).toMatch(/vascular smooth muscle/);
    expect(result.choiceRationales.B).toMatch(/endothelial/);
    expect(result.sourceFingerprint).toBe(questionExplanationFingerprint(source));
    expect(result.keywords).toContain("tunica media");
    expect(model.completeJson).toHaveBeenCalledOnce();
    expect(source.explanation).toBeUndefined();
    expect(source.correctKey).toBe("A");
  });

  it("never sends unresolved answers or inaccessible image questions to a model", async () => {
    const model = provider({});
    await expect(draftQuestionExplanation(model, question({ correctKey: undefined }))).rejects.toThrow(/reviewed answer/i);
    await expect(draftQuestionExplanation(model, question({ attachments: [{ assetId: "image-1" }] as never }))).rejects.toThrow(/image|media/i);
    expect(model.completeJson).not.toHaveBeenCalled();
    expect(eligibleForExplanationDraft(question({ needsReview: true }))).toBe(false);
  });

  it("rejects fabricated keys, insufficient explanations and missing distractor rationales", async () => {
    const valid = question();
    await expect(draftQuestionExplanation(provider({
      explanation: "Very short", choiceRationales: { A: "Wrong" },
    }), valid)).rejects.toThrow(/explanation|rationale/i);
    await expect(draftQuestionExplanation(provider({
      explanation: "The arterial tunica media contains smooth muscle cells that adjust the vessel diameter and resistance.",
      choiceRationales: { A: "Correct", B: "Intima not media", C: "Adventitia not media", D: "Not a valid option" },
    }), valid)).rejects.toThrow(/choice|rationale/i);
  });

  it("does not draft over an existing author-written choice rationale", async () => {
    const source = question({ choiceRationales: { B: "The author has already written a distractor rationale." } });
    const model = provider({});
    expect(eligibleForExplanationDraft(source)).toBe(false);
    // Direct calls are still protected against overwriting authored work.
    await expect(draftQuestionExplanation(model, source)).rejects.toThrow(/existing|rationale/i);
    expect(model.completeJson).not.toHaveBeenCalled();
  });

  it.each([
    ["private file URI in stem", { stem: "Reference file:///Users/student/private-exam.pdf" }],
    ["private content provider in a choice", { options: [
      { key: "A", text: "content://private.provider/document/42" },
      { key: "B", text: "Benign control" }, { key: "C", text: "Second control" },
    ] }],
    ["browser object URL in topic", { topic: "blob:https://example.edu/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
    ["inlined PDF data in stem", { stem: "Exhibit data:application/pdf;base64,JVBERi0x" }],
    ["URL credentials in stem", { stem: "Source https://student:secret@example.edu/notes" }],
    ["encoded device URI in topic", { topic: "file%3A%2F%2F%2FUsers%2Fstudent%2Fprivate.pdf" }],
  ] as Array<[string, Partial<QuestionRecord>]>)(
    "blocks %s before external AI inference, even when called directly", async (_label, patch) => {
    const source = question(patch);
    const model = provider({});
    expect(eligibleForExplanationDraft(source)).toBe(false);
    await expect(draftQuestionExplanation(model, source))
      .rejects.toThrow(/private file|inline media|URL credentials/i);
    expect(model.completeJson).not.toHaveBeenCalled();
    // No local source fields, reviewed answer key, or question IDs are changed.
    expect(source.correctKey).toBe("A");
    expect(source.id).toBe("q1");
  });

  it("keeps ordinary clinical slash terms and public HTTPS citations eligible for AI drafts", async () => {
    const source = question({
      stem: "For the CD4/CD8 ratio in MHC I/II signaling, which arterial layer contains smooth muscle?",
      topic: "MHC I/II mechanisms",
      citation: "https://example.edu/teaching/arteries",
    });
    const model = provider({
      explanation: "The tunica media contains smooth muscle that determines vessel caliber and peripheral resistance.",
      choiceRationales: {
        A: "The media contains concentric vascular smooth muscle.",
        B: "The intima forms the endothelial inner lining.",
        C: "The adventitia is predominantly supporting connective tissue.",
      },
      keywords: ["vascular smooth muscle"],
    });
    expect(eligibleForExplanationDraft(source)).toBe(true);
    const result = await draftQuestionExplanation(model, source);
    expect(result.choiceRationales.B).toContain("endothelial");
    expect(model.completeJson).toHaveBeenCalledOnce();
  });

  it.each([
    ["confirmed answer", (source: QuestionRecord) => { source.correctKey = "B"; }],
    ["source citation", (source: QuestionRecord) => { source.citation = "Different source evidence"; }],
    ["distractor wording", (source: QuestionRecord) => { source.options[1].text = "Revised distractor"; }],
  ] as Array<[string, (source: QuestionRecord) => void]>)(
    "rejects an AI explanation when %s changes during provider inference", async (_field, revise) => {
      const source = question();
      let finish!: (result: unknown) => void;
      const pending = new Promise<unknown>(resolve => { finish = resolve; });
      const model = provider({});
      model.completeJson = vi.fn(() => pending);
      const generating = draftQuestionExplanation(model, source);
      expect(model.completeJson).toHaveBeenCalledOnce();
      expect(model.completeJson).toHaveBeenCalledWith(expect.objectContaining({
        prompt: expect.stringContaining("Confirmed answer: A. Tunica media"),
      }));
      // A concurrent edit arrives after the provider saw the verified key but
      // before its answer returns. No stale teaching proposal may be accepted.
      revise(source);
      finish({
        explanation: "The tunica media contains smooth muscle that regulates the vessel diameter and arterial resistance.",
        choiceRationales: {
          A: "The media contains concentric smooth muscle.",
          B: "The intima is primarily the endothelial lining.",
          C: "The adventitia is chiefly supporting connective tissue.",
        },
        keywords: ["arterial histology"],
      });
      await expect(generating).rejects.toThrow(/changed while.*draft/i);
      expect(source.explanation).toBeUndefined();
    },
  );

  it("does not contact the AI provider for an already-cancelled request", async () => {
    const source = question();
    const model = provider({});
    const controller = new AbortController();
    controller.abort();
    await expect(draftQuestionExplanation(model, source, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(model.completeJson).not.toHaveBeenCalled();
    expect(source.correctKey).toBe("A");
    expect(source.explanation).toBeUndefined();
  });

  it("discards a late AI response after cancellation even when the provider ignores the signal", async () => {
    const source = question();
    const controller = new AbortController();
    let finish!: (result: unknown) => void;
    const pending = new Promise<unknown>(resolve => { finish = resolve; });
    const model = provider({});
    model.completeJson = vi.fn(() => pending);
    const generating = draftQuestionExplanation(model, source, controller.signal);
    expect(model.completeJson).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
      prompt: expect.stringContaining("Confirmed answer: A. Tunica media"),
    }));
    controller.abort();
    finish({
      explanation: "The arterial tunica media contains smooth muscle which controls blood vessel diameter and resistance.",
      choiceRationales: {
        A: "The media contains the vascular smooth muscle cells.",
        B: "The intima predominantly contains the endothelial lining.",
        C: "The adventitia mainly provides connective tissue support.",
      },
      keywords: ["vascular smooth muscle"],
    });
    await expect(generating).rejects.toMatchObject({ name: "AbortError" });
    // Neither a late inference response nor cancellation edits source keys or prose.
    expect(source.correctKey).toBe("A");
    expect(source.explanation).toBeUndefined();
  });

  it.each([
    ["file URI in the explanation", {
      explanation: "The tunica media contracts to alter vascular resistance, as detailed in file:///Users/student/private-notes.pdf.",
    }],
    ["content URI in a choice rationale", {
      choiceRationales: {
        A: "The media contains arterial smooth muscle.",
        B: "The endothelial intima differs from the media; see content://private.provider/lesson/12.",
        C: "The adventitia supplies outer connective tissue.",
      },
    }],
    ["encoded private citation in the explanation", {
      explanation: "Smooth muscle in the tunica media regulates vessel caliber. Source: file%3A%2F%2F%2FUsers%2Fstudent%2Fprivate.pdf",
    }],
    ["browser object URL in a generated keyword", {
      keywords: ["vascular tone", "blob:https://example.edu/abcdef12"],
    }],
    ["credentials in a generated reference", {
      explanation: "The tunica media has the contractile smooth muscle layer; reference https://student:secret@example.edu/artery.",
    }],
  ] as Array<[string, Record<string, unknown>]>)(
    "rejects AI-generated %s instead of exposing unsafe draft text", async (_label, patch) => {
      const source = question();
      const model = provider({
        explanation: "The tunica media contains vascular smooth muscle that controls vessel diameter and resistance.",
        choiceRationales: {
          A: "Tunica media contains layers of vascular smooth muscle.",
          B: "Tunica intima primarily contains the endothelial lining.",
          C: "Tunica adventitia primarily provides supporting connective tissue.",
        },
        keywords: ["vascular smooth muscle"],
        ...patch,
      });
      await expect(draftQuestionExplanation(model, source))
        .rejects.toThrow(/private file|inline media|URL credentials/i);
      expect(model.completeJson).toHaveBeenCalledOnce();
      expect(source.correctKey).toBe("A");
      expect(source.explanation).toBeUndefined();
    },
  );

  it("permits public source links and clinical slash notation in generated draft prose", async () => {
    const model = provider({
      explanation: "The tunica media controls arterial caliber via vascular smooth muscle. Reference: https://example.edu/arterial-histology.",
      choiceRationales: {
        A: "The media has smooth muscle, unlike the other vessel wall layers.",
        B: "The intima has the endothelial lining, not the main muscle layer.",
        C: "The adventitia consists mainly of outer connective tissue support.",
      },
      keywords: ["cd4/cd8", "vascular smooth muscle"],
    });
    const result = await draftQuestionExplanation(model, question());
    expect(result.explanation).toContain("https://example.edu/arterial-histology");
    expect(result.keywords).toContain("cd4/cd8");
  });

  it("invalidates drafts when source evidence or provenance changes without a timestamp bump", () => {
    const original = question({
      sourceDocumentId: "source-pdf-1",
      sourcePage: 3,
      citation: "Source A, page 3",
      extraction: {
        confidence: "high", reviewed: true,
        answerEvidence: "Answer key A, page 3",
      },
    });
    const fingerprint = questionExplanationFingerprint(original);
    expect(questionExplanationFingerprint({ ...original, citation: "Unverified replacement citation" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, sourceDocumentId: "source-pdf-2" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, sourcePage: 4 })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, courseId: "reassigned-private-course" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, module: "private-module", week: 6 })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, setId: "different-source-set" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, bank: "restricted-institution-bank" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, createdAt: "2026-11-07T13:00:00.000Z" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, tags: ["private"] })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, objective: "New learning objective" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, extraction: { ...original.extraction!, reviewed: false } })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, extraction: {
      ...original.extraction!, answerEvidence: "Conflicting answer marker, page 3",
    } })).not.toBe(fingerprint);
  });

  it("invalidates an AI draft when rich source evidence changes without updating legacy text or timestamps", () => {
    const rich: NonNullable<QuestionRecord["content"]> = {
      id: "source-q-1",
      source: { filename: "vascular-source.pdf", page: 3 },
      stem: [{ type: "text", text: "Which layer contains arterial smooth muscle?" }],
      choices: [
        { id: "a", label: "A", blocks: [{ type: "text", text: "Tunica media" }] },
        { id: "b", label: "B", blocks: [{ type: "text", text: "Tunica intima" }] },
      ],
      assets: [],
      provenance: { method: "pdf-import", sourceChecksum: `sha256:${"a".repeat(64)}` },
    };
    const original = question({ content: rich });
    const fingerprint = questionExplanationFingerprint(original);
    expect(questionExplanationFingerprint({ ...original, content: { ...rich,
      provenance: { ...rich.provenance, sourceChecksum: `sha256:${"b".repeat(64)}` },
    } })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, content: { ...rich,
      stem: [{ type: "text", text: "Different source vignette under the same legacy stem" }],
    } })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, content: rich })).toBe(fingerprint);
  });

  it("invalidates previously applied AI drafts when source analyses or note media change without a timestamp bump", () => {
    // This is the optimistic retry state after a private draft was applied but
    // its vault receipt was not confirmed. Existing explanatory prose means
    // the normal eligibility gate is false; retry relies on its fingerprint.
    const applied = question({
      explanation: "AXOM AI-assisted explanation (verify against source): Synthetic first-pass mechanism.",
      choiceRationales: { A: "AXOM AI-assisted rationale: synthetic first-pass evidence." },
    });
    const appliedReceipt = questionExplanationFingerprint(applied);
    const mediaRevision = {
      ...applied,
      attachments: [{ assetId: "synthetic-new-image-exhibit" }] as never,
    };
    const teachingRevision = {
      ...applied,
      analyses: [{ sourceEvidence: "Synthetic reviewed source analysis was changed." }] as never,
    };
    expect(mediaRevision.updatedAt).toBe(applied.updatedAt);
    expect(teachingRevision.updatedAt).toBe(applied.updatedAt);
    expect(questionExplanationFingerprint(mediaRevision)).not.toBe(appliedReceipt);
    expect(questionExplanationFingerprint(teachingRevision)).not.toBe(appliedReceipt);
    // The same metadata must also invalidate a draft prepared before saving.
    const original = question();
    expect(questionExplanationFingerprint({ ...original, attachments: mediaRevision.attachments }))
      .not.toBe(questionExplanationFingerprint(original));
    expect(questionExplanationFingerprint({ ...original, analyses: teachingRevision.analyses }))
      .not.toBe(questionExplanationFingerprint(original));
    expect(eligibleForExplanationDraft({ ...original, attachments: mediaRevision.attachments })).toBe(false);
  });

  it("detects changed questions before accepting AI-generated explanations", () => {
    const original = question();
    const fingerprint = questionExplanationFingerprint(original);
    expect(questionExplanationFingerprint({ ...original, correctKey: "B" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, stem: "Changed stem" })).not.toBe(fingerprint);
    expect(questionExplanationFingerprint({ ...original, explanation: "User wrote a rationale" })).not.toBe(fingerprint);
  });
});
