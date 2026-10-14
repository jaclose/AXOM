import { describe, expect, it } from "vitest";
import { buildCourseBooks } from "./courseBooks";
import type { Course, Term, TrackerItem } from "../types";

const terms: Term[] = [
  { id: "t2", name: "Term 2" },
  { id: "t3", name: "Term 3" },
] as Term[];
const course = (id: string, termId: string, code: string): Course => ({
  id, termId, code, name: code, files: 0,
  modules: [{ id: `module-${id}`, name: "ER" }],
});
const item = (id: string, path: string, passes = 0): TrackerItem => ({
  id, path, label: `Sample ${id}`, kind: "Lecture",
  activity: "lecture", passes, ankiPasses: 0, yield: "none",
  updated: "2026-10-01T00:00:00.000Z",
});

describe("course bookshelf keeps term and course ownership separate", () => {
  it("does not borrow identically named modules across terms", () => {
    const courses = [course("a", "t2", "BPM 501"), course("b", "t3", "BPM 502")];
    const tracker = [
      item("t2-lecture", "Term 2/ER/Week 1", 1),
      item("t3-lecture", "Term 3/ER/Week 2"),
      item("t2-loose", "Term 2/ER/Unsorted"),
    ];
    const original = structuredClone(tracker);
    const books = buildCourseBooks({ terms, courses, tracker }).filter((book) => book.module === "ER");
    expect(books).toHaveLength(2);
    expect(books.find((book) => book.term === "Term 2")).toMatchObject({
      count: 2, unfiled: 1, done: 1,
      weeks: [{ week: 1, total: 1, done: 1 }],
    });
    expect(books.find((book) => book.term === "Term 3")).toMatchObject({
      count: 1, unfiled: 0, done: 0,
      weeks: [{ week: 2, total: 1, done: 0 }],
    });
    expect(tracker).toEqual(original);
  });

  it("does not claim a legacy module root when two same-term courses own it", () => {
    const courses = [course("a", "t2", "BPM 501"), course("b", "t2", "ALT 501")];
    const tracker = [
      item("bpm", "Term 2/BPM 501/ER/Week 1", 1),
      item("alt", "Term 2/ALT 501/ER/Week 2"),
      item("ambiguous-week", "Term 2/ER/Week 3"),
      item("ambiguous-loose", "Term 2/ER/Unsorted"),
    ];
    const books = buildCourseBooks({ terms, courses, tracker }).filter((book) => book.module === "ER");
    expect(books).toHaveLength(2);
    expect(books.find((book) => book.courseCode === "BPM 501")).toMatchObject({
      count: 1, done: 1, unfiled: 0, weeks: [{ week: 1, total: 1 }],
    });
    expect(books.find((book) => book.courseCode === "ALT 501")).toMatchObject({
      count: 1, done: 0, unfiled: 0, weeks: [{ week: 2, total: 1 }],
    });
    expect(books.flatMap((book) => book.weeks.flatMap((week) => week.items.map((row) => row.id))))
      .not.toContain("ambiguous-week");
  });

  it("merges legacy and course-filed weeks without rewriting progress or ids", () => {
    const tracker = [
      item("legacy", "Term 2/ER/Week 1", 1),
      item("course", "Term 2/BPM 501/ER/Week 1", 0),
      item("legacy-loose", "Term 2/ER/Unsorted"),
      item("course-loose", "Term 2/BPM 501/ER/Unsorted"),
    ];
    const original = structuredClone(tracker);
    const book = buildCourseBooks({ terms, courses: [course("a", "t2", "BPM 501")], tracker })[0];
    expect(book).toMatchObject({ count: 4, done: 1, unfiled: 2 });
    expect(book.weeks).toHaveLength(1);
    expect(book.weeks[0]).toMatchObject({
      week: 1, total: 2, done: 1,
      activities: [{ activity: "lecture", label: "2 lectures", total: 2, done: 1 }],
    });
    expect(book.weeks[0].items.map((row) => row.id)).toEqual(["legacy", "course"]);
    expect(tracker).toEqual(original);
  });
});
