// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SourceDocument } from "../library";
import type { PackageQuestion } from "../question-content/package";
import { PRIVATE_REVIEW_DOCUMENT, type PreparedBank } from "./types";
import { summarizePrivateReviewBacklog } from "./reviewBacklog";

const SOURCE_CHECKSUM = "a".repeat(64);

function question(id: string, readiness: "ready" | "needs-review" | "unresolved"): PackageQuestion {
  return {
    id,
    source: { filename: "source.pdf", questionNumber: 1 },
    stem: [{ type: "text", text: "Which answer is supported?" }],
    choices: [
      { id: `${id}-a`, label: "A", blocks: [{ type: "text", text: "Alpha" }] },
      { id: `${id}-b`, label: "B", blocks: [{ type: "text", text: "Beta" }] },
    ],
    ...(readiness === "ready" ? { correctAnswer: { labels: ["A"], evidence: "printed-key" as const } } : {}),
    ...(readiness === "needs-review" ? {
      correctAnswer: { labels: ["A"], evidence: "answer-reveal-slide" as const },
      flags: [{ type: "answer_needs_review" as const, message: "Confirm the source mark." }],
    } : {}),
    assets: [],
    provenance: { method: "pdf-import", sourceChecksum: `sha256:${SOURCE_CHECKSUM}` },
  };
}

function bank(readiness: Array<"ready" | "needs-review" | "unresolved">, unreadableQuestions = 0): PreparedBank {
  return {
    pkg: {
      manifest: {
        schemaVersion: 2,
        course: { name: "RHPS", term: 4, week: 0 },
        bank: { id: "review-bank", title: "Review bank", discipline: "Medicine" },
        source: { filename: "source.pdf", sourceWeekDeclared: false },
        questionsFile: "questions.json",
        assetsDirectory: "assets",
      },
      questions: readiness.map((value, index) => question(`question-${index + 1}`, value)),
    },
    issues: [],
    sourceText: { rawText: "Retained source text" },
    sourceBytes: 20,
    notes: [],
    unreadableQuestions,
  };
}

function document(value: PreparedBank | string, patch: Partial<SourceDocument> = {}): SourceDocument {
  return {
    id: `private-review-${SOURCE_CHECKSUM}`,
    title: "Review bank",
    fileName: "source.pdf",
    fileType: PRIVATE_REVIEW_DOCUMENT,
    uploadedAt: "2026-10-23T12:00:00.000Z",
    rawText: typeof value === "string" ? value : JSON.stringify(value),
    sizeBytes: 20,
    tags: ["RHPS"],
    linkedQuestionSetIds: [],
    libraryOnly: true,
    ...patch,
  };
}

describe("private review backlog", () => {
  it("reassesses held questions and includes unreadable retained rows", () => {
    expect(summarizePrivateReviewBacklog([document(bank(["ready", "needs-review", "unresolved"], 2))])).toEqual({
      held: 4,
      needsReview: 1,
      unresolved: 1,
      unreadable: 2,
      sources: 1,
      invalidDocuments: 0,
      duplicateDocuments: 0,
    });
  });

  it("reports the installed RHPS readiness split as 496 held rows", () => {
    const readiness = [
      ...Array.from({ length: 19 }, () => "ready" as const),
      ...Array.from({ length: 489 }, () => "needs-review" as const),
      ...Array.from({ length: 7 }, () => "unresolved" as const),
    ];
    expect(summarizePrivateReviewBacklog([document(bank(readiness))])).toMatchObject({
      held: 496,
      needsReview: 489,
      unresolved: 7,
      unreadable: 0,
      sources: 1,
    });
  });

  it("counts one source once and prefers its newest valid review state", () => {
    const older = document(bank(["needs-review"]), { id: "legacy-copy", uploadedAt: "2026-10-22T12:00:00.000Z" });
    const reviewed = document(bank(["ready"]), { uploadedAt: "2026-10-24T12:00:00.000Z" });
    expect(summarizePrivateReviewBacklog([older, reviewed])).toMatchObject({
      held: 0,
      needsReview: 0,
      unresolved: 0,
      sources: 1,
      duplicateDocuments: 1,
    });
  });

  it("isolates malformed documents without hiding a valid source", () => {
    const malformed = document("{not-json", { id: "broken-review" });
    expect(summarizePrivateReviewBacklog([malformed, document(bank(["needs-review"]))])).toMatchObject({
      held: 1,
      sources: 1,
      invalidDocuments: 1,
    });
  });
});
