// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildQuestionBankBooks } from "../bookshelf/questionBankBooks";
import { STORAGE_KEYS } from "../brand";
import type { QuestionRecord } from "../questions";
import type { QuestionSet } from "../library";
import { COURSE_QUIZ_LAUNCH_KEY, MAX_COURSE_QUIZ_QUESTIONS, clearCourseQuizLaunch, courseQuizSelection, launchCourseQuiz, readCourseQuizLaunch } from "./quizLaunch";

const q = (id: string, week: number): QuestionRecord => ({ id, source: "imported", stem: "Synthetic source question", options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }], correctKey: "A", status: "unseen", module: "SAMPLE", week, tags: [], attempts: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" });
const questions = [q("one", 1), q("two", 2)];
const sets: QuestionSet[] = questions.map(question => ({ id: `set-${question.id}`, title: question.id, questionIds: [question.id], sourceDocumentIds: [], createdAt: "2026-01-01", tags: [], aiEnhanced: false, parserWarnings: [], scope: { module: "SAMPLE", week: question.week, term: "Term 1" } }));
const bank = () => buildQuestionBankBooks({ terms: [], courses: [], questions, sets })[0];
beforeEach(() => {
  const storage = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() };
  };
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
});
afterEach(() => vi.unstubAllGlobals());
describe("course to canonical quiz handoff", () => {
  it("keeps exact week membership and never widens an empty scope", () => {
    expect(courseQuizSelection(bank(), 1).questionIds).toEqual(["one"]);
    expect(courseQuizSelection(bank(), 99).questionIds).toEqual([]);
    expect(() => launchCourseQuiz(courseQuizSelection(bank(), 99))).toThrow("No reviewed questions");
    expect(readCourseQuizLaunch(questions)).toBeNull();
  });
  it("deduplicates mixed sets and survives navigation until consumed", () => {
    const value = bank(); value.weeks[0].collections.push(value.weeks[0].collections[0]);
    const selection = courseQuizSelection(value);
    expect(selection.questionIds).toEqual(["one", "two"]);
    launchCourseQuiz(selection);
    expect(readCourseQuizLaunch(questions)).toEqual(selection);
    expect(readCourseQuizLaunch(questions)).toEqual(selection);
    clearCourseQuizLaunch();
    expect(readCourseQuizLaunch(questions)).toBeNull();
  });
  it("carries an explicitly selected course identity without mixing similarly named modules", () => {
    launchCourseQuiz({ term: "Term 2", module: "NB2", courseId: "bpm-501", week: 3,
      questionIds: ["one"], setIds: ["set-one"] });
    expect(readCourseQuizLaunch(questions)).toMatchObject({
      term: "Term 2", module: "NB2", courseId: "bpm-501", week: 3,
      questionIds: ["one"], setIds: ["set-one"],
    });
  });

  it("does not accept duplicate, invalid or excessive fixed question IDs", () => {
    const base = { term: "Term 1", module: "SAMPLE", setIds: [] };
    expect(() => launchCourseQuiz({ ...base, questionIds: ["one", "one"] }))
      .toThrow(/selection is invalid/);
    expect(() => launchCourseQuiz({
      ...base, questionIds: Array.from({ length: MAX_COURSE_QUIZ_QUESTIONS + 1 }, (_, index) => `question-${index}`),
    })).toThrow(/question limit/);
    for (const malformed of [
      { ...base, questionIds: ["one", "one"] },
      { ...base, questionIds: ["one"], week: -2 },
      { ...base, questionIds: ["one", "missing"] },
    ]) {
      sessionStorage.setItem(COURSE_QUIZ_LAUNCH_KEY, JSON.stringify(malformed));
      expect(readCourseQuizLaunch(questions)).toBeNull();
    }
    sessionStorage.removeItem(COURSE_QUIZ_LAUNCH_KEY);
  });

  it("does not replace an unfinished quiz or admit removed questions", () => {
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify({ poolIds: ["active"] }));
    expect(() => launchCourseQuiz(courseQuizSelection(bank()))).toThrow("Resume or finish");
    localStorage.clear();
    launchCourseQuiz(courseQuizSelection(bank()));
    // Delayed local hydration must never silently truncate the original pool.
    expect(readCourseQuizLaunch([questions[1]])).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY)!)).toMatchObject({ questionIds: ["one", "two"] });
    expect(readCourseQuizLaunch([])).toBeNull();
    expect(readCourseQuizLaunch(questions)?.questionIds).toEqual(["one", "two"]);
  });
});
