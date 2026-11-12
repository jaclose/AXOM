import { describe, expect, it } from "vitest";
import type { QuestionSet } from "../library";
import type { QuestionRecord } from "../questions";
import type { CourseScope } from "./scope";
import { duplicateQuestionRecordIds, verifyCollectionForCourse } from "./verifiedPracticeLinks";

const stamp = "2026-10-14T12:00:00.000Z";
const q = (id: string, patch: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id, source: "imported", stem: "Test source question",
  options: [{ key: "A", text: "Correct" }, { key: "B", text: "Wrong" }],
  correctKey: "A", status: "unseen", tags: [], attempts: [],
  createdAt: stamp, updatedAt: stamp, ...patch,
});
const bank = (id: string, ids: string[], scope?: QuestionSet["scope"]): QuestionSet => ({
  id, title: "Source set", questionIds: ids, scope, sourceDocumentIds: [],
  tags: [], createdAt: stamp, parserWarnings: [], aiEnhanced: false,
});
const verify = (
  readyIds: string[], questions: QuestionRecord[], sets: QuestionSet[],
  requested: CourseScope = { module: "NB2", week: 3, courseId: "core" },
  setId = "set", strict = true,
) => verifyCollectionForCourse({
  setId, readyQuestionIds: readyIds, questionIds: readyIds,
}, requested, new Map(questions.map((item) => [item.id, item])),
new Map(sets.map((item) => [item.id, item])), strict);

describe("review-gated Tracker-to-QBank links", () => {
  it("launches reviewed questions when immutable membership and course/week metadata agree", () => {
    const questions = [q("core", { module: "NB Block 2", week: 3, courseId: "core", setId: "set" })];
    const sets = [bank("set", ["core"], { module: "NB2", week: 3, courseId: "core" })];
    expect(verify(["core"], questions, sets)).toEqual({
      readyQuestionIds: ["core"], sourceReviewRequired: false,
      conflictingQuestionCount: 0, unavailableQuestionCount: 0,
    });
  });

  it("holds the entire set when a member explicitly belongs to a different course", () => {
    const questions = [
      q("good", { module: "NB2", week: 3, courseId: "core", setId: "set" }),
      q("conflict", { module: "NB2", week: 3, courseId: "elective", setId: "set" }),
    ];
    const sets = [bank("set", ["good", "conflict"], { module: "NB2", week: 3, courseId: "core" })];
    expect(verify(["good", "conflict"], questions, sets)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true,
      conflictingQuestionCount: 1,
    });
  });

  it("holds sets whose explicit week or module disagrees with the selected course scope", () => {
    const questions = [q("q", { module: "NB2", courseId: "core", week: 4, setId: "set" })];
    const sets = [bank("set", ["q"], { module: "NB2", courseId: "core", week: 4 })];
    expect(verify(["q"], questions, sets)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true,
    });
    expect(verify(["q"], questions, sets, { module: "ER", week: 4, courseId: "core" })).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true,
    });
  });

  it("accepts older uniquely owned module/week evidence but demands course proof when names collide", () => {
    const questions = [q("legacy", { module: "NB2", week: 3, setId: "set" })];
    const sets = [bank("set", ["legacy"], { module: "NB2", week: 3 })];
    expect(verify(["legacy"], questions, sets, { module: "NB2", week: 3, courseId: "core" }, "set", false)).toMatchObject({
      readyQuestionIds: ["legacy"], sourceReviewRequired: false,
    });
    expect(verify(["legacy"], questions, sets, { module: "NB2", week: 3, courseId: "core" }, "set", true)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true,
    });
  });

  it("keeps available reviewed members when a separately referenced record is absent", () => {
    const questions = [q("present", { module: "NB2", courseId: "core", week: 3, setId: "set" })];
    const sets = [bank("set", ["present", "missing"], { module: "NB2", courseId: "core", week: 3 })];
    expect(verify(["present"], questions, sets)).toMatchObject({
      readyQuestionIds: ["present"], sourceReviewRequired: false, unavailableQuestionCount: 1,
    });
  });

  it("rejects forged ready IDs not in an immutable set, and untrusted answer keys", () => {
    const questions = [
      q("in-set", { module: "NB2", courseId: "core", week: 3, setId: "set", correctKey: "Z" }),
      q("foreign", { module: "NB2", courseId: "core", week: 3, setId: "set" }),
    ];
    const sets = [bank("set", ["in-set"], { module: "NB2", courseId: "core", week: 3 })];
    expect(verify(["in-set", "foreign"], questions, sets)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true,
    });
    expect(verify(["in-set"], questions, sets)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: false,
    });
  });
});


