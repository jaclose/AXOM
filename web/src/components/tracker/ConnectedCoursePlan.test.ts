// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { QuestionSet } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import type { Course, Term } from "../../lib/types";
import { connectedQuestionBank } from "./ConnectedCoursePlan";

const collection = "11111111-1111-4111-8111-111111111111";
const term: Term = { id: "term-2", name: "Term 2" };
const localCourse: Course = {
  id: "local-course",
  termId: term.id,
  code: "BPM 501",
  name: "Local ER",
  files: 0,
  modules: [{ id: "local-er", name: "ER" }],
};
const hostedCourse: Course = {
  id: "hosted-course",
  termId: term.id,
  code: `academic:${collection}`,
  name: "Hosted ER",
  files: 0,
  modules: [{ id: "hosted-er", name: "ER" }],
};
const catalogCourse = { id: collection, term: "Term 2", module: "ER" };
const now = "2026-10-15T00:00:00.000Z";

function question(id: string, patch: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id,
    source: "imported",
    stem: `Question ${id}`,
    options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
    correctKey: "A",
    status: "unseen",
    tags: [],
    attempts: [],
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function set(id: string, questionIds: string[], patch: Partial<QuestionSet> = {}): QuestionSet {
  return {
    id,
    title: id,
    questionIds,
    sourceDocumentIds: [],
    tags: [],
    aiEnhanced: false,
    parserWarnings: [],
    kind: "source",
    createdAt: now,
    ...patch,
  };
}

describe("connected course question-bank ownership", () => {
  it("projects exact receipt membership only onto the hosted local owner", () => {
    const questions = [question("hosted-question", { setId: "hosted-set" })];
    const questionSets = [set("hosted-set", ["hosted-question"])];
    const bank = connectedQuestionBank(catalogCourse, {
      questionIds: ["hosted-question"], setIds: ["hosted-set"],
    }, {
      terms: [term], courses: [localCourse, hostedCourse], questions, questionSets,
    });

    expect(bank).toMatchObject({
      courseId: hostedCourse.id,
      courseCode: hostedCourse.code,
      module: "ER",
      term: "Term 2",
      count: 1,
    });
    expect(bank?.weeks.flatMap(week => week.collections.flatMap(item => item.questionIds ?? []))).toEqual(["hosted-question"]);
  });

  it("fails closed instead of choosing the first bank for conflicting receipt scope", () => {
    const questions = [
      question("wrong-module", { module: "DM", setId: "mixed-set" }),
      question("right-module", { module: "ER", setId: "mixed-set" }),
    ];
    const questionSets = [set("mixed-set", ["wrong-module", "right-module"])];

    expect(connectedQuestionBank(catalogCourse, {
      questionIds: ["wrong-module", "right-module"], setIds: ["mixed-set"],
    }, {
      terms: [term], courses: [localCourse, hostedCourse], questions, questionSets,
    })).toBeUndefined();

    expect(connectedQuestionBank(catalogCourse, {
      questionIds: ["right-module"], setIds: ["mixed-set"],
    }, {
      terms: [term], courses: [localCourse], questions, questionSets,
    })).toBeUndefined();
  });
});
