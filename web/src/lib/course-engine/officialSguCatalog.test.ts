import { describe, expect, it } from "vitest";
import { SGU_CURRICULUM } from "../curricula";
import type { Course, Term } from "../types";
import { officialSguClinicalCourseEvidence } from "./officialSguCatalog";

describe("SGU 2025+ public clinical-course outline evidence", () => {
  it("preserves catalog source URLs and 20/16 week module totals without creating lectures", () => {
    const report = officialSguClinicalCourseEvidence(SGU_CURRICULUM, { terms: [], courses: [] });
    expect(report.map((course) => [course.term, course.officialCourseCode, course.totalWeeks])).toEqual([
      ["Term 4", "PCM 500", 20], ["Term 5", "PCM 501", 16],
    ]);
    expect(report[0].modules.map(({ code, durationWeeks, derivedWeekStart, derivedWeekEnd }) =>
      [code, durationWeeks, derivedWeekStart, derivedWeekEnd])).toEqual([
      ["FTCM", 4, 1, 4], ["NCRS", 6, 5, 10],
      ["RHPS", 4, 11, 14], ["DERS", 6, 15, 20],
    ]);
    expect(report[1].modules.map(({ code, durationWeeks, derivedWeekStart, derivedWeekEnd }) =>
      [code, durationWeeks, derivedWeekStart, derivedWeekEnd])).toEqual([
      ["MI", 4, 1, 4], ["CPRH", 4, 5, 8],
      ["GOER", 4, 9, 12], ["DNPR", 4, 13, 16],
    ]);
    expect(report.every((course) => course.officialCatalogUrl.startsWith("https://catalog.sgu.edu/"))).toBe(true);
    expect(report.every((course) => course.note.includes("not verified activity lists"))).toBe(true);
    expect(report.every((course) => course.migrationReviewRequired)).toBe(true);
  });

  it("detects legacy in-app PPM course codes and unmatched NMI/MI without rewriting learner data", () => {
    const terms: Term[] = [{ id: "t4", name: "Term 4" }, { id: "t5", name: "Term 5" }];
    const courses: Course[] = [
      { id: "ppm4", termId: "t4", code: "PPM 500", name: "Old IV", files: 0, modules: [{ id: "ncrs", name: "NCRS" }] },
      { id: "ppm5", termId: "t5", code: "PPM 501", name: "Old V", files: 0, modules: [{ id: "nmi", name: "NMI" }] },
    ];
    const original = structuredClone({ terms, courses, curriculum: SGU_CURRICULUM });
    const report = officialSguClinicalCourseEvidence(SGU_CURRICULUM, { terms, courses });
    expect(report[0]).toMatchObject({
      appOutlineCourseCodes: ["PPM 500"], savedWorkspaceCourseCodes: ["PPM 500"], migrationReviewRequired: true,
    });
    expect(report[1]).toMatchObject({
      appOutlineCourseCodes: ["PPM 501"], savedWorkspaceCourseCodes: ["PPM 501"], migrationReviewRequired: true,
    });
    expect(report[1].modules[0]).toMatchObject({
      code: "MI", moduleMapping: "review-required",
    });
    expect({ terms, courses, curriculum: SGU_CURRICULUM }).toEqual(original);
  });

  it("recognizes current PCM codes and all exact module labels as aligned without silently changing the saved outline", () => {
    const updated = {
      ...SGU_CURRICULUM,
      terms: SGU_CURRICULUM.terms.map((term) => {
        if (term.name === "Term 4") return { ...term, courses: term.courses.map((course) => ({ ...course, code: "PCM 500" })) };
        if (term.name === "Term 5") return { ...term, courses: term.courses.map((course) => ({
          ...course, code: "PCM 501", modules: ["MI", "CPRH", "GOER", "DNPR"],
        })) };
        return term;
      }),
    };
    const report = officialSguClinicalCourseEvidence(updated, { terms: [], courses: [] });
    expect(report.every((course) => course.migrationReviewRequired === false)).toBe(true);
    expect(report.every((course) => course.modules.every((module) => module.moduleMapping === "exact"))).toBe(true);
    expect(SGU_CURRICULUM.terms[4].courses[0].modules[0]).toBe("NMI");
  });
});