describe("canonical source proof survives Tracker collection lookup", () => {
  it("does not refill an explicitly invalid question week from its own source set", () => {
    const sets = [bank("set", ["q"], { module: "NB2", week: 3, courseId: "core" })];
    for (const value of [0, -1, 100, 1.5, NaN, "2026-11-05", "FTM 3", "Week 3-4"]) {
      const questions = [q("q", { setId: "set", week: value as number })];
      expect(verify(["q"], questions, sets)).toEqual({
        readyQuestionIds: [], sourceReviewRequired: true,
        conflictingQuestionCount: 1, unavailableQuestionCount: 0,
      });
    }
  });

  it("applies the same invalid-week gate to legacy members without a primary set", () => {
    const sets = [bank("set", ["q"], { module: "NB2", week: 3, courseId: "core" })];
    expect(verify(["q"], [q("q", { week: 0 })], sets)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true, conflictingQuestionCount: 1,
    });
  });

  it("does not invent a source week from a review collection when the primary week is absent", () => {
    const sets = [
      bank("primary", ["q"], { module: "NB2", courseId: "core" }),
      bank("set", ["q"], { module: "NB2", week: 3, courseId: "core" }),
    ];
    expect(verify(["q"], [q("q", { setId: "primary" })], sets)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true, conflictingQuestionCount: 1,
    });
  });

  it("does not borrow a review collection's course as primary ownership proof", () => {
    const sets = [
      bank("primary", ["q"], { module: "NB2", week: 3 }),
      bank("set", ["q"], { module: "NB2", week: 3, courseId: "core" }),
    ];
    expect(verify(["q"], [q("q", { setId: "primary" })], sets)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true, conflictingQuestionCount: 1,
    });
  });

  it("keeps a missing or explicitly empty primary reference unresolved instead of rebinding it", () => {
    const sets = [bank("set", ["q"], { module: "NB2", week: 3, courseId: "core" })];
    for (const setId of ["missing-primary", ""]) {
      expect(verify(["q"], [q("q", { setId })], sets)).toMatchObject({
        readyQuestionIds: [], sourceReviewRequired: true, conflictingQuestionCount: 1,
      });
    }
  });

  it("retains legitimate legacy inheritance when no primary set is declared", () => {
    const sets = [bank("set", ["q"], { module: "NB2", week: 3, courseId: "core" })];
    for (const week of [undefined, null, "", "  "]) {
      expect(verify(["q"], [q("q", { week: week as unknown as number })], sets)).toEqual({
        readyQuestionIds: ["q"], sourceReviewRequired: false,
        conflictingQuestionCount: 0, unavailableQuestionCount: 0,
      });
    }
  });

  it("allows a review collection when primary source metadata agrees", () => {
    const sets = [
      bank("primary", ["q"], { module: "NB Block 2", week: 3, courseId: "core" }),
      bank("set", ["q"], { module: "NB2", week: 3, courseId: "core" }),
    ];
    expect(verify(["q"], [q("q", { setId: "primary" })], sets)).toEqual({
      readyQuestionIds: ["q"], sourceReviewRequired: false,
      conflictingQuestionCount: 0, unavailableQuestionCount: 0,
    });
  });

  it("holds valid but contradictory primary provenance even when the question and review set agree", () => {
    const secondary = { ...bank("set", ["q"], { module: "NB2", week: 3, courseId: "core" }), kind: "review" as const };
    const record = q("q", { setId: "primary", module: "NB2", week: 3, courseId: "core" });
    for (const primaryScope of [
      { module: "FTM 1", week: 3, courseId: "core" },
      { module: "NB2", week: 4, courseId: "core" },
      { module: "NB2", week: 3, courseId: "elective" },
    ]) {
      const sources = [bank("primary", ["q"], primaryScope), secondary];
      for (const requested of [
        { module: "NB2", week: 3, courseId: "core" },
        { module: "NB2", courseId: "core" },
      ]) {
        expect(verify(["q"], [record], sources, requested)).toEqual({
          readyQuestionIds: [], sourceReviewRequired: true,
          conflictingQuestionCount: 1, unavailableQuestionCount: 0,
        });
      }
    }
  });

  it("holds absent or forged declared primary membership despite a complete question filing", () => {
    const secondary = { ...bank("set", ["q"], { module: "NB2", week: 3, courseId: "core" }), kind: "review" as const };
    const record = q("q", { setId: "primary", module: "NB2", week: 3, courseId: "core" });
    for (const sources of [
      [secondary],
      [bank("primary", [], { module: "NB2", week: 3, courseId: "core" }), secondary],
    ]) {
      expect(verify(["q"], [record], sources)).toEqual({
        readyQuestionIds: [], sourceReviewRequired: true,
        conflictingQuestionCount: 1, unavailableQuestionCount: 0,
      });
    }
  });

  it("honors the question's own explicit evidence without requiring fields on its primary set", () => {
    const sets = [bank("primary", ["q"]), bank("set", ["q"], { module: "NB2", week: 3, courseId: "core" })];
    const questions = [q("q", { setId: "primary", module: "NB2", week: 3, courseId: "core" })];
    expect(verify(["q"], questions, sets)).toMatchObject({
      readyQuestionIds: ["q"], sourceReviewRequired: false,
    });
  });

  it("holds the whole collection rather than silently dropping a conflicting week", () => {
    const sets = [bank("set", ["good", "invalid", "missing"], { module: "NB2", week: 3, courseId: "core" })];
    const questions = [q("good", { setId: "set" }), q("invalid", { setId: "set", week: 100 })];
    expect(verify(["good", "invalid"], questions, sets)).toEqual({
      readyQuestionIds: [], sourceReviewRequired: true,
      conflictingQuestionCount: 1, unavailableQuestionCount: 1,
    });
  });

  it("holds an entire module-wide collection when one member declares a malformed week", () => {
    const sets = [bank("set", ["valid", "bad"], { module: "NB2", courseId: "core" })];
    const questions = [
      q("valid", { setId: "set" }),
      q("bad", { setId: "set", week: 0 }),
    ];
    expect(verify(["valid", "bad"], questions, sets, { module: "NB2", courseId: "core" })).toEqual({
      readyQuestionIds: [], sourceReviewRequired: true,
      conflictingQuestionCount: 1, unavailableQuestionCount: 0,
    });
  });

  it("does not mistake a malformed source-set week for legitimately unscheduled material", () => {
    for (const invalid of [0, 100, "Week 3-4", "2026-11-06"]) {
      const sets = [bank("set", ["q"], {
        module: "NB2", courseId: "core", week: invalid as number,
      })];
      expect(verify(["q"], [q("q", { setId: "set" })], sets,
        { module: "NB2", courseId: "core" })).toEqual({
        readyQuestionIds: [], sourceReviewRequired: true,
        conflictingQuestionCount: 1, unavailableQuestionCount: 0,
      });
    }
  });

  it("does not use a clean review collection to bypass an invalid primary week", () => {
    const sets = [
      bank("primary", ["q"], { module: "NB2", courseId: "core", week: 0 }),
      bank("set", ["q"], { module: "NB2", courseId: "core" }),
    ];
    expect(verify(["q"], [q("q", { setId: "primary" })], sets,
      { module: "NB2", courseId: "core" })).toEqual({
      readyQuestionIds: [], sourceReviewRequired: true,
      conflictingQuestionCount: 1, unavailableQuestionCount: 0,
    });
  });

  it("accepts a valid textual source week as the matching numbered week", () => {
    const sets = [bank("set", ["q"], {
      module: "NB2", courseId: "core", week: "Week 3" as unknown as number,
    })];
    expect(verify(["q"], [q("q", { setId: "set" })], sets)).toEqual({
      readyQuestionIds: ["q"], sourceReviewRequired: false,
      conflictingQuestionCount: 0, unavailableQuestionCount: 0,
    });
  });

  it("keeps module-wide unscheduled practice distinct from assigning a source week", () => {
    const sets = [bank("primary", ["q"], { module: "NB2", courseId: "core" }), bank("set", ["q"], { module: "NB2", courseId: "core" })];
    const questions = [q("q", { setId: "primary" })];
    expect(verify(["q"], questions, sets, { module: "NB2", courseId: "core" })).toMatchObject({
      readyQuestionIds: ["q"], sourceReviewRequired: false,
    });
    expect(verify(["q"], questions, sets)).toMatchObject({
      readyQuestionIds: [], sourceReviewRequired: true,
    });
  });

  it("keeps missing keys and unreviewed imported answers out of otherwise valid legacy membership", () => {
    const questions = [q("keyless", { correctKey: undefined }), q("unreviewed", { extraction: { reviewed: false, confidence: "high" } })];
    const sets = [bank("set", questions.map((item) => item.id), { module: "NB2", week: 3, courseId: "core" })];
    expect(verify(questions.map((item) => item.id), questions, sets)).toEqual({
      readyQuestionIds: [], sourceReviewRequired: false,
      conflictingQuestionCount: 0, unavailableQuestionCount: 0,
    });
  });

  it("does not rewrite primary links, source filing, membership or attempts while resolving legacy scope", () => {
    const question = q("q");
    const source = bank("set", ["q"], { module: "NB2", week: 3, courseId: "core" });
    const before = JSON.stringify([question, source]);
    Object.freeze(question);
    Object.freeze(question.attempts);
    Object.freeze(source);
    Object.freeze(source.scope);
    Object.freeze(source.questionIds);
    expect(verify(["q"], [question], [source])).toMatchObject({ readyQuestionIds: ["q"] });
    expect(JSON.stringify([question, source])).toBe(before);
  });
});


