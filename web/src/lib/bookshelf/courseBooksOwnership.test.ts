import { describe, expect, it } from "vitest";
import type { Course, Term, TrackerItem } from "../types";
import { buildCourseBooks, courseBookId } from "./courseBooks";

const terms: Term[] = [
  { id: "t2", name: "Term 2" }, { id: "t4", name: "Term 4" },
];
const courses: Course[] = [
  { id: "c2", termId: "t2", code: "BPM 501", name: "Core II", files: 0,
    modules: [{ id: "nb2", name: "NB2" }, { id: "er", name: "ER" }] },
  { id: "elective", termId: "t2", code: "ELECTIVE", name: "Elective", files: 0,
    modules: [{ id: "er-copy", name: "ER" }] },
  { id: "c4", termId: "t4", code: "PPM 500", name: "Core IV", files: 0,
    modules: [{ id: "er4", name: "ER" }] },
];
const row = (id: string, path: string, passes = 0): TrackerItem => ({
  id, path, label: id, kind: "Lecture", activity: "lecture", passes,
  ankiPasses: 0, updated: "2026-10-14T00:00:00.000Z", yield: "none",
});
const get = (books: ReturnType<typeof buildCourseBooks>, code: string, module: string) =>
  books.find((b) => b.courseCode === code && b.module === module)!;

describe("course-book course/term ownership", () => {
  it("resolves T2 aliases, long/short module names, and unscheduled rows into one unique core course", () => {
    const books = buildCourseBooks({ terms, courses, tracker: [
      row("a", "T2/NB Block 2/Week 3", 1),
      row("b", "Term 2/BPM 501/NB2/Week 3"),
      row("c", "T2/NB Block 2/Unsorted"),
    ] });
    const nb2 = get(books, "BPM 501", "NB2");
    expect(nb2).toMatchObject({ shelf: "Term 2", count: 3, done: 1, unfiled: 1 });
    expect(nb2.weeks).toMatchObject([{ week: 3, total: 2, done: 1 }]);
    expect(nb2.weeks[0].items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(nb2.id).toBe(courseBookId("Term 2", "BPM 501", "NB Block 2"));
  });

  it("keeps identical module names in different terms and courses disjoint", () => {
    const books = buildCourseBooks({ terms, courses, tracker: [
      row("core-er", "Term 2/BPM 501/ER/Week 1", 1),
      row("elective-er", "Term 2/ELECTIVE/ER/Week 1"),
      row("term4-er", "Term 4/PPM 500/ER/Week 1", 1),
      row("term4-legacy", "Term 4/ER/Week 2"),
      row("term4-unfiled", "Term 4/ER/Unsorted"),
      // Two Term 2 courses own ER, so these legacy rows require review.
      row("ambiguous-week", "Term 2/ER/Week 2"),
      row("ambiguous-unfiled", "Term 2/ER/Unsorted"),
    ] });
    expect(get(books, "BPM 501", "ER")).toMatchObject({
      count: 1, unfiled: 0, done: 1,
    });
    expect(get(books, "ELECTIVE", "ER")).toMatchObject({
      count: 1, unfiled: 0, done: 0,
    });
    expect(get(books, "PPM 500", "ER")).toMatchObject({
      count: 3, unfiled: 1, done: 1,
    });
    expect(get(books, "PPM 500", "ER").weeks.map((week) => [week.week, week.total]))
      .toEqual([[1, 1], [2, 1]]);
  });

  it("does not count an unrelated path segment that happens to match a module", () => {
    const books = buildCourseBooks({ terms, courses, tracker: [
      row("unrelated", "Term 2/Notes/ER/Unsorted"),
      row("not-under-week", "Term 2/BPM 501/ER/Week 99/Notes"),
      row("valid", "Term 2/BPM 501/ER/Unsorted"),
    ] });
    expect(get(books, "BPM 501", "ER")).toMatchObject({ count: 1, unfiled: 1 });
    expect(get(books, "ELECTIVE", "ER")).toMatchObject({ count: 0, unfiled: 0 });
  });
});
