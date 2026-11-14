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

  it("refuses ambiguous selected source records regardless of which answer appears last", () => {
    const first = question("q1", { correctKey: "A", correctAnswerText: "One" });
    const second = question("q1", { correctKey: "B", correctAnswerText: "Two" });
    const originals = JSON.stringify([first, second]);
    for (const bank of [[first, second], [second, first]]) {
      expect(() => createQuestionSetShare(questionSet(), bank, NOW))
        .toThrow(/ambiguous duplicate source question records/i);
    }
    expect(JSON.stringify([first, second])).toBe(originals);
  });

  it("refuses repeated source membership even though share-local IDs would differ", () => {
    const original = question("q1");
    expect(() => createQuestionSetShare(
      questionSet(["q1", "q1"]), [original], NOW,
    )).toThrow(/duplicate source question IDs/i);
    expect(original.correctKey).toBe("B");
  });

  it.each([
    ["file URI", "file:///Users/example/private-course.pdf"],
    ["macOS path", "Internal source /Users/example/private-course.pdf"],
    ["Linux home path", "/home/example/private-course.pdf"],
    ["Windows drive path", "C:\\Users\\Example\\private-course.pdf"],
    ["Android content URI", "content://com.example.provider/document/42"],
    ["network file share", "\\\\campus-server\\share\\private-course.pdf"],
    ["label-adjacent local path", "source:/Users/Example/private.pdf"],
    ["label-adjacent drive", "source=C:\\Users\\Example\\private.pdf"],
    ["encoded local URI", "file%3A%2F%2F%2FUsers%2FExample%2Fprivate.pdf"],
    ["external disk", "/Volumes/JDabSSD/private.pdf"],
    ["Linux external mount", "/mnt/private-source/file.pdf"],
    ["root directory", "source:/root/study/private.pdf"],
    ["temporary directory", "source:/tmp/private.pdf"],
    ["iOS mobile directory", "/var/mobile/Containers/private.pdf"],
    ["Android storage", "/storage/emulated/0/private.pdf"],
    ["opt directory", "source:/opt/exams/private.pdf"],
    ["arbitrary absolute folder", "source:/unpublished/private.pdf"],
    ["slash-style network share", "//campus-server/share/private.pdf"],
    ["encoded arbitrary root", "source%3A%2Froot%2Fprivate.pdf"],
    ["URL basic-auth password", "https://learner:private-password@example.edu/lesson"],
    ["URL email identity", "https://learner@example.edu/lesson"],
    ["percent-encoded userinfo", "https://learner%3Asecret%40example.edu/lesson"],
    ["percent-encoded URL and authority", "https%3A%2F%2Flearner%40example.edu%2Flesson"],
    ["nested userinfo URL in query", "https://example.edu/redirect?to=https://learner:secret@other.edu/lesson"],
    ["nested local file URI in public URL", "https://example.edu/redirect?source=file:///Users/learner/private.pdf"],
    ["nested Android content URI in public URL", "https://example.edu/view?source=content://private.documents/item/1"],
    ["encoded nested local file URI", "https://example.edu/view?source=file%3A%2F%2F%2FUsers%2Flearner%2Fprivate.pdf"],
    ["double-encoded nested local URI", "https://example.edu/view?source=file%253A%252F%252F%252FUsers%252Flearner%252Fprivate.pdf"],
    ["embedded PDF data URI", "data:application/pdf;base64,JVBERi0x"],
    ["embedded text data URI", "data:text/plain;charset=utf-8;base64,YWJj"],
    ["empty-media-type data URI", "data:,private%20notes"],
    ["browser object URL", "blob:https://example.edu/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
    ["opaque-origin object URL", "blob:null/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
    ["nested encoded inline document", "https://example.edu/view?src=data%3Aapplication%2Fpdf%3Bbase64%2CJVBERi0x"],
    ["double-encoded object URL", "https://example.edu/view?src=blob%253Ahttps%253A%252F%252Fexample.edu%252Fprivate"],
    ["four-layer encoded inline PDF", "https://example.edu/view?src=data%2525253Aapplication%2525252Fpdf%2525253Bbase64%2525252CJVBERi0x"],
    ["five-layer encoded inline PDF", "https://example.edu/view?src=data%252525253Aapplication%252525252Fpdf%252525253Bbase64%252525252CJVBERi0x"],
    ["twelve-layer encoded inline PDF", "https://example.edu/view?src=data%25252525252525252525253Aapplication%25252525252525252525252Fpdf%25252525252525252525253Bbase64%25252525252525252525252CJVBERi0x"],
    ["five-layer encoded browser object URL", "https://example.edu/view?src=blob%252525253Ahttps%252525253A%252525252F%252525252Fexample.edu%252525252Fprivate"],
    ["five-layer encoded private file URI", "https://example.edu/view?src=file%252525253A%252525252F%252525252F%252525252FUsers%252525252Flearner%252525252Fprivate.pdf"],
    ["four-layer fully escaped scheme", "https://example.edu/view?src=%2525252564%2525252561%2525252574%2525252561%252525253Aapplication%252525252Fpdf%252525253Bbase64%252525252CJVBERi0x"],
  ])("refuses %s citation in a new public snapshot without modifying source evidence", (_label, citation) => {
    const source = question("q1", { citation });
    const before = JSON.stringify(source);
    expect(() => createQuestionSetShare(questionSet(), [source], NOW))
      .toThrow(/citation contains a private local file path/i);
    expect(JSON.stringify(source)).toBe(before);
    expect(source.correctKey).toBe("B");
  });

  it.each([
    ["access token query", "https://example.edu/histology?access_token=DEMO_NOT_SECRET"],
    ["API key query", "https://example.edu/histology?api_key=DEMO_NOT_SECRET"],
    ["fragment token", "https://example.edu/histology#token=DEMO_NOT_SECRET"],
    ["encoded key", "https://example.edu/histology?%61pi%5fkey=DEMO_NOT_SECRET"],
    ["double-encoded key", "https://example.edu/histology?%2561pi%255fkey=DEMO_NOT_SECRET"],
    ["nested redirect token", "https://example.edu/redirect?next=https%3A%2F%2Fstudy.example.edu%2F%3Ftoken%3DDEMO_NOT_SECRET"],
    ["client secret query", "https://example.edu/lesson?client_secret=DEMO_NOT_SECRET"],
    ["S3 presigned signature", "https://bucket.s3.amazonaws.com/lecture.pdf?X-Amz-Signature=DEMO_NOT_SECRET"],
    ["S3 temporary security token", "https://bucket.s3.amazonaws.com/lecture.pdf?X-Amz-Security-Token=DEMO_NOT_SECRET"],
    ["Google Cloud signed signature", "https://storage.googleapis.com/bucket/case.png?X-Goog-Signature=DEMO_NOT_SECRET"],
    ["Azure SAS signature", "https://cdn.example.edu/case.pdf?sv=2026-01-01&sig=DEMO_NOT_SECRET"],
    ["legacy signed URL signature", "https://example.edu/lesson?Signature=DEMO_NOT_SECRET"],
    ["encoded signed parameter", "https://example.edu/lesson?X%2DAmz%2DSignature=DEMO_NOT_SECRET"],
    ["double-encoded signed parameter", "https://example.edu/lesson?X%252DAmz%252DSignature=DEMO_NOT_SECRET"],
    ["comma in query before bearer token", "https://example.edu/case?q=CD4,CD8&token=DEMO_NOT_SECRET"],
    ["comma in path before signed grant", "https://example.edu/case,figure2?X-Amz-Signature=DEMO_NOT_SECRET"],
    ["comma in HTTP userinfo", "https://student,team:demo-password@example.edu/lesson"],
    ["semicolon in HTTP userinfo", "https://student;team:demo-password@example.edu/lesson"],
  ])("holds %s in source citations before creating a public Question Set", (_label, citation) => {
    const source = question("q1", { citation });
    const initial = JSON.stringify(source);
    expect(() => createQuestionSetShare(questionSet(), [source], NOW))
      .toThrow(/citation contains a private local file path/i);
    expect(JSON.stringify(source)).toBe(initial);
  });

  it.each([
    "https://example.edu/research?source=/home/public-notes",
    "https://example.edu/tmp/lecture.pdf",
    "DOI:10.1000/abc",
    "https://example.edu/paper?q=learner@example.edu",
    "https://example.edu/@editor/chapter",
    "https://example.edu/paper#author@university",
    "Data: available upon request",
    "https://example.edu/paper?format=data",
    "https://example.edu/paper?term=alpha%3Abeta&name=%C3%A9tude",
    "https://example.edu/paper?q=CD4,CD8&format=public",
    "https://example.edu/case,figure2?format=public",
    "DOI: 10.1000/escaped%2520space",
  ])("preserves public path-like sources (%s)", citation => {
    const value = createQuestionSetShare(questionSet(), [question("q1", { citation })], NOW);
    expect(value.questions[0].citation).toBe(citation);
    expect(value.questions[0].correctKey).toBe("B");
  });

  it("retains legitimate public web and bibliographic citations in a shared snapshot", () => {
    const citation = "PMID: 123456; DOI: 10.1000/example; https://example.edu/medical/lecture";
    const value = createQuestionSetShare(questionSet(), [question("q1", { citation })], NOW);
    expect(value.questions[0].citation).toBe(citation);
    expect(value.questions[0].correctKey).toBe("B");
  });

  it("ignores duplicate bank IDs that are not members of the shared set", () => {
    const value = createQuestionSetShare(questionSet(), [
      question("q1"), question("outside", { correctKey: "A", correctAnswerText: "One" }),
      question("outside"),
    ], NOW);
    expect(value.orderedQuestionIds).toEqual(["shared-question-1"]);
    expect(value.questions).toHaveLength(1);
    expect(value.questions[0].correctKey).toBe("B");
  });

  it("refuses inconsistent stored source answer text rather than silently recomputing it", () => {
    const source = question("q1", { correctKey: "B", correctAnswerText: "One" });
    const original = JSON.stringify(source);
    expect(() => createQuestionSetShare(questionSet(), [source], NOW))
      .toThrow(/source answer text conflicts with its keyed choice/i);
    expect(JSON.stringify(source)).toBe(original);
    expect(source.correctKey).toBe("B");
  });

  it("rejects stale display text without a key but permits a valid key-only source", () => {
    expect(() => createQuestionSetShare(questionSet(), [question("q1", {
      correctKey: undefined, correctAnswerText: "Two",
    })], NOW)).toThrow(/source answer text conflicts/i);
    const keyOnly = question("q1", { correctAnswerText: undefined });
    const shared = createQuestionSetShare(questionSet(), [keyOnly], NOW);
    expect(shared.questions[0]).toMatchObject({ correctKey: "B", correctAnswerText: "Two" });
    expect(keyOnly.correctAnswerText).toBeUndefined();
  });

  it("does not let unrelated corrupt answer text block a healthy selected set", () => {
    const shared = createQuestionSetShare(questionSet(), [
      question("q1"), question("unselected", { correctAnswerText: "One" }),
    ], NOW);
    expect(shared.orderedQuestionIds).toEqual(["shared-question-1"]);
    expect(shared.questions[0].correctKey).toBe("B");
  });

  it("round-trips a historical v1 JSON snapshot with a stable content digest", async () => {
    const serialized = JSON.stringify(snapshot());
    const restored: unknown = JSON.parse(serialized);
    expect(() => validateShare(restored)).not.toThrow();
    expect(await sharedQuestionSetDigest(restored as SharedQuestionSetSnapshot))
      .toBe(await sharedQuestionSetDigest(snapshot()));
  });

  it("refuses inbound reuse when persisted answer text contradicts the key", () => {
    const stale = question("existing", { correctKey: "B", correctAnswerText: "One" });
    const untouched = JSON.stringify(stale);
    expect(() => importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [stale],
      now: NOW,
    })).toThrow(/matching local question has conflicting source answer text/i);
    expect(JSON.stringify(stale)).toBe(untouched);
    expect(stale.notes).toBe("PRIVATE");
    expect(stale.attempts).toHaveLength(1);
  });

  it("rejects replay if an imported member now has contradictory stored answer evidence", () => {
    const first = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [],
      now: NOW,
    });
    const corrupted = { ...first.questions[0], correctAnswerText: "One", notes: "RETAIN" };
    expect(() => importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [corrupted],
      existingSets: [first.set],
      now: NOW,
    })).toThrow(/incomplete or unavailable question membership/i);
    expect(corrupted.correctAnswerText).toBe("One");
    expect(corrupted.notes).toBe("RETAIN");
    expect(first.set.questionIds).toEqual([first.questions[0].id]);
  });

  it("allows key-only matching without blocking on unrelated corrupt local questions", () => {
    const keyOnly = question("key-only", { correctAnswerText: undefined });
    const unrelated = question("unrelated", { stem: "Different source question", correctAnswerText: "One" });
    const plan = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [unrelated, keyOnly],
      now: NOW,
    });
    expect(plan.reused).toBe(1);
    expect(plan.questions).toEqual([]);
    expect(plan.set.questionIds).toEqual(["key-only"]);
    expect(keyOnly.correctAnswerText).toBeUndefined();
    expect(unrelated.correctAnswerText).toBe("One");
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
      parserWarnings: ["Imported from a shared Question Set."],
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

  it("does not arbitrarily inherit private history from two distinct matching local IDs", () => {
    const first = question("existing-first", {
      notes: "History belongs to first",
      attempts: [{ at: NOW, answerKey: "A", status: "incorrect" }],
    });
    const second = question("existing-second", {
      notes: "History belongs to second",
      attempts: [{ at: NOW, answerKey: "B", status: "correct" }],
    });
    const local = [first, second];
    const original = JSON.stringify(local);
    const result = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: local,
      now: NOW,
    });

    expect(result.alreadyImported).toBe(false);
    expect(result.reused).toBe(0);
    expect(result.questions).toHaveLength(1);
    expect(result.set.questionIds).toEqual([result.questions[0].id]);
    expect(result.set.questionIds[0]).not.toBe(first.id);
    expect(result.set.questionIds[0]).not.toBe(second.id);
    expect(result.questions[0]).toMatchObject({
      source: "imported", correctKey: "B", status: "unseen", attempts: [],
    });
    expect(result.questions[0].notes).toBeUndefined();
    expect(JSON.stringify(local)).toBe(original);
  });

  it("creates separate new IDs for repeated shared content with ambiguous local matches", () => {
    const shared = createQuestionSetShare(
      questionSet(["q1", "q2"]),
      [question("q1"), question("q2")],
      NOW,
    );
    const local = [
      question("history-one", { notes: "Private note one" }),
      question("history-two", { notes: "Private note two" }),
    ];
    const original = JSON.stringify(local);
    const result = importSharedQuestionSet({
      snapshot: shared,
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: local,
      now: NOW,
    });

    expect(result.reused).toBe(0);
    expect(result.questions).toHaveLength(2);
    expect(result.set.questionIds).toEqual(result.questions.map((item) => item.id));
    expect(new Set(result.set.questionIds).size).toBe(2);
    expect(result.set.questionIds.every((id) => !local.some((item) => item.id === id))).toBe(true);
    expect(result.questions.every((item) => item.attempts.length === 0 && !item.notes)).toBe(true);
    expect(JSON.stringify(local)).toBe(original);
  });

  it("refuses reuse when two local question records have the same ID and identical public content", () => {
    const first = question("ambiguous-local-id", { notes: "First private note" });
    const second = question("ambiguous-local-id", { notes: "Second private note" });
    const local = [first, second];
    expect(() => importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: local,
      now: NOW,
    })).toThrow(/ambiguous existing question ID/i);
    expect(first.notes).toBe("First private note");
    expect(second.notes).toBe("Second private note");
    expect(local).toHaveLength(2);
  });

  it("refuses reuse when a matching local question ID also belongs to a different answer", () => {
    const matching = question("ambiguous-local-id", { notes: "Preserve first learner note" });
    const conflicting = question("ambiguous-local-id", {
      correctKey: "A",
      correctAnswerText: "One",
      explanation: "A different answer and teaching note",
      notes: "Preserve second learner note",
    });
    expect(() => importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [matching, conflicting],
      now: NOW,
    })).toThrow(/ambiguous existing question ID/i);
    expect(matching.correctKey).toBe("B");
    expect(conflicting.correctKey).toBe("A");
    expect(matching.notes).toBe("Preserve first learner note");
    expect(conflicting.notes).toBe("Preserve second learner note");
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

  it("refuses an already-imported result when its original question record was lost", () => {
    const first = importSharedQuestionSet({
      snapshot: snapshot(), identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [], now: NOW,
    });
    const originalIds = [...first.set.questionIds];
    // An unchanged share ID and digest cannot prove that the learner still
    // has the imported question. Reimport must not invent a replacement ID.
    expect(() => importSharedQuestionSet({
      snapshot: snapshot(), identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [], existingSets: [first.set], now: NOW,
    })).toThrow(/incomplete or unavailable question membership/i);
    expect(first.set.questionIds).toEqual(originalIds);
    expect(first.questions).toHaveLength(1);
  });

  it("refuses an already-imported result after membership is removed or duplicated", () => {
    const first = importSharedQuestionSet({
      snapshot: snapshot(), identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [], now: NOW,
    });
    for (const ids of [[], [first.set.questionIds[0], first.set.questionIds[0]]]) {
      expect(() => importSharedQuestionSet({
        snapshot: snapshot(), identity: { shareId: SHARE_ID, contentDigest: DIGEST },
        existingQuestions: first.questions,
        existingSets: [{ ...first.set, questionIds: ids }],
        now: NOW,
      })).toThrow(/incomplete or unavailable question membership/i);
    }
    expect(first.questions[0].id).toBe(first.set.questionIds[0]);
  });

  it("refuses a substituted or reordered member even when every backing ID exists", () => {
    const source = createQuestionSetShare(
      questionSet(["q1", "q2"]),
      [question("q1"), question("q2", { stem: "Second source stem" })],
      NOW,
    );
    const first = importSharedQuestionSet({
      snapshot: source, identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [], now: NOW,
    });
    const originalIds = [...first.set.questionIds];
    const unrelated = question("unrelated-record", { stem: "Different source stem" });
    for (const ids of [
      [originalIds[1], originalIds[0]],
      [originalIds[0], unrelated.id],
    ]) {
      expect(() => importSharedQuestionSet({
        snapshot: source, identity: { shareId: SHARE_ID, contentDigest: DIGEST },
        existingQuestions: [...first.questions, unrelated],
        existingSets: [{ ...first.set, questionIds: ids }],
        now: NOW,
      })).toThrow(/incomplete or unavailable question membership/i);
    }
    expect(first.set.questionIds).toEqual(originalIds);
  });

  it("refuses an existing imported member whose source answer was changed without resetting learner progress", () => {
    const first = importSharedQuestionSet({
      snapshot: snapshot(), identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [], now: NOW,
    });
    const edited = {
      ...first.questions[0],
      correctKey: "A",
      correctAnswerText: "One",
      notes: "Keep my private notes",
      attempts: [{ at: NOW, answerKey: "B", status: "correct" as const }],
    };
    expect(() => importSharedQuestionSet({
      snapshot: snapshot(), identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [edited], existingSets: [first.set], now: NOW,
    })).toThrow(/incomplete or unavailable question membership/i);
    expect(edited.notes).toBe("Keep my private notes");
    expect(edited.attempts).toEqual([{ at: NOW, answerKey: "B", status: "correct" }]);
  });

  it.each([
    ["invalid digest", { contentDigest: "not-a-digest" }],
    ["unsupported version", { version: 2 }],
    ["noncanonical share ID", { shareId: ` ${SHARE_ID} ` }],
  ] satisfies [string, Record<string, string | number>][])("holds malformed same-share import receipts with %s without changing learner data", (_label, change) => {
    const first = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [], now: NOW,
    });
    const damaged = {
      ...first.set,
      importProvenance: { ...first.set.importProvenance, ...change },
    };
    const savedIds = [...damaged.questionIds];
    const savedNotes = first.questions[0].notes;
    expect(() => importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: first.questions,
      // A persisted receipt can be malformed at runtime even though QuestionSet
      // correctly types supported receipt versions as 1. Keep this escape test-only.
      existingSets: [damaged as unknown as QuestionSet],
      now: NOW,
    })).toThrow(/invalid or unsupported local import receipt/i);
    expect(damaged.questionIds).toEqual(savedIds);
    expect(damaged.importProvenance).toMatchObject(change);
    expect(first.questions[0].notes).toBe(savedNotes);
  });

  it("counts a damaged matching receipt when checking for duplicate share IDs", () => {
    const first = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [], now: NOW,
    });
    const damaged = {
      ...first.set,
      id: "damaged-receipt",
      importProvenance: { ...first.set.importProvenance, contentDigest: "bad" },
    };
    for (const existingSets of [[first.set, damaged], [damaged, first.set]]) {
      expect(() => importSharedQuestionSet({
        snapshot: snapshot(),
        identity: { shareId: SHARE_ID, contentDigest: DIGEST },
        existingQuestions: first.questions,
        existingSets,
        now: NOW,
      })).toThrow(/ambiguous duplicate receipts/i);
    }
    expect(first.set.questionIds).toEqual(damaged.questionIds);
    expect(damaged.importProvenance.contentDigest).toBe("bad");
  });

  it("does not block a different share ID because of an unrelated damaged receipt", () => {
    const first = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [], now: NOW,
    });
    const unrelated = {
      ...first.set,
      importProvenance: {
        ...first.set.importProvenance,
        shareId: "00000000-0000-4000-8000-000000000002",
        contentDigest: "bad",
      },
    };
    const result = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [], existingSets: [unrelated], now: NOW,
    });
    expect(result.alreadyImported).toBe(false);
    expect(result.questions).toHaveLength(1);
  });

  it("holds duplicate matching receipts even when both memberships look complete", () => {
    const first = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [], now: NOW,
    });
    const duplicate = { ...first.set, id: "duplicate-local-set" };
    const originalSets = [first.set, duplicate];
    const originalIds = [...first.set.questionIds];
    const originalNotes = first.questions[0].notes;
    expect(() => importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: first.questions,
      existingSets: originalSets,
      now: NOW,
    })).toThrow(/ambiguous.*share ID/i);
    expect(first.set.questionIds).toEqual(originalIds);
    expect(first.questions[0].notes).toBe(originalNotes);
    expect(originalSets).toHaveLength(2);
  });

  it("holds duplicate import receipts with UUIDs that differ only by hex-letter case", () => {
    const lower = "abcdefab-cdef-4abc-8abc-abcdef123456";
    const upper = lower.toUpperCase();
    const first = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: lower, contentDigest: DIGEST },
      existingQuestions: [], now: NOW,
    });
    const duplicate = {
      ...first.set,
      id: "case-variant-receipt",
      importProvenance: { ...first.set.importProvenance, shareId: upper },
    };
    const retained = [first.set, duplicate];
    for (const shareId of [lower, upper]) {
      expect(() => importSharedQuestionSet({
        snapshot: snapshot(),
        identity: { shareId, contentDigest: DIGEST },
        existingQuestions: first.questions,
        existingSets: retained,
        now: NOW,
      })).toThrow(/ambiguous duplicate receipts/i);
    }
    expect(first.set.importProvenance.shareId).toBe(lower);
    expect(duplicate.importProvenance.shareId).toBe(upper);
    expect(retained).toHaveLength(2);
    expect(first.questions).toHaveLength(1);
  });

  it("recognizes a single historical uppercase UUID receipt during lowercase replay", () => {
    const lower = "abcdefab-cdef-4abc-8abc-abcdef123456";
    const upper = lower.toUpperCase();
    const first = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: upper, contentDigest: DIGEST },
      existingQuestions: [], now: NOW,
    });
    const repeated = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: lower, contentDigest: DIGEST },
      existingQuestions: first.questions,
      existingSets: [first.set],
      now: NOW,
    });
    expect(repeated.alreadyImported).toBe(true);
    expect(repeated.set).toBe(first.set);
    expect(repeated.questions).toEqual([]);
    expect(first.set.importProvenance.shareId).toBe(upper);
    expect(first.set.questionIds).toEqual([first.questions[0].id]);
  });

  it("holds conflicting same-share receipts regardless of their order", () => {
    const first = importSharedQuestionSet({
      snapshot: snapshot(),
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
      existingQuestions: [], now: NOW,
    });
    const conflict = {
      ...first.set,
      id: "conflicting-local-set",
      importProvenance: { ...first.set.importProvenance, contentDigest: "b".repeat(64) },
    };
    for (const existingSets of [[first.set, conflict], [conflict, first.set]]) {
      expect(() => importSharedQuestionSet({
        snapshot: snapshot(),
        identity: { shareId: SHARE_ID, contentDigest: DIGEST },
        existingQuestions: first.questions,
        existingSets, now: NOW,
      })).toThrow(/ambiguous.*share ID/i);
    }
    expect(conflict.importProvenance.contentDigest).toBe("b".repeat(64));
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