describe("R54: immutable source membership must never be silently deduplicated", () => {
  it("holds duplicate IDs in original set, collection or ready-membership evidence", () => {
    const question = q("source-q", {
      module: "NB2", week: 3, courseId: "core", setId: "set",
    });
    const scope = { module: "NB2", week: 3, courseId: "core" };
    const requested: CourseScope = scope;
    for (const origin of ["source", "collection", "ready"] as const) {
      const source = bank("set", origin === "source" ? ["source-q", "source-q"] : ["source-q"], scope);
      const collection = {
        setId: "set",
        questionIds: origin === "collection" ? ["source-q", "source-q"] : ["source-q"],
        readyQuestionIds: origin === "ready" ? ["source-q", "source-q"] : ["source-q"],
      };
      const result = verifyCollectionForCourse(
        collection, requested,
        new Map([[question.id, question]]), new Map([[source.id, source]]), true,
      );
      expect(result, origin).toEqual({
        readyQuestionIds: [], sourceReviewRequired: true,
        conflictingQuestionCount: 0, unavailableQuestionCount: 0,
      });
    }
  });

  it("preserves a uniquely listed original and its exact eligible question", () => {
    const question = q("source-q", {
      module: "NB2", week: 3, courseId: "core", setId: "set",
    });
    const source = bank("set", ["source-q"], { module: "NB2", week: 3, courseId: "core" });
    expect(verifyCollectionForCourse(
      { setId: "set", questionIds: ["source-q"], readyQuestionIds: ["source-q"] },
      { module: "NB2", week: 3, courseId: "core" },
      new Map([[question.id, question]]), new Map([[source.id, source]]), true,
    )).toEqual({
      readyQuestionIds: ["source-q"], sourceReviewRequired: false,
      conflictingQuestionCount: 0, unavailableQuestionCount: 0,
    });
  });
});


