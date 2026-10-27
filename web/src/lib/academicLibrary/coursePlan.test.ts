import { describe, expect, it } from "vitest";
import {
  ACADEMIC_PLAN_SECTION_BREAK, academicCoursePlan, joinAcademicPlanSections, splitAcademicPlanSections,
} from "./coursePlan";

const lectures = "CPR 1 - Lectures + DLAs:\n\nLecture 01 Synthetic cardiac cycle [Lecture]\nDLA 02 Synthetic pressure loops [DLA]\n";
const groups = "CPR1 - Small groups:\nWeek 1:\nSG 01 Synthetic case [Small Group]\nWeek 2:\nSG 02 Synthetic case [Small Group]";
const term5 = "T5 - GOER - Lectures:\nWeek 2:\nLecture 01 Synthetic example [Lecture]\n";

describe("academic course plan sections", () => {
  it("round-trips exact section texts, including CRLF and a missing final newline", () => {
    const crlf = "CPR 1 - Labs:\r\nLab 01 Synthetic microscope [Lab]\r\n";
    const text = joinAcademicPlanSections([lectures, groups, crlf]);
    expect(splitAcademicPlanSections(text)).toEqual([lectures, groups, crlf]);
    expect(joinAcademicPlanSections([lectures])).toBe(lectures);
    expect(splitAcademicPlanSections(lectures)).toEqual([lectures]);
  });

  it("refuses a section containing the break line, so the join is unambiguous", () => {
    const forged = `CPR 1 - Lectures:${ACADEMIC_PLAN_SECTION_BREAK}Lecture 01 Synthetic [Lecture]`;
    expect(() => academicCoursePlan([forged], { term: "Term 1", evidence: "human-reviewed" })).toThrow(/readable activities/);
  });

  it("combines every section of one module under one classification", () => {
    const plan = academicCoursePlan([lectures, groups], { term: "Term 1", evidence: "human-reviewed" });
    expect(plan).toMatchObject({ term: "Term 1", module: "CPR 1", termStated: false });
    expect(plan.sections.map(section => section.title)).toEqual(["Lectures + DLAs", "Small groups"]);
    expect(splitAcademicPlanSections(plan.text)).toEqual([lectures, groups]);
  });

  it("never guesses a term the sections do not state", () => {
    expect(() => academicCoursePlan([lectures, groups])).toThrow(/does not name its term/);
    expect(academicCoursePlan([term5])).toMatchObject({ term: "Term 5", module: "GOER", termStated: true });
    expect(academicCoursePlan([term5], { term: "Term 5", evidence: "human-reviewed" }).termStated).toBe(true);
    expect(() => academicCoursePlan([term5], { term: "Term 4", evidence: "human-reviewed" })).toThrow(/states Term 5/);
    const unstated = "GOER - Small groups:\nWeek 2:\nSG 01 Synthetic [Small Group]";
    expect(academicCoursePlan([term5, unstated])).toMatchObject({ term: "Term 5", termStated: true });
  });

  it("rejects sections that disagree about module, term, cohort or section identity", () => {
    const confirmed = { term: "Term 1", evidence: "human-reviewed" } as const;
    expect(() => academicCoursePlan([lectures, term5])).toThrow(/different modules/);
    const otherTerm = "T4 - GOER - Small groups:\nWeek 1:\nSG 01 Synthetic [Small Group]";
    expect(() => academicCoursePlan([term5, otherTerm])).toThrow(/different or unsupported terms/);
    expect(() => academicCoursePlan(["T6 - GOER - Lectures:\nLecture 01 Synthetic [Lecture]"])).toThrow(/unsupported terms/);
    expect(() => academicCoursePlan([lectures, lectures.replace("Lecture 01", "Lecture 09")], confirmed)).toThrow(/share a title/);
    const cohortA = `@cohort: A\n${groups}`;
    expect(() => academicCoursePlan([lectures, cohortA], confirmed)).toThrow(/academic term or cohort/);
    expect(() => academicCoursePlan([lectures, "CPR 1 - Lectures:\nUnreadable line"], confirmed)).toThrow(/readable activities/);
  });

  it("keeps shared source context and the latest declared revision", () => {
    const first = `@academic-term: Fall 2026\n@source-revision: 2026-08-01\n${lectures}`;
    const second = `@academic-term: Fall 2026\n@source-revision: 2026-09-15\n${groups}`;
    expect(academicCoursePlan([first, second], { term: "Term 1", evidence: "human-reviewed" }))
      .toMatchObject({ academicTerm: "Fall 2026", sourceRevision: "2026-09-15" });
  });

  it("keeps the joined plan within the revision text limit", () => {
    const long = `CPR 1 - Lectures:\n${Array.from({ length: 6000 }, (_, index) => `Lecture ${index + 1} Synthetic topic with a long descriptive title [Lecture]`).join("\n")}`;
    expect(() => academicCoursePlan([long], { term: "Term 1", evidence: "human-reviewed" })).toThrow(/larger than 256 KB/);
  });
});
