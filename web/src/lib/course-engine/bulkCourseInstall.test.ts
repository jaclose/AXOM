import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SGU_CURRICULUM } from "../curricula";
import type { SourceDocument } from "../library";
import type { Course, Term, TrackerItem } from "../types";
import { prepareCourseTemplate } from "./templateLibrary";
import {
  applyCurriculumTemplateInstallation,
  curriculumInstallationSignature,
  previewCurriculumTemplateInstallation,
} from "./bulkCourseInstall";

const term2: Term = { id: "term-t2", name: "T2" };
const course2: Course = {
  id: "course-bpm2", termId: term2.id, code: "01 BPM 501", name: "BPM II",
  files: 0, modules: [{ id: "short-nb", name: "NB2" }],
};
const empty = { terms: [term2], courses: [course2], tracker: [] as TrackerItem[] };
const lecture = "NB Block 2 - Lectures:\n\nNB Lecture 01 Synaptic Transmission [Lecture]";
const assessment = "NB2 - Small Groups:\n\nWeek 4 IMCQ [IMCQ]\nNB SG 01 Sensory Structures [Small Group]";
const saved = (text: string, name: string, id: string): SourceDocument => ({
  id, title: name, fileName: name, fileType: "axom-course-template",
  uploadedAt: "2026-10-14T12:00:00Z", rawText: text, sizeBytes: text.length,
  checksum: id, tags: ["course-template"], linkedQuestionSetIds: [], libraryOnly: true,
});
const idMaker = () => {
  let i = 0;
  return () => `role4-generated-${++i}`;
};
describe("review-first bulk school curriculum installation", () => {
  it("never turns inferred grouping into an official week by default", () => {
    const plan = previewCurriculumTemplateInstallation(
      SGU_CURRICULUM, [saved(lecture, "lec.txt", "lec"), saved(assessment, "group.txt", "group")], empty);
    expect(plan).toMatchObject({
      placement: "unassigned", sourceActivities: 3,
      sourceStatedWeeks: 1, provisionalWeeks: 0, unassignedWeeks: 2,
      create: 3, update: 0, reviewRequired: 0, issues: [],
    });
    expect(plan.modules).toHaveLength(1);
    const module = plan.modules[0];
    expect(module).toMatchObject({ term: "T2", courseCode: "01 BPM 501", module: "NB2", sourceFiles: 2 });
    expect(module.plan.items.map((item) => [item.label, item.path, item.weekSource])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))).toEqual([
      ["NB Lecture 01 Synaptic Transmission", "T2/01 BPM 501/NB2/Unscheduled", undefined],
      ["NB SG 01 Sensory Structures", "T2/01 BPM 501/NB2/Unscheduled", undefined],
      ["Week 4 IMCQ", "T2/01 BPM 501/NB2/Week 4", "template"],
    ]);
  });

  it("requires a deliberate provisional-mode preview to use group-order weeks", () => {
    const docs = [saved(lecture, "lec.txt", "lec"), saved(assessment, "group.txt", "group")];
    const conservative = previewCurriculumTemplateInstallation(SGU_CURRICULUM, docs, empty);
    const provisional = previewCurriculumTemplateInstallation(SGU_CURRICULUM, docs, empty, "provisional");
    expect(provisional.modules[0].plan.items.some((item) =>
      item.weekSource === "inferred" && /Week 4/.test(item.path))).toBe(true);
    expect(provisional).toMatchObject({ sourceActivities: 3, create: 3, sourceStatedWeeks: 1,
      provisionalWeeks: 2, unassignedWeeks: 0 });
    expect(curriculumInstallationSignature(provisional)).not.toBe(curriculumInstallationSignature(conservative));
  });

  it("creates only needed term/course/module shells, preserves IDs and progress, and reimport is idempotent", () => {
    const docs = [saved(lecture, "lec.txt", "lec")];
    const prior = { ...empty, tracker: [{
      id: "older-source", path: "T2/NB2/Week 10", label: "NB Lecture 01 OLD TITLE",
      templateKey: "nb2|lecture|1", activity: "lecture" as const, kind: "Lecture" as const,
      weekSource: "learner" as const, passes: 5, ankiPasses: 2,
      yield: "review" as const, attendance: "attended" as const,
      note: "Do not overwrite my old note",
      updated: "2026-09-12T06:00:00.000Z",
    }] };
    const preview = previewCurriculumTemplateInstallation(SGU_CURRICULUM, docs, prior);
    expect(preview).toMatchObject({ create: 0, update: 1 });
    const committed = applyCurriculumTemplateInstallation(prior, preview, idMaker(), "2026-10-14T20:00:00Z");
    expect(committed).toMatchObject({ createdRows: 0, revisedRows: 1,
      newTerms: 0, newCourses: 0, newModules: 0 });
    expect(committed.tracker[0]).toEqual({
      ...prior.tracker[0], label: "NB Lecture 01 Synaptic Transmission",
      path: "T2/01 BPM 501/NB2/Week 10",
    });
    const again = previewCurriculumTemplateInstallation(SGU_CURRICULUM, docs, committed);
    expect(again).toMatchObject({ create: 0, update: 0, unchanged: 1, reviewRequired: 0 });

    const otherTerm = { terms: [{ id: "t5", name: "Term 5" }], courses: [{
      id: "other", termId: "t5", code: "01 BPM 501", name: "Not term 2",
      files: 0, modules: [{ id: "nb2-copy", name: "NB2" }],
    }], tracker: [] as TrackerItem[] };
    const newPlan = previewCurriculumTemplateInstallation(SGU_CURRICULUM, docs, otherTerm);
    expect(newPlan.modules[0].path).toBe("Term 2/BPM 501/NB2");
    const result = applyCurriculumTemplateInstallation(otherTerm, newPlan, idMaker());
    expect(result).toMatchObject({ createdRows: 1, newTerms: 1, newCourses: 1, newModules: 1 });
    expect(result.courses.find((course) => course.id === "other")?.termId).toBe("t5");
    expect(result.tracker[0]).toMatchObject({
      path: "Term 2/BPM 501/NB2/Unscheduled", passes: 0, ankiPasses: 0,
    });
    expect(otherTerm.terms).toHaveLength(1);
  });

  it("holds unknown modules, conflicting term evidence, and same-name course collisions instead of guessing", () => {
    const docs = [
      saved("T1 - NB2 - Lectures:\nLecture 01 Conflicting [Lecture]", "badterm.txt", "wrong"),
      saved("UNKNOWN - Lectures:\nLecture 01 Misc [Lecture]", "unknown.txt", "unknown"),
    ];
    const report = previewCurriculumTemplateInstallation(SGU_CURRICULUM, docs, empty);
    expect(report).toMatchObject({ sourceActivities: 0, create: 0, issues: [
      { sourceModule: "NB2", sourceFiles: 1 },
      { sourceModule: "UNKNOWN", sourceFiles: 1 },
    ] });
    const duplicateTerm = { terms: [{ id: "first", name: "Term 2" }, term2], courses: [course2], tracker: [] };
    const conflicts = previewCurriculumTemplateInstallation(SGU_CURRICULUM, [saved(lecture, "lec.txt", "lec")], duplicateTerm);
    expect(conflicts.issues[0].reason).toMatch(/duplicate term shells/i);
  });



  it("preserves existing modern PCM500/PCM501 and MI identifiers rather than duplicating legacy shells", () => {
    const modern = {
      terms: [{ id: "t4", name: "Term 4" }, { id: "t5", name: "Term 5" }],
      courses: [
        { id: "modern-t4", termId: "t4", code: "PCM 500", name: "Current PCM I",
          files: 0, modules: [{ id: "existing-ftcm", name: "FTCM" }] },
        { id: "modern-t5", termId: "t5", code: "PCM 501", name: "Current PCM II",
          files: 0, modules: [{ id: "existing-mi", name: "MI" }] },
      ],
      tracker: [] as TrackerItem[],
    };
    const doc = saved("FTCM - Lectures:\n\nFTCM Lecture 01 Introduction [Lecture]", "ftcm.txt", "ftcm");
    const preview = previewCurriculumTemplateInstallation(
      SGU_CURRICULUM, [doc], modern, "unassigned", true,
    );
    expect(preview.modules[0]).toMatchObject({
      path: "Term 4/PCM 500/FTCM", courseCode: "PCM 500", module: "FTCM",
    });
    expect(preview.missingOutlineModules).toBe(21);
    const next = applyCurriculumTemplateInstallation(modern, preview, idMaker());
    expect(next).toMatchObject({ createdRows: 1, newTerms: 3, newCourses: 3,
      newModules: 21 });
    const currentPCM = next.courses.filter((course) => ["PCM 500", "PCM 501"].includes(course.code));
    expect(currentPCM.map((course) => [course.id, course.code])).toEqual([
      ["modern-t4", "PCM 500"], ["modern-t5", "PCM 501"],
    ]);
    expect(next.courses.some((course) => ["PPM 500", "PPM 501"].includes(course.code))).toBe(false);
    const firstT5 = next.courses.find((course) => course.id === "modern-t5")!;
    expect(firstT5.modules.filter((module) => ["MI", "NMI"].includes(module.name))).toEqual([
      { id: "existing-mi", name: "MI" },
    ]);
    expect(next.tracker).toHaveLength(1);
    expect(next.tracker[0].path).toBe("Term 4/PCM 500/FTCM/Unscheduled");
  });

  it("holds a disputed NMI source against an already established modern MI module for human review", () => {
    const term = { id: "t5", name: "Term 5" };
    const workspace = { terms: [term], courses: [{
      id: "current", termId: "t5", code: "PCM 501", name: "Current II", files: 0,
      modules: [{ id: "mi", name: "MI" }],
    }], tracker: [] as TrackerItem[] };
    const source = saved("T5 - NMI - Lectures:\n\nNMI Lecture 01 Introduction [Lecture]",
      "mi-ambiguous.txt", "nmi-revision");
    const preview = previewCurriculumTemplateInstallation(SGU_CURRICULUM, [source], workspace);
    expect(preview.modules).toEqual([]);
    expect(preview.issues).toMatchObject([{ sourceModule: "NMI", sourceFiles: 1,
      reason: expect.stringMatching(/MI versus NMI/) }]);
    expect(preview.create).toBe(0);
  });

  it("optionally installs the complete 23-module T1–T5 shell without inventing T4/T5 activities", () => {
    const docs = [saved(lecture, "lec.txt", "lec")];
    const preview = previewCurriculumTemplateInstallation(SGU_CURRICULUM, docs, empty, "unassigned", true);
    expect(preview).toMatchObject({
      includeOutline: true, missingOutlineModules: 22, sourceActivities: 1, create: 1,
    });
    expect(preview.outlineModules).toHaveLength(23);
    const installed = applyCurriculumTemplateInstallation(empty, preview, idMaker(), "2026-10-14T18:00:00Z");
    expect(installed).toMatchObject({ createdRows: 1, revisedRows: 0, newTerms: 4,
      newModules: 22 });
    expect(installed.terms.map((term) => term.name).sort()).toEqual([
      "T2", "Term 1", "Term 3", "Term 4", "Term 5",
    ]);
    expect(installed.courses.flatMap((course) => course.modules)).toHaveLength(23);
    expect(installed.tracker).toHaveLength(1);
    expect(installed.tracker.every((row) => row.path.startsWith("T2/"))).toBe(true);
    const again = previewCurriculumTemplateInstallation(SGU_CURRICULUM, docs, installed, "unassigned", true);
    expect(again).toMatchObject({ create: 0, update: 0, missingOutlineModules: 0, unchanged: 1 });
  });

  it("never invents missing Term 4 or Term 5 official activity schedules", () => {
    const preview = previewCurriculumTemplateInstallation(SGU_CURRICULUM, [], {
      terms: [], courses: [], tracker: [],
    });
    expect(preview).toMatchObject({ activeSourceFiles: 0, sourceActivities: 0,
      create: 0, update: 0, modules: [], issues: [] });
    expect(() => applyCurriculumTemplateInstallation({ terms: [], courses: [], tracker: [] }, preview)).toThrow(/no new/i);
  });

  it("is non-destructive when source revisions rename a numbered lecture", () => {
    const first = saved(lecture, "lec.txt", "lecture-old");
    const prepared = applyCurriculumTemplateInstallation(empty,
      previewCurriculumTemplateInstallation(SGU_CURRICULUM, [first], empty),
      idMaker(), "2026-10-14T17:00:00Z");
    expect(prepared.createdRows).toBe(1);
    const afterStudy = { ...prepared, tracker: prepared.tracker.map((item) => ({ ...item,
      passes: 3, ankiPasses: 1, updated: "2026-10-15T08:00:00Z", note: "Learner-owned" })) };
    const revision = saved(
      "NB Block 2 - Lectures:\n\nNB Lecture 01 Synaptic Plasticity [Lecture]",
      "lec.txt", "lecture-revised");
    const review = previewCurriculumTemplateInstallation(SGU_CURRICULUM, [revision], afterStudy);
    expect(review).toMatchObject({ create: 0, update: 1, reviewRequired: 0 });
    const result = applyCurriculumTemplateInstallation(afterStudy, review, idMaker());
    expect(result.tracker[0]).toMatchObject({
      id: prepared.tracker[0].id, label: "NB Lecture 01 Synaptic Plasticity",
      passes: 3, ankiPasses: 1, note: "Learner-owned", updated: "2026-10-15T08:00:00Z",
    });
  });
});

