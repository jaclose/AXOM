import { describe, expect, it } from "vitest";
import type { CourseBook } from "../../lib/bookshelf/courseBooks";
import type { QuestionBankBook } from "../../lib/bookshelf/questionBankBooks";
import { bankForCourseBook } from "./courseLibraryMatching";

const course = (
  code?: string, courseId?: string, term = "Term 2", module = "ER",
): CourseBook => ({
  kind: "course", id: `course:${term}:${code ?? "none"}:${module}`,
  title: module, identifier: code, shelf: term, count: 0,
  countLabel: "0 activities", state: "empty", module, term,
  ...(code ? { courseCode: code } : {}),
  ...(courseId ? { courseId } : {}),
  origin: "workspace", weeks: [], unfiled: 0, done: 0,
});

const bank = (
  code?: string, courseId?: string, term = "Term 2", module = "ER",
): QuestionBankBook => ({
  kind: "question-bank", id: `bank:${term}:${code ?? "none"}:${module}`,
  title: module, shelf: term, count: 8, countLabel: "8 questions",
  state: "available", module, term,
  ...(code ? { courseCode: code } : {}),
  ...(courseId ? { courseId } : {}),
  weeks: [], ready: 8, attempted: 0,
});

describe("Course Library bank ownership", () => {
  it("matches a question bank by explicit course ID when modules share a term", () => {
    const core = course("BPM501", "core");
    const elective = course("ELECTIVE", "elective");
    const coreBank = bank("BPM501", "core");
    const electiveBank = bank("ELECTIVE", "elective");
    const banks = [electiveBank, coreBank];
    expect(bankForCourseBook(core, banks, [core, elective])).toBe(coreBank);
    expect(bankForCourseBook(elective, banks, [core, elective])).toBe(electiveBank);
  });

  it("refuses to reassign another course's bank by matching module text", () => {
    const core = course("BPM501", "core");
    const elective = course("ELECTIVE", "elective");
    expect(bankForCourseBook(core, [bank("ELECTIVE", "elective")], [core, elective])).toBeUndefined();
    expect(bankForCourseBook(elective, [bank("BPM501", "core")], [core, elective])).toBeUndefined();
  });

  it("uses a unique legacy course-code bank when ID is unavailable", () => {
    const core = course("BPM501", "core");
    const banks = [bank("BPM501", undefined, "T2"), bank("ELECTIVE")];
    expect(bankForCourseBook(core, banks, [core])).toBe(banks[0]);
    expect(bankForCourseBook(core, [banks[0], bank("BPM501")], [core])).toBeUndefined();
  });

  it("does not guess a module-only bank when two courses own the same module", () => {
    const core = course("BPM501", "core");
    const elective = course("ELECTIVE", "elective");
    expect(bankForCourseBook(core, [bank()], [core, elective])).toBeUndefined();
    expect(bankForCourseBook(course(undefined, undefined), [bank()], [core, elective])).toBeUndefined();
  });

  it("allows one unambiguous legacy module association, respecting term aliases", () => {
    const legacy = course(undefined, undefined, "T2", "NB2");
    const known = bank(undefined, undefined, "Term 2", "NB Block 2");
    expect(bankForCourseBook(legacy, [known], [legacy])).toBe(known);
    expect(bankForCourseBook(legacy, [bank(undefined, undefined, "Term 4", "NB Block 2")], [legacy])).toBeUndefined();
  });
});
