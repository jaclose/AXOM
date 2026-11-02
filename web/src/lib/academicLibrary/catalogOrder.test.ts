import { describe, expect, it } from "vitest";
import { compareCourses, coursesByTerm, curriculumModuleRank } from "./catalogOrder";

describe("academic course order", () => {
  it("orders terms numerically and modules by the curriculum outline, then by name", () => {
    const courses = [
      { term: "Term 5", module: "GOER" }, { term: "Term 1", module: "CPR 1" }, { term: "Term 1", module: "Elective B" },
      { term: "Term 1", module: "FTM1" }, { term: "Boards", module: "STEP 1" }, { term: "Term 1", module: "Elective A" },
      { term: "T2", module: "NB 2" }, { term: "Term 2", module: "ER" }, { term: "Term 1", module: "MSK" },
    ];
    expect([...courses].sort(compareCourses).map(course => `${course.term}/${course.module}`)).toEqual([
      "Term 1/FTM1", "Term 1/MSK", "Term 1/CPR 1", "Term 1/Elective A", "Term 1/Elective B",
      "Term 2/ER", "T2/NB 2", "Term 5/GOER", "Boards/STEP 1",
    ]);
    expect(curriculumModuleRank("Term 5", "GOER")).toBeLessThan(curriculumModuleRank("Term 5", "DNPR"));
    expect(curriculumModuleRank("Term 5", "Unknown")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("groups courses by term without dropping or repeating any", () => {
    const groups = coursesByTerm([
      { id: "c", term: "Term 4", module: "NCRS" }, { id: "a", term: "Term 1", module: "MSK" }, { id: "b", term: "Term 1", module: "FTM 2" },
    ]);
    expect(groups.map(group => [group.term, group.courses.map(course => course.id)])).toEqual([["Term 1", ["b", "a"]], ["Term 4", ["c"]]]);
  });
});
