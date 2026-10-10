import { describe, expect, it } from "vitest";
import { makeSeed } from "../seed";
import { parseImport, toPortableState } from "../backup";
import { courseTemplateVersions, prepareCourseTemplate, savedCourseTemplates } from "./templateLibrary";
import { parseCourseTemplate, planCourseTemplate, reconcileCourseTemplate } from "./templateParse";

const TEMPLATE = "DEMO - Lectures:\nWeek 1:\nLecture 01 First topic [Lecture]\nWeek 2:\nLecture 02 Second topic [Lecture]";

describe("saved course template versions", () => {
  it("keeps term-prefixed modules distinct and never rewrites progress from another term", () => {
    const section = parseCourseTemplate("T5 - SAMPLE - Lectures:\nWeek 2:\nLecture 01 Example [Lecture]");
    expect(section).toMatchObject({ term: "Term 5", module: "SAMPLE", title: "Lectures" });
    const plan = planCourseTemplate([section]);
    expect(plan.items[0].path).toBe("Term 5/SAMPLE/Week 2");
    const old = { ...plan.items[0], id: "old", path: "Term 4/SAMPLE/Week 2", passes: 3 };
    const result = reconcileCourseTemplate(plan, [old]);
    expect(result.create).toHaveLength(1);
    expect(result.update).toEqual([]);
    expect(old.passes).toBe(3);
  });

  it("identifies identical content across filenames without discarding changed versions", async () => {
    const original = await prepareCourseTemplate(TEMPLATE, "original.txt", "2026-01-01");
    const copy = await prepareCourseTemplate(TEMPLATE, "copy.txt", "2026-01-02");
    const updated = await prepareCourseTemplate(TEMPLATE.replace("Second topic", "Revised topic"), "update.txt", "2026-01-03");
    expect(copy.id).toBe(original.id);
    expect(updated.id).not.toBe(original.id);
    const groups = courseTemplateVersions(savedCourseTemplates([original, updated]));
    expect(groups).toHaveLength(1);
    expect(groups[0].map(({ document }) => document.id)).toEqual([updated.id, original.id]);
    expect(original.rawText).toBe(TEMPLATE);
  });

  it("round trips every version through the real portable workspace parser", async () => {
    const state = makeSeed();
    state.documents = await Promise.all([prepareCourseTemplate(TEMPLATE, "v1.txt"), prepareCourseTemplate(`${TEMPLATE}\nLecture 03 Third topic [Lecture]`, "v2.txt")]);
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(restored.documents).toEqual(state.documents);
    expect(savedCourseTemplates(restored.documents)).toHaveLength(2);
    expect(courseTemplateVersions(savedCourseTemplates(restored.documents))).toHaveLength(1);
  });

  it("rejects non-templates and excludes ordinary source documents from the library", async () => {
    await expect(prepareCourseTemplate("A schedule without activities", "schedule.txt")).rejects.toThrow("no course activities");
    const doc = await prepareCourseTemplate(TEMPLATE, "template.txt");
    expect(savedCourseTemplates([{ ...doc, fileType: "txt" }, { ...doc, rawText: "unreadable" }])).toEqual([]);
  });
});
