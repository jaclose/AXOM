import { describe, expect, it } from "vitest";
import type { Course, Term } from "./types";
import { mergeCurriculumMap, SGU_CURRICULUM } from "./curricula";

const existing = (): { terms: Term[]; courses: Course[] } => ({
  terms: [
    { id: "saved-t1", name: "T01", absenceAllowances: { lecture: 2 } },
    { id: "saved-t2", name: "term 2" },
  ],
  courses: [
    { id: "saved-bpm500", termId: "saved-t1", code: "01 BPM-500", name: "My edited course", files: 7,
      link: "https://example.test/syllabus", modules: [{ id: "saved-ftm", name: "FTM1" }, { id: "saved-bsce", name: "BSCE T1" }] },
    { id: "saved-local", termId: "saved-t2", code: "LOCAL 101", name: "My local course", files: 3,
      modules: [{ id: "saved-local-module", name: "My module" }] },
  ],
});

describe("complete SGU course map", () => {
  it("adds only missing shells to an edited two-course workspace and is pure on replay", () => {
    const source = existing();
    const before = JSON.stringify(source);
    const first = mergeCurriculumMap(source, SGU_CURRICULUM);
    expect(first.added).toEqual({ terms: 4, courses: 6, modules: 28 });
    expect(first.terms).toHaveLength(6);
    expect(first.courses).toHaveLength(8);
    expect(first.terms[0]).toBe(source.terms[0]);
    expect(first.courses[1]).toBe(source.courses[1]);
    expect(first.courses[0]).toMatchObject({ id: "saved-bpm500", termId: "saved-t1", code: "01 BPM-500",
      name: "My edited course", files: 7, link: "https://example.test/syllabus" });
    expect(first.courses[0].modules.slice(0, 2)).toEqual(source.courses[0].modules);
    expect(first.courses[0].modules).toHaveLength(7);
    expect(JSON.stringify(source)).toBe(before);

    const replay = mergeCurriculumMap({ terms: first.terms, courses: first.courses }, SGU_CURRICULUM);
    expect(replay.added).toEqual({ terms: 0, courses: 0, modules: 0 });
    expect(replay.terms).toBe(first.terms);
    expect(replay.courses).toBe(first.courses);
    expect(new Set(first.courses.flatMap(course => course.modules.map(module => module.id))).size)
      .toBe(first.courses.reduce((sum, course) => sum + course.modules.length, 0));
  });

  it("does not treat a matching course code in another term as the same course", () => {
    const source = existing();
    source.courses[0] = { ...source.courses[0], termId: "saved-t2" };
    const result = mergeCurriculumMap(source, SGU_CURRICULUM);
    expect(result.courses.find(course => course.id === "saved-bpm500")?.termId).toBe("saved-t2");
    expect(result.courses.filter(course => course.termId === "saved-t1" && course.code === "BPM 500")).toHaveLength(1);
    expect(result.added.courses).toBe(7);
  });
});