describe("raw canonical QuestionRecord collision protection at the Tracker boundary", () => {
  it("holds a source-unique membership when raw records reuse the same ID with different answer keys", () => {
    const first = q("source-q", { module: "NB2", week: 3, courseId: "core", setId: "set", correctKey: "A" });
    const second = q("source-q", { module: "NB2", week: 3, courseId: "core", setId: "set", correctKey: "B" });
    const originals = [first, second];
    const sourceSet = bank("set", ["source-q"], { module: "NB2", week: 3, courseId: "core" });
    // The book and Tracker producers use this same last-write-wins Map.
    const index = new Map(originals.map((record) => [record.id, record]));
    expect(index.size).toBe(1);
    expect(index.get("source-q")?.correctKey).toBe("B");
    const duplicates = duplicateQuestionRecordIds(originals);
    expect([...duplicates]).toEqual(["source-q"]);
    expect(verifyCollectionForCourse({
      setId: "set", questionIds: ["source-q"], readyQuestionIds: ["source-q"],
    }, { module: "NB2", week: 3, courseId: "core" }, index,
    new Map([[sourceSet.id, sourceSet]]), true, duplicates)).toEqual({
      readyQuestionIds: [], sourceReviewRequired: true,
      conflictingQuestionCount: 0, unavailableQuestionCount: 0,
    });
    expect(originals.map((record) => record.correctKey)).toEqual(["A", "B"]);
  });

  it("does not hold unrelated unique membership when duplicate records are elsewhere", () => {
    const clean = q("clean", { module: "NB2", week: 3, courseId: "core", setId: "set" });
    const unrelated = q("other");
    const raw = [clean, unrelated, { ...unrelated, correctKey: "B" }];
    const sourceSet = bank("set", ["clean"], { module: "NB2", week: 3, courseId: "core" });
    const duplicateIds = duplicateQuestionRecordIds(raw);
    expect([...duplicateIds]).toEqual(["other"]);
    expect(verifyCollectionForCourse({
      setId: "set", questionIds: ["clean"], readyQuestionIds: ["clean"],
    }, { module: "NB2", week: 3, courseId: "core" },
    new Map(raw.map((record) => [record.id, record])),
    new Map([[sourceSet.id, sourceSet]]), true, duplicateIds)).toMatchObject({
      readyQuestionIds: ["clean"], sourceReviewRequired: false,
    });
  });
});


