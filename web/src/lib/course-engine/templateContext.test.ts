import { describe, expect, it } from "vitest";
import { parseCourseTemplate, planCourseTemplate, reconcileCourseTemplate } from "./templateParse";
import { prepareCourseTemplate, savedCourseTemplates, courseTemplateVersions } from "./templateLibrary";
import { buildCourseBooks } from "../bookshelf/courseBooks";
import { withPreparedCourses } from "../bookshelf/preparedCourses";
const text = (term = "Fall 2026", revision = "2026-08-17") => `T1 - SAMPLE - Course plan:\n@academic-term: ${term}\n@source-revision: ${revision}\n@authority: reviewed\n@source: sha256:${"a".repeat(64)} pages 1-2\n@week-policy: explicit\n@week 1: August 17-21, 2026\nWeek 1:\nLecture 01 Example [Lecture]\nWeek 2:\nLecture 02 Another [Lecture]\nUnscheduled:\nSG 01 Cohort timing unresolved [Small Group]`;
describe("source-backed course revisions", () => {
  it("retains explicit source dates without inventing a week for unresolved material", () => {
    const section = parseCourseTemplate(text());
    expect(section.problems).toEqual([]);
    expect(section.context).toMatchObject({ academicTerm: "Fall 2026", sourceRevision: "2026-08-17", weekDates: { 1: "August 17-21, 2026" } });
    const plan = planCourseTemplate([section]);
    expect(plan.weekCount).toBe(2);
    expect(plan.items.map(item => item.week)).toEqual([1, 2, undefined]);
    expect(plan.items[2].weekBasis).toBe("unknown");
  });
  it("never transfers completion when reused lecture numbers refer to another academic term", () => {
    const old = planCourseTemplate([parseCourseTemplate(text("Fall 2025"))]);
    const current = planCourseTemplate([parseCourseTemplate(text())]);
    const tracker = old.items.map((item, i) => ({ ...item, id: String(i), label: "Personal edit", passes: 3 }));
    const before = structuredClone(tracker);
    const result = reconcileCourseTemplate(current, tracker);
    expect(result.update).toEqual([]);
    expect(result.create).toHaveLength(3);
    expect(tracker).toEqual(before);
  });
  it("orders by stated source revision, keeps older originals, and previews the reviewed plan", async () => {
    const newer = await prepareCourseTemplate(text(), "current.txt", "2026-01-01");
    const older = await prepareCourseTemplate(text("Fall 2026", "2026-07-01"), "older-imported-later.txt", "2026-10-11");
    const legacy = await prepareCourseTemplate("T1 - SAMPLE - Lectures:\nLecture 99 Legacy [Lecture]", "old.txt");
    const docs = [older, newer, legacy];
    expect(courseTemplateVersions(savedCourseTemplates(docs)).find(group => group.length === 2)?.[0].document.id).toBe(newer.id);
    const books = withPreparedCourses(buildCourseBooks({ terms: [], courses: [], tracker: [] }), docs);
    expect(books[0].templateIds).toEqual([newer.id]);
    expect(books[0].weeks).toHaveLength(2);
    expect(books[0].unfiled).toBe(1);
    expect(docs).toHaveLength(3);
  });
});