const privateRoot = process.env.AXOM_TEMPLATE_ROOT;
const sourceTest = privateRoot ? it : it.skip;
sourceTest("all 22 private SGU text sources reconcile as 547 exact personal activities without inventing weeks", async () => {
  const names = readdirSync(privateRoot!).filter((name) => /^\d{2}_.+\.txt$/.test(name)).sort();
  const docs = await Promise.all(names.map((name) => prepareCourseTemplate(
    readFileSync(join(privateRoot!, name), "utf8"), name,
  )));
  const preview = previewCurriculumTemplateInstallation(SGU_CURRICULUM, docs, {
    terms: [], courses: [], tracker: [],
  });
  expect(names).toHaveLength(22);
  expect(preview).toMatchObject({
    activeSourceFiles: 22, sourceActivities: 547, create: 547,
    update: 0, reviewRequired: 0, issues: [],
    sourceStatedWeeks: 5, provisionalWeeks: 0, unassignedWeeks: 542,
  });
  expect(preview.modules).toHaveLength(11);
  const plan = applyCurriculumTemplateInstallation({ terms: [], courses: [], tracker: [] },
    preview, idMaker());
  expect(plan).toMatchObject({ createdRows: 547, revisedRows: 0,
    newTerms: 3, newCourses: 3, newModules: 11 });
  expect(plan.tracker).toHaveLength(547);
  expect(plan.tracker.filter((row) => /\/Unscheduled$/.test(row.path))).toHaveLength(542);
  expect(plan.tracker.filter((row) => row.weekSource === "template")).toHaveLength(5);
  expect(new Set(plan.tracker.map((row) => row.templateKey)).size).toBe(547);
  const again = previewCurriculumTemplateInstallation(SGU_CURRICULUM, docs, plan);
  expect(again).toMatchObject({ create: 0, update: 0, unchanged: 547, reviewRequired: 0 });
});
