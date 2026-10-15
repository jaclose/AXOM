import { describe, expect, it } from "vitest";
import type { QuestionSet } from "../library";
import { questionMappingStatus, type QuestionRecord } from "../questions";
import {
  createQuestionSetShare,
  importSharedQuestionSet,
  sharedQuestionSetDigest,
  validateShare,
  type SharedQuestionSetSnapshot,
} from "./questionSetShare";

const SHARE_ID = "00000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);
const NOW = "2026-10-15T12:00:00.000Z";

function question(id: string, overrides: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id,
    source: "manual",
    stem: "Safe stem",
    options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
    correctKey: "B",
    correctAnswerText: "Two",
    explanation: "Safe explanation",
    status: "incorrect",
    userAnswerKey: "A",
    notes: "PRIVATE",
    annotations: [],
    attempts: [{ at: NOW, answerKey: "A", status: "incorrect" }],
    tags: ["cardio"],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function questionSet(questionIds = ["q1"]): QuestionSet {
  return {
    id: "set-source",
    title: "Shared",
    sourceDocumentIds: ["private-file"],
    createdAt: NOW,
    questionIds,
    tags: ["cardio"],
    aiEnhanced: false,
    parserWarnings: [],
  };
}

function snapshot(): SharedQuestionSetSnapshot {
  return createQuestionSetShare(questionSet(), [question("q1")], NOW);
}

describe("Question Set share boundary", () => {
  it("preserves order and excludes every learner-private or local association field", () => {
    const value = createQuestionSetShare(questionSet(), [question("q1", {
      courseId: "private-course",
      module: "private-module",
      sourceDocumentId: "private-file",
      setId: "private-set",
      attachments: [{
        id: "private-attachment",
        fileName: "private.png",
        mimeType: "image/png",
        byteSize: 1,
        altText: "Private",
        blobKey: "private-blob",
        createdAt: NOW,
        updatedAt: NOW,
      }],
    })], NOW);

    expect(value.orderedQuestionIds).toEqual(["shared-question-1"]);
    expect(JSON.stringify(value)).not.toContain('"q1"');
    expect(JSON.stringify(value)).not.toMatch(
      /PRIVATE|userAnswerKey|attempts|annotations|sourceDocumentIds|sourceDocumentId|courseId|module|setId|attachments|blobKey/,
    );
  });

  it("round-trips a historical v1 JSON snapshot with a stable content digest", async () => {
    const serialized = JSON.stringify(snapshot());
    const restored: unknown = JSON.parse(serialized);
    expect(() => validateShare(restored)).not.toThrow();
    expect(await sharedQuestionSetDigest(restored as SharedQuestionSetSnapshot))
      .toBe(await sharedQuestionSetDigest(snapshot()));
  });

  it("reuses only an exact safe-content match and leaves its learner history unchanged", () => {
    const existing = question("existing");
    const result = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [existing],
      now: NOW,
    });

    expect(result.reused).toBe(1);
    expect(result.questions).toEqual([]);
    expect(result.set.questionIds).toEqual(["existing"]);
    expect(existing.attempts).toEqual([{ at: NOW, answerKey: "A", status: "incorrect" }]);
    expect(existing.notes).toBe("PRIVATE");
  });

  it("does not conflate the same stem and choices when the answer or explanation differs", () => {
    const existing = question("existing", {
      correctKey: "A",
      correctAnswerText: "One",
      explanation: "A different safe explanation",
    });
    const result = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [existing],
      now: NOW,
    });

    expect(result.reused).toBe(0);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toMatchObject({
      source: "imported",
      correctKey: "B",
      correctAnswerText: "Two",
      explanation: "Safe explanation",
      status: "unseen",
      attempts: [],
    });
    expect(existing).toMatchObject({
      correctKey: "A",
      correctAnswerText: "One",
      explanation: "A different safe explanation",
      notes: "PRIVATE",
    });
  });

  it("constructs new questions from an explicit safe allowlist", () => {
    const result = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [],
      now: NOW,
    });
    const imported = result.questions[0];

    expect(imported).toMatchObject({
      source: "imported",
      stem: "Safe stem",
      correctKey: "B",
      sourceDocumentId: undefined,
      courseId: undefined,
      module: undefined,
      setId: undefined,
      attachments: undefined,
      notes: undefined,
      userAnswerKey: undefined,
      attempts: [],
    });
    expect(result.set).toMatchObject({
      sourceDocumentIds: [],
      parserWarnings: ["Imported from an unlisted Question Set link."],
      importProvenance: { version: 1, shareId: SHARE_ID, contentDigest: DIGEST },
    });
    expect(result.set).not.toHaveProperty("scope");
  });

  it("keeps distinct source memberships distinct when two questions have identical content", () => {
    const value = createQuestionSetShare(
      questionSet(["q1", "q2"]),
      [question("q1"), question("q2")],
      NOW,
    );
    const result = importSharedQuestionSet({
      snapshot: value,
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [question("existing")],
      now: NOW,
    });

    expect(result.set.questionIds).toHaveLength(2);
    expect(new Set(result.set.questionIds).size).toBe(2);
    expect(result.reused).toBe(1);
    expect(result.questions).toHaveLength(1);
  });

  it("imports an unanswered v1 question as explicitly non-scorable", () => {
    const unanswered = createQuestionSetShare(questionSet(), [question("q1", {
      correctKey: undefined,
      correctAnswerText: undefined,
    })], NOW);
    const result = importSharedQuestionSet({
      snapshot: unanswered,
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [],
      now: NOW,
    });

    expect(result.questions[0]).toMatchObject({ correctKey: undefined, needsReview: true });
    expect(questionMappingStatus(result.questions[0])).toBe("unresolved");
  });

  it("makes a repeated share import idempotent without replacing learner data", () => {
    const first = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [],
      now: NOW,
    });
    const learned = { ...first.questions[0], notes: "Keep me", attempts: [{ at: NOW, status: "correct" as const }] };
    const repeated = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [learned],
      existingSets: [first.set],
      now: "2026-10-16T12:00:00.000Z",
    });

    expect(repeated).toMatchObject({ set: first.set, questions: [], alreadyImported: true });
    expect(learned.notes).toBe("Keep me");
    expect(learned.attempts).toEqual([{ at: NOW, status: "correct" }]);
  });

  it("refuses to treat changed content under the same share ID as an idempotent replay", () => {
    const first = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [],
      now: NOW,
    });
    expect(() => importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: "b".repeat(64) },
      existingQuestions: first.questions,
      existingSets: [first.set],
      now: NOW,
    })).toThrow(/different content/i);
  });

  it.each(["courseId", "sourceDocumentId", "setId", "attachments", "notes", "userAnswerKey", "attempts"])(
    "rejects the forged local-only question field %s",
    (field) => {
      const forged = snapshot() as unknown as { questions: Array<Record<string, unknown>> };
      forged.questions[0][field] = field === "attachments" || field === "attempts" ? [] : "forged";
      expect(() => validateShare(forged)).toThrow(/unsupported field/i);
    },
  );

  it("rejects duplicate, missing, or reordered membership IDs", () => {
    const two = createQuestionSetShare(
      questionSet(["q1", "q2"]),
      [question("q1"), question("q2", { stem: "Second stem" })],
      NOW,
    );
    expect(() => validateShare({ ...two, orderedQuestionIds: ["shared-question-1"] })).toThrow(/membership is incomplete/i);
    expect(() => validateShare({ ...two, orderedQuestionIds: ["shared-question-1", "shared-question-1"] })).toThrow(/must be unique/i);
    expect(() => validateShare({ ...two, orderedQuestionIds: ["shared-question-2", "shared-question-1"] })).toThrow(/order does not match/i);
    expect(() => validateShare({ ...two, questions: [{ ...two.questions[0], id: "shared-question-1" }, { ...two.questions[1], id: "shared-question-1" }] }))
      .toThrow(/question IDs must be unique/i);
  });

  it("rejects malformed choices, answer mappings, and rationales", () => {
    const value = snapshot();
    expect(() => validateShare({
      ...value,
      questions: [{ ...value.questions[0], options: [null, value.questions[0].options[1]] }],
    }))
      .toThrow(/choice 1 must be an object/i);
    expect(() => validateShare({ ...value, questions: [{ ...value.questions[0], correctKey: "C", correctAnswerText: undefined }] }))
      .toThrow(/correct key does not match/i);
    expect(() => validateShare({ ...value, questions: [{ ...value.questions[0], correctAnswerText: "Wrong" }] }))
      .toThrow(/does not match its keyed choice/i);
    expect(() => validateShare({ ...value, questions: [{ ...value.questions[0], choiceRationales: { C: "No" } }] }))
      .toThrow(/rationale keys/i);
  });

  it("rejects a payload beyond the server's five-megabyte boundary", () => {
    expect(() => validateShare({ ...snapshot(), copyrightNotice: "x".repeat(5_000_001) }))
      .toThrow(/5 MB safety limit/i);
  });
});
