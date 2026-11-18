import { describe, expect, it } from "vitest";
import {
  analyzeQuestionStyle, applyAttempt, dueQuestions, errorPatterns, filterForMode,
  questionCollectionMetrics, questionMappingStatus, summarizeQuestionMappings,
  validateQuestionRecord, weakTopics, type QuestionRecord,
} from "./questions";
import { parseQuestionText } from "./questionParse";
import { parseImport, toPortableState } from "./backup";
import { makeSeed, SCHEMA_VERSION } from "./seed";

function makeQuestion(patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: crypto.randomUUID(), source: "manual", stem: "A stem", options: [{ key: "A", text: "x" }, { key: "B", text: "y" }],
    correctKey: "A", status: "unseen", tags: [], attempts: [],
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

describe("question record validation", () => {
  it("rejects a payload with no stem", () => {
    const result = validateQuestionRecord({ options: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/stem/i);
  });

  it("rejects a correct answer that doesn't match an option", () => {
    const result = validateQuestionRecord({ stem: "q", options: [{ key: "A", text: "a" }], correctKey: "C" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/does not match/i);
  });

  it("auto-letters options missing keys and normalizes case", () => {
    const result = validateQuestionRecord({
      stem: "q", options: [{ text: "first" }, { text: "second" }], correctKey: "b",
    });
    expect(result.ok).toBe(true);
    expect(result.value?.options.map((o) => o.key)).toEqual(["A", "B"]);
    expect(result.value?.correctKey).toBe("B");
  });

  it("defaults unknown status/source safely rather than throwing", () => {
    const result = validateQuestionRecord({ stem: "q", options: [], status: "bogus", source: "bogus" });
    expect(result.ok).toBe(true);
    expect(result.value?.status).toBe("unseen");
    expect(result.value?.source).toBe("manual");
  });

  it("marks ai-generated source with a generated flag", () => {
    const result = validateQuestionRecord({ stem: "q", options: [], source: "ai-generated" });
    expect(result.value?.ai?.generated).toBe(true);
  });
});

describe("attempts + spaced review", () => {
  it("schedules a sooner review for a miss than for a correct answer", () => {
    const now = new Date("2026-07-07T08:00:00.000Z");
    const missed = applyAttempt(makeQuestion(), { status: "incorrect", answerKey: "B" }, now);
    const right = applyAttempt(makeQuestion(), { status: "correct", answerKey: "A" }, now);
    expect(missed.reviewDueAt! < right.reviewDueAt!).toBe(true);
    expect(missed.status).toBe("incorrect");
    expect(missed.attempts).toHaveLength(1);
  });

  it("amends the attempt when the same block run answers the question again", () => {
    const checkedAt = new Date("2026-07-07T08:00:00.000Z");
    const classifiedAt = new Date("2026-07-07T08:02:00.000Z");
    const checked = applyAttempt(makeQuestion(), { status: "incorrect", answerKey: "B", quizSessionId: "run-1", mode: "tutor" }, checkedAt);
    const classified = applyAttempt(checked, {
      status: "incorrect", answerKey: "B", errorType: "missed-clue", confidence: 2, quizSessionId: "run-1", mode: "tutor",
    }, classifiedAt);

    expect(classified.attempts).toHaveLength(1);
    // The answer keeps the time it was given; the review date does not drift.
    expect(classified.attempts[0]).toEqual({
      at: checkedAt.toISOString(), status: "incorrect", answerKey: "B", errorType: "missed-clue", confidence: 2,
      quizSessionId: "run-1", mode: "tutor",
    });
    expect(classified.attemptedAt).toBe(checkedAt.toISOString());
    expect(classified.reviewDueAt).toBe(checked.reviewDueAt);
    expect(classified.errorType).toBe("missed-clue");
    expect(classified.updatedAt).toBe(classifiedAt.toISOString());
  });

  it("clears a classification the same run set and then removed", () => {
    const now = new Date("2026-07-07T08:00:00.000Z");
    const classified = applyAttempt(makeQuestion(), { status: "incorrect", errorType: "overthinking", confidence: 4, quizSessionId: "run-1" }, now);
    const cleared = applyAttempt(classified, { status: "incorrect", quizSessionId: "run-1" }, now);

    expect(cleared.attempts[0].errorType).toBeUndefined();
    expect(cleared.errorType).toBeUndefined();
    expect(cleared.confidence).toBeUndefined();
  });

  it("counts a new run, and an attempt without a run, as a separate attempt", () => {
    const now = new Date("2026-07-07T08:00:00.000Z");
    const first = applyAttempt(makeQuestion(), { status: "incorrect", quizSessionId: "run-1" }, now);
    const retake = applyAttempt(first, { status: "correct", quizSessionId: "run-2" }, now);
    const manual = applyAttempt(applyAttempt(retake, { status: "correct" }, now), { status: "correct" }, now);

    expect(retake.attempts).toHaveLength(2);
    expect(manual.attempts).toHaveLength(4);
  });

  it("corrects an older run's attempt without overwriting the latest outcome", () => {
    const now = new Date("2026-07-07T08:00:00.000Z");
    const later = new Date("2026-07-08T08:00:00.000Z");
    const first = applyAttempt(makeQuestion(), { status: "incorrect", answerKey: "B", quizSessionId: "run-1" }, now);
    const second = applyAttempt(first, { status: "correct", answerKey: "A", quizSessionId: "run-2" }, later);
    const amended = applyAttempt(second, { status: "incorrect", answerKey: "C", errorType: "misread-stem", quizSessionId: "run-1" }, later);

    expect(amended.attempts.map((attempt) => attempt.answerKey)).toEqual(["C", "A"]);
    expect(amended.status).toBe("correct");
    expect(amended.userAnswerKey).toBe("A");
    expect(amended.reviewDueAt).toBe(second.reviewDueAt);
  });

  it("surfaces questions whose review is due", () => {
    const due = makeQuestion({ reviewDueAt: "2026-07-01T00:00:00.000Z" });
    const later = makeQuestion({ reviewDueAt: "2999-01-01T00:00:00.000Z" });
    expect(dueQuestions([due, later], new Date("2026-07-07")).map((q) => q.id)).toEqual([due.id]);
  });
});

describe("canonical question collection metrics", () => {
  it("keeps latest-attempt mastery separate from all-attempt historical accuracy", () => {
    const questions = [
      makeQuestion({
        id: "retried",
        attempts: [
          { at: "2026-07-08T10:00:00+02:00", answerKey: "B", status: "incorrect" },
          { at: "2026-07-08T09:30:00Z", answerKey: "A", status: "correct" },
        ],
      }),
      makeQuestion({
        id: "guessed",
        attempts: [{ at: "2026-07-09T10:00:00.000Z", answerKey: "A", status: "guessed" }],
      }),
      makeQuestion({ id: "unattempted" }),
    ];

    const metrics = questionCollectionMetrics(questions, 4);

    expect(metrics).toMatchObject({
      total: 4,
      completed: 2,
      remaining: 2,
      completionPct: 50,
      currentMasteryCorrect: 1,
      currentMasteryQuestions: 2,
      currentMasteryPct: 50,
      historicalCorrectAttempts: 1,
      historicalAttemptCount: 3,
      historicalAccuracyPct: 33,
      lastStudiedAt: "2026-07-09T10:00:00.000Z",
      missedQuestionIds: ["guessed"],
    });
  });

  it("ignores malformed timestamps for recency and latest-attempt selection when valid history exists", () => {
    const question = makeQuestion({
      id: "mixed-timestamps",
      attemptedAt: "not-a-date",
      attempts: [
        { at: "2026-07-08T10:00:00.000Z", answerKey: "A", status: "correct" },
        { at: "also-not-a-date", answerKey: "B", status: "incorrect" },
      ],
    });

    const metrics = questionCollectionMetrics([question]);
    expect(metrics.lastStudiedAt).toBe("2026-07-08T10:00:00.000Z");
    expect(metrics.currentMasteryPct).toBe(100);
    expect(metrics.missedQuestionIds).toEqual([]);
  });
});

describe("mapping readiness", () => {
  it("classifies and summarizes unresolved, review-suggested, and ready questions", () => {
    const unresolvedMissingKey = makeQuestion({ id: "missing", correctKey: undefined });
    const unresolvedFlagged = makeQuestion({
      id: "flagged",
      needsReview: true,
      extraction: { confidence: "high", reviewed: true },
    });
    const reviewSuggested = makeQuestion({
      id: "suggested",
      extraction: { confidence: "medium", reviewed: false },
    });
    const confirmed = makeQuestion({
      id: "confirmed",
      extraction: { confidence: "high", reviewed: true },
    });
    const legacy = makeQuestion({ id: "legacy", extraction: undefined });
    const questions = [unresolvedMissingKey, unresolvedFlagged, reviewSuggested, confirmed, legacy];
    const before = structuredClone(questions);

    expect(questionMappingStatus(unresolvedMissingKey)).toBe("unresolved");
    expect(questionMappingStatus(unresolvedFlagged)).toBe("unresolved");
    expect(questionMappingStatus(reviewSuggested)).toBe("review-suggested");
    expect(questionMappingStatus(confirmed)).toBe("ready");
    expect(questionMappingStatus(legacy)).toBe("ready");
    expect(summarizeQuestionMappings(questions)).toEqual({
      ready: 2,
      reviewSuggested: 1,
      unresolved: 2,
      issueCount: 3,
      issueQuestionIds: ["missing", "flagged", "suggested"],
      reviewSuggestedQuestionIds: ["suggested"],
      unresolvedQuestionIds: ["missing", "flagged"],
    });
    expect(questions).toEqual(before);
  });

  it("never calls malformed keyed answer choices ready across the canonical question and set metrics", () => {
    const malformed = [
      makeQuestion({ id: "wrong-answer", correctKey: "Z" }),
      makeQuestion({ id: "repeated-choice", options: [{ key: "A", text: "First" }, { key: "A", text: "Second" }] }),
      makeQuestion({ id: "blank-key", options: [{ key: "A", text: "First" }, { key: " ", text: "Second" }] }),
      makeQuestion({ id: "single-choice", options: [{ key: "A", text: "Only" }] }),
      makeQuestion({ id: "missing-options", options: undefined as unknown as QuestionRecord["options"] }),
    ];
    for (const question of malformed) {
      expect(questionMappingStatus(question), question.id).toBe("unresolved");
    }
    expect(summarizeQuestionMappings(malformed)).toMatchObject({
      ready: 0, reviewSuggested: 0, unresolved: 5, issueCount: 5,
      unresolvedQuestionIds: malformed.map((question) => question.id),
    });
    // A valid manually entered question remains runnable without import metadata.
    expect(questionMappingStatus(makeQuestion({ id: "valid" }))).toBe("ready");
  });

  it("holds malformed option displays and visually colliding answer keys without changing stored evidence", () => {
    // Portable/legacy records may reach this classifier without running the current authoring validator.
    const invalid = [
      makeQuestion({ id: "blank-keyed-choice", options: [
        { key: "A", text: "   " }, { key: "B", text: "Valid distractor" },
      ] }),
      makeQuestion({ id: "blank-distractor", options: [
        { key: "A", text: "Valid answer" }, { key: "B", text: "" },
      ] }),
      makeQuestion({ id: "nonstring-distractor", options: [
        { key: "A", text: "Valid answer" }, { key: "B", text: 42 as unknown as string },
      ] }),
      makeQuestion({ id: "case-colliding-keys", options: [
        { key: "A", text: "Valid answer" }, { key: "a", text: "Other choice" },
      ] }),
      makeQuestion({ id: "unicode-colliding-keys", options: [
        { key: "A", text: "Valid answer" }, { key: "Ａ", text: "Other choice" },
      ] }),
    ];
    const before = structuredClone(invalid);
    expect(invalid.map(questionMappingStatus)).toEqual(Array(invalid.length).fill("unresolved"));
    expect(summarizeQuestionMappings(invalid)).toMatchObject({
      ready: 0, unresolved: invalid.length, issueCount: invalid.length,
      unresolvedQuestionIds: invalid.map((question) => question.id),
    });
    expect(filterForMode(invalid, "mapping-review").map((question) => question.id))
      .toEqual(invalid.map((question) => question.id));
    expect(invalid).toEqual(before);

    // Preserve distinct answer keys, including a legacy all-lowercase mapping.
    expect(questionMappingStatus(makeQuestion())).toBe("ready");
    expect(questionMappingStatus(makeQuestion({
      correctKey: "a", options: [{ key: "a", text: "Answer" }, { key: "b", text: "Distractor" }],
    }))).toBe("ready");
  });

  it("holds reviewed current-schema and legacy questions when saved answer text contradicts the keyed option", () => {
    const currentSchema = makeQuestion({
      id: "current-schema-conflict", source: "imported", correctKey: "A",
      options: [{ key: "A", text: "Tunica media" }, { key: "B", text: "Tunica intima" }],
      correctAnswerText: "Tunica intima", needsReview: false,
      extraction: { confidence: "high", reviewed: true },
    });
    const legacy = makeQuestion({ id: "legacy-conflict", source: "imported", correctAnswerText: "different answer" });
    const malformed = makeQuestion({
      id: "nonstring-saved-text",
      correctAnswerText: 42 as unknown as QuestionRecord["correctAnswerText"],
    });
    const questions = [currentSchema, legacy, malformed];
    const before = structuredClone(questions);

    for (const question of questions) {
      expect(questionMappingStatus(question), question.id).toBe("unresolved");
    }
    expect(summarizeQuestionMappings(questions)).toMatchObject({
      ready: 0, reviewSuggested: 0, unresolved: 3, issueCount: 3,
      unresolvedQuestionIds: questions.map((question) => question.id),
    });
    expect(filterForMode(questions, "mapping-review").map((question) => question.id))
      .toEqual(questions.map((question) => question.id));
    // Never silently rekey the question or erase the saved contradictory evidence.
    expect(questions).toEqual(before);
  });

  it("treats blank display text as absent evidence, but still requires independent extraction review", () => {
    const noDisplay = makeQuestion({
      id: "historical-absent", correctAnswerText: undefined,
      extraction: { confidence: "high", reviewed: true },
    });
    const matching = makeQuestion({
      id: "matching-display", correctAnswerText: "  x  ",
      extraction: { confidence: "high", reviewed: true },
    });
    const whitespace = makeQuestion({
      id: "current-schema-blank", correctAnswerText: "   ",
      extraction: { confidence: "high", reviewed: true },
    });
    const unreviewed = makeQuestion({
      id: "unreviewed-blank", correctAnswerText: "\t",
      extraction: { confidence: "medium", reviewed: false },
    });
    expect(questionMappingStatus(noDisplay)).toBe("ready");
    expect(questionMappingStatus(matching)).toBe("ready");
    expect(questionMappingStatus(whitespace)).toBe("ready");
    expect(questionMappingStatus(unreviewed)).toBe("review-suggested");
    expect(summarizeQuestionMappings([noDisplay, matching, whitespace, unreviewed]))
      .toMatchObject({ ready: 3, reviewSuggested: 1, unresolved: 0, issueCount: 1 });
    expect(whitespace.correctAnswerText).toBe("   ");
  });

  it("distinguishes independent extracted evidence from a manually authored stale display label", () => {
    const manual = makeQuestion({
      id: "manual-sixth-choice", source: "manual", correctKey: "F",
      options: ["A", "B", "C", "D", "E", "F"].map((key) => ({
        key, text: key === "F" ? "Foxtrot" : `Option ${key}`,
      })),
      correctAnswerText: "Beta", // Old display text does not identify another option.
    });
    const authoredSynonym = makeQuestion({
      id: "manual-synonym", source: "manual", correctAnswerText: "Rhinovirus",
      options: [{ key: "A", text: "Human rhinovirus" }, { key: "B", text: "Influenza" }],
    });
    const namedOtherChoice = makeQuestion({
      id: "manual-conflict", source: "manual", correctAnswerText: "y",
    });
    const imported = { ...manual, source: "imported" as const };
    const extracted = { ...manual, extraction: { confidence: "high" as const, reviewed: true } };
    const before = structuredClone([manual, authoredSynonym, namedOtherChoice, imported, extracted]);

    expect(questionMappingStatus(manual)).toBe("ready");
    expect(questionMappingStatus(authoredSynonym)).toBe("ready");
    expect(questionMappingStatus(namedOtherChoice)).toBe("unresolved");
    expect(questionMappingStatus(imported)).toBe("unresolved");
    expect(questionMappingStatus(extracted)).toBe("unresolved");
    expect([manual, authoredSynonym, namedOtherChoice, imported, extracted]).toEqual(before);
  });

  it("holds manual answer displays naming another choice by case or Unicode compatibility form", () => {
    const options = [{ key: "A", text: "Human rhinovirus" }, { key: "B", text: "Influenza" }];
    const contradictoryDisplays = [
      "Influenza", "influenza", "INFLUENZA", " influenza ",
      "ＩＮＦＬＵＥＮＺＡ", "ｉｎｆｌｕｅｎｚａ",
    ];
    const conflicts = contradictoryDisplays.map((correctAnswerText, index) => makeQuestion({
      id: `case-alternate-${index}`, source: "manual", options, correctKey: "A",
      correctAnswerText,
    }));
    const manualAlias = makeQuestion({
      id: "manual-benign-alias", source: "manual", options, correctKey: "A",
      correctAnswerText: "Rhinovirus",
    });
    const manualKeyCase = makeQuestion({
      id: "manual-key-case", source: "manual", options, correctKey: "A",
      correctAnswerText: "HUMAN RHINOVIRUS",
    });
    const importedAlias = makeQuestion({
      id: "imported-stale-label", source: "imported", options, correctKey: "A",
      correctAnswerText: "Rhinovirus", extraction: { confidence: "high", reviewed: true },
    });
    const questions = [...conflicts, manualAlias, manualKeyCase, importedAlias];
    const unchanged = structuredClone(questions);
    expect(conflicts.map(questionMappingStatus)).toEqual(
      Array(contradictoryDisplays.length).fill("unresolved"),
    );
    expect(questionMappingStatus(manualAlias)).toBe("ready");
    expect(questionMappingStatus(manualKeyCase)).toBe("ready");
    expect(questionMappingStatus(importedAlias)).toBe("unresolved");
    expect(summarizeQuestionMappings(questions)).toMatchObject({
      ready: 2, unresolved: contradictoryDisplays.length + 1,
    });
    expect(filterForMode(questions, "mapping-review").map((question) => question.id))
      .toEqual([...conflicts, importedAlias].map((question) => question.id));
    expect(questions).toEqual(unchanged); // No answer, key, option, or attempt rewritten.
  });

  it("keeps blank-display eligibility consistent across legacy and current portable schemas", () => {
    const portable = toPortableState(makeSeed());
    const sourceQuestion = makeQuestion({
      id: "same-blank-source", correctAnswerText: "   ",
      extraction: { confidence: "high", reviewed: true },
      attempts: [{ at: "2026-11-01T10:00:00.000Z", answerKey: "B", status: "incorrect" }],
    });
    const original = structuredClone(sourceQuestion);
    const restored = [31, SCHEMA_VERSION].map((schemaVersion) => parseImport(JSON.stringify({
      _app: "AXOM", ...portable, schemaVersion, questions: [sourceQuestion],
    })).questions[0]);
    expect(restored.map(questionMappingStatus)).toEqual(["ready", "ready"]);
    expect(restored[0].correctAnswerText).toBe("x"); // Legacy backfills a missing display answer.
    expect(restored[1].correctAnswerText).toBe("   "); // Current schema preserves raw evidence.
    for (const question of restored) {
      expect(question).toMatchObject({
        id: original.id, correctKey: original.correctKey,
        options: original.options, attempts: original.attempts,
        extraction: { reviewed: true },
      });
    }
    expect(sourceQuestion).toEqual(original);
  });

  it("treats a repaired mapping as ready even when its practice status is stale", () => {
    const repaired = makeQuestion({
      status: "needs-review",
      correctKey: "A",
      needsReview: false,
      extraction: { confidence: "low", reviewed: true },
    });

    expect(questionMappingStatus(repaired)).toBe("ready");
    expect(summarizeQuestionMappings([repaired]).issueCount).toBe(0);
  });

  it("uses the canonical mapping classifier for mapping-review mode", () => {
    const unresolved = makeQuestion({ id: "unresolved", correctKey: undefined });
    const suggested = makeQuestion({
      id: "suggested",
      extraction: { confidence: "medium", reviewed: false },
    });
    const ready = makeQuestion({
      id: "ready",
      extraction: { confidence: "high", reviewed: true },
    });

    expect(filterForMode([ready, unresolved, suggested], "mapping-review").map((question) => question.id))
      .toEqual(["unresolved", "suggested"]);
  });
});

describe("modes + pattern surfacing", () => {
  it("repeat-offenders needs two or more misses", () => {
    const once = makeQuestion({ attempts: [{ at: "t", status: "incorrect" }] });
    const twice = makeQuestion({ attempts: [{ at: "t", status: "incorrect" }, { at: "t2", status: "incorrect" }] });
    const result = filterForMode([once, twice], "repeat-offenders");
    expect(result.map((q) => q.id)).toEqual([twice.id]);
  });

  it("ranks weak topics by miss rate", () => {
    const qs = [
      makeQuestion({ topic: "Complement", attempts: [{ at: "t", status: "incorrect" }, { at: "t2", status: "incorrect" }] }),
      makeQuestion({ topic: "Renal", attempts: [{ at: "t", status: "correct" }, { at: "t2", status: "incorrect" }] }),
    ];
    const weak = weakTopics(qs);
    expect(weak[0].topic).toBe("Complement");
    expect(weak[0].missRate).toBe(1);
  });

  it("aggregates error patterns by why, not just count", () => {
    const qs = [
      makeQuestion({ attempts: [{ at: "t", status: "incorrect", errorType: "misread-stem" }] }),
      makeQuestion({ attempts: [{ at: "t", status: "incorrect", errorType: "misread-stem" }] }),
      makeQuestion({ attempts: [{ at: "t", status: "incorrect", errorType: "knowledge-gap" }] }),
    ];
    const patterns = errorPatterns(qs);
    expect(patterns[0].errorType).toBe("misread-stem");
    expect(patterns[0].count).toBe(2);
  });
});

describe("faculty style analyzer", () => {
  it("refuses to over-claim on a tiny sample", () => {
    const report = analyzeQuestionStyle([makeQuestion()]);
    expect(report.reliable).toBe(false);
    expect(report.findings).toHaveLength(0);
  });

  it("reports hedged structural findings on a real sample", () => {
    const qs = Array.from({ length: 14 }, (_, i) =>
      makeQuestion({ id: String(i), stem: "A 40-year-old presents with X. What is the most likely diagnosis?", topic: "Cardio" }));
    const report = analyzeQuestionStyle(qs);
    expect(report.reliable).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
    // Hedged language, never certainty about intent.
    const text = (report.findings.map((f) => f.detail).join(" ") + report.suggestion).toLowerCase();
    expect(text).not.toContain("the professor wants");
    expect(text).toMatch(/appears|may|frequently/);
  });
});

describe("paste parser (honest extraction)", () => {
  it("splits a standard stem/options/answer/explanation block", () => {
    const draft = parseQuestionText(
      "A 45-year-old man presents with fatigue.\nA. Iron deficiency\nB. B12 deficiency\nC. Folate deficiency\nD. Anemia of chronic disease\nAnswer: B\nExplanation: Low B12 causes macrocytosis.",
    );
    expect(draft.stem).toContain("45-year-old");
    expect(draft.options).toHaveLength(4);
    expect(draft.correctKey).toBe("B");
    expect(draft.explanation).toContain("macrocytosis");
    expect(draft.confidence).toBe("high");
  });

  it("never invents an answer — leaves it unset and warns", () => {
    const draft = parseQuestionText("What is the capital?\nA. Paris\nB. London");
    expect(draft.correctKey).toBeUndefined();
    expect(draft.warnings.join(" ")).toMatch(/no correct answer/i);
    expect(draft.confidence).not.toBe("high");
  });

  it("flags missing options as low confidence", () => {
    const draft = parseQuestionText("Just a sentence with no options at all.");
    expect(draft.options).toHaveLength(0);
    expect(draft.confidence).toBe("low");
  });
});