describe("R56: raw source-set identity must survive last-write-wins indexing", () => {
  const scope = { module: "NB2", week: 3, courseId: "core" };
  const requested: CourseScope = scope;
  const collection = { setId: "set", questionIds: ["source-q"], readyQuestionIds: ["source-q"] };

  it("holds same-ID source sets with conflicting provenance before offering practice", () => {
    const question = q("source-q", { setId: "set", ...scope });
    const originals = [
      { ...bank("set", ["source-q"], { module: "ER", week: 1, courseId: "foreign" }), sourceDocumentIds: ["source-a"] },
      { ...bank("set", ["source-q"], scope), sourceDocumentIds: ["source-b"] },
    ];
    const before = JSON.stringify(originals);
    const setsById = new Map(originals.map((set) => [set.id, set]));
    expect(setsById.size).toBe(1);
    expect(setsById.get("set")?.sourceDocumentIds).toEqual(["source-b"]);
    const result = verifyCollectionForCourse(
      collection, requested, new Map([[question.id, question]]), setsById,
      true, new Set(), new Set(["set"]),
    );
    expect(result).toEqual({
      readyQuestionIds: [], sourceReviewRequired: true,
      conflictingQuestionCount: 0, unavailableQuestionCount: 0,
    });
    expect(JSON.stringify(originals)).toBe(before);
  });

  it("holds a separately referenced primary set whose raw ID is duplicated", () => {
    const question = q("source-q", { setId: "primary", ...scope });
    const setsById = new Map([
      bank("primary", ["source-q"], { module: "ER", week: 1, courseId: "foreign" }),
      bank("primary", ["source-q"], scope),
      bank("set", ["source-q"], scope),
    ].map((set) => [set.id, set]));
    expect(verifyCollectionForCourse(
      collection, requested, new Map([[question.id, question]]), setsById,
      true, new Set(), new Set(["primary"]),
    )).toMatchObject({ readyQuestionIds: [], sourceReviewRequired: true });
  });

  it("keeps a distinct clean source usable when a different set ID is duplicated", () => {
    const question = q("source-q", { setId: "set", ...scope });
    const source = bank("set", ["source-q"], scope);
    expect(verifyCollectionForCourse(
      collection, requested, new Map([[question.id, question]]),
      new Map([[source.id, source]]), true, new Set(), new Set(["unrelated"]),
    )).toMatchObject({ readyQuestionIds: ["source-q"], sourceReviewRequired: false });
  });
});
