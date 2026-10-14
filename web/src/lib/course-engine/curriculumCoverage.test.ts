import { describe, expect, it } from "vitest";
import { SGU_CURRICULUM, type CurriculumTemplate } from "../curricula";
import type { SourceDocument } from "../library";
import type { TrackerItem } from "../types";
import { buildCurriculumCoverage } from "./curriculumCoverage";

function doc(name: string, rawText: string, revision = "2026-10-14"): SourceDocument {
  return {
    id: `fixture-${name}-${revision}`, fileType: "axom-course-template", fileName: name,
    title: name, uploadedAt: `${revision}T12:00:00.000Z`, rawText, sizeBytes: rawText.length,
    checksum: name, tags: ["course-template"], linkedQuestionSetIds: [], libraryOnly: true,
  };
}
function row(path: string, label: string, templateKey?: string): TrackerItem {
  return {
    id: `${path}-${label}`, path, label, kind: "Lecture", passes: 2, ankiPasses: 1,
    yield: "none", updated: "2026-10-14T12:00:00.000Z", templateKey,
  };
}

describe("curriculum evidence coverage", () => {
  it("lists all five term outlines without inventing source activities", () => {
    const matrix = buildCurriculumCoverage(SGU_CURRICULUM, [], []);
    expect(matrix.terms.map((term) => term.term)).toEqual(["Term 1", "Term 2", "Term 3", "Term 4", "Term 5"]);
    expect(matrix.totalModules).toBe(23);
    expect(matrix.modulesWithTemplates).toBe(0);
    expect(matrix.sourceItems).toBe(0);
    expect(matrix.notInstalled).toBe(0);
    expect(matrix.terms[3].modules.every((module) => module.mapping === "no-template")).toBe(true);
  });

  it("maps long/short module aliases only through a unique curriculum outline", () => {
    const documents = [
      doc("NB-block.txt", "NB Block 2 - Lectures:\n\nNB Lecture 01 Anatomy [Lecture]"),
      doc("BPM502-pre.txt", "BPM502 Pre-Midterm - Lectures:\n\nBPM Lecture 01 Cell injury [Lecture]"),
    ];
    const matrix = buildCurriculumCoverage(SGU_CURRICULUM, documents, [
      row("Term 2/NB2/Week 1", "NB Lecture 01 Anatomy"),
    ]);
    const nb = matrix.terms[1].modules.find((module) => module.module === "NB2")!;
    const pre = matrix.terms[2].modules.find((module) => module.module === "Pre-Midterm")!;
    expect(nb).toMatchObject({ templateFiles: 1, availableTemplateItems: 1, installedTemplateItems: 0, notInstalled: 1 });
    expect(pre).toMatchObject({ templateFiles: 1, availableTemplateItems: 1, notInstalled: 1 });
    // The row is real but its unverified placement is not the plan's "Unscheduled" path.
    expect(nb.installedRows).toBe(1);
  });


  it("counts saved-template rows installed under an established short alias", () => {
    const source = doc("NB2.txt", "NB Block 2 - Lectures:\n\nNB Lecture 01 Vessels [Lecture]");
    const matrix = buildCurriculumCoverage(SGU_CURRICULUM, [source], [
      row("Term 2/NB2/Week 2", "NB Lecture 01 Vessels", "nb2|lecture|1"),
    ]);
    const nb = matrix.terms[1].modules.find((entry) => entry.module === "NB2")!;
    expect(nb).toMatchObject({
      availableTemplateItems: 1, installedTemplateItems: 1,
      notInstalled: 0, installedRows: 1,
    });
  });

  it("tracks missing activity rows without mistaking the absence of a template for a known zero", () => {
    const text = "T4 - NCRS - Lectures:\n\nWeek 3:\nNCRS Lecture 01 Heart Failure [Lecture]\nNCRS Lecture 02 Arrhythmias [Lecture]";
    const matrix = buildCurriculumCoverage(SGU_CURRICULUM, [doc("NCRS.txt", text)], [
      row("Term 4/NCRS/Week 3", "NCRS Lecture 01 Heart Failure", "ncrs|lecture|1"),
    ]);
    const ncrs = matrix.terms[3].modules.find((module) => module.module === "NCRS")!;
    expect(ncrs).toMatchObject({ templateFiles: 1, availableTemplateItems: 2, installedTemplateItems: 1, notInstalled: 1, statedWeeks: [3], inferredWeeks: [] });
    expect(matrix.terms[3].modules.find((module) => module.module === "FTCM")?.templateFiles).toBe(0);
  });


  it("shows a T5 QBank collection without falsely claiming a T5 course activity template exists", () => {
    const stamp = "2026-10-14T12:00:00.000Z";
    const courseId = "ppm-501";
    const terms = [{ id: "t5", name: "Term 5" }];
    const courses = [{ id: courseId, termId: "t5", name: "PPM II", code: "PPM 501", files: 0,
      modules: [{ id: "goer", name: "GOER" }] }];
    const questions = [
      { id: "answerable", source: "imported" as const, stem: "Verified",
        options: [{ key: "A", text: "Correct" }, { key: "B", text: "Distractor" }],
        correctKey: "A", status: "unseen" as const, tags: [], attempts: [],
        setId: "goer-bank", module: "GOER", courseId, week: 2, createdAt: stamp, updatedAt: stamp },
      { id: "needs-review", source: "imported" as const, stem: "Unresolved",
        options: [{ key: "A", text: "Option" }, { key: "B", text: "Other" }],
        status: "unseen" as const, tags: [], attempts: [],
        setId: "goer-bank", module: "GOER", courseId, week: 2, createdAt: stamp, updatedAt: stamp },
    ];
    const sets = [{ id: "goer-bank", title: "GOER source", questionIds: ["answerable", "needs-review"],
      scope: { module: "GOER", week: 2, courseId }, sourceDocumentIds: [], tags: [], aiEnhanced: false,
      parserWarnings: [], createdAt: stamp }];
    const matrix = buildCurriculumCoverage(SGU_CURRICULUM, [], [], { terms, courses, sets, questions });
    const goer = matrix.terms[4].modules.find((item) => item.module === "GOER")!;
    expect(goer).toMatchObject({
      mapping: "no-template", templateFiles: 0,
      availableTemplateItems: 0, installedTemplateItems: 0,
      questionCollections: 1, storedQuestions: 2, readyQuestions: 1, reviewQuestions: 1,
      indexedQuestionWeeks: [2],
    });
    expect(matrix.terms[4]).toMatchObject({ modulesWithTemplates: 0, questionCollections: 1, readyQuestions: 1 });
  });


  it("does not double-count course-owned tracker rows or questions when two courses share a module", () => {
    const outline: CurriculumTemplate = {
      id: "collision-curriculum", label: "Collision",
      terms: [{ name: "Term 4", courses: [
        { code: "PPM 500", name: "Core", modules: ["SHARED"] },
        { code: "ELECTIVE", name: "Elective", modules: ["SHARED"] },
      ] }],
    };
    const activity = "Lecture 01 One shared topic";
    const rows = [
      row("Term 4/PPM 500/SHARED/Week 2", activity, "shared|lecture|1"),
      row("Term 4/ELECTIVE/SHARED/Week 2", activity, "shared|lecture|1"),
      row("Term 4/SHARED/Week 2", activity, "shared|lecture|1"),
    ];
    const stamp = "2026-10-14T12:00:00.000Z";
    const createQuestion = (id: string, courseId: string, setId: string) => ({
      id, module: "SHARED", courseId, setId, week: 2, source: "imported" as const,
      stem: id, options: [{ key: "A", text: "Correct" }, { key: "B", text: "Other" }],
      correctKey: "A", status: "unseen" as const, tags: [], attempts: [],
      createdAt: stamp, updatedAt: stamp,
    });
    const makeSet = (id: string, courseId: string) => ({
      id, title: id, scope: { module: "SHARED", courseId, week: 2 }, questionIds: [id],
      createdAt: stamp, tags: [], aiEnhanced: false, parserWarnings: [], sourceDocumentIds: [],
    });
    const matrix = buildCurriculumCoverage(outline, [
      doc("unqualified-shared.txt", "SHARED - Lectures:\nLecture 01 One shared topic [Lecture]"),
    ], rows, {
      terms: [{ id: "t4", name: "Term 4" }],
      courses: [
        { id: "core", termId: "t4", code: "PPM 500", name: "Core", files: 0, modules: [{ id: "core-mod", name: "SHARED" }] },
        { id: "elective", termId: "t4", code: "ELECTIVE", name: "Elective", files: 0, modules: [{ id: "elective-mod", name: "SHARED" }] },
      ],
      sets: [makeSet("core-set", "core"), makeSet("elective-set", "elective")],
      questions: [
        createQuestion("core-set", "core", "core-set"),
        createQuestion("elective-set", "elective", "elective-set"),
      ],
    });
    expect(matrix.terms[0].modules.map((module) => [
      module.courseCode, module.installedRows, module.readyQuestions, module.questionCollections,
      module.templateFiles, module.mapping,
    ])).toEqual([
      ["PPM 500", 1, 1, 1, 0, "ambiguous"],
      ["ELECTIVE", 1, 1, 1, 0, "ambiguous"],
    ]);
    expect(matrix.installedRows).toBe(2);
    expect(matrix.unmappedTrackerRows).toBe(1);
    expect(matrix.unmappedTemplateModules).toEqual(["SHARED"]);
    expect(matrix.sourceItems).toBe(0);
    expect(matrix.sourceTemplateFiles).toBe(1);
  });

  it("places a source with an explicitly stated term in that term only, even when a module repeats", () => {
    const repeated: CurriculumTemplate = {
      id: "cross-term", label: "Cross-term",
      terms: [
        { name: "Term 4", courses: [{ code: "PPM 500", name: "Core IV", modules: ["SHARED"] }] },
        { name: "Term 5", courses: [{ code: "PPM 501", name: "Core V", modules: ["SHARED"] }] },
      ],
    };
    const matrix = buildCurriculumCoverage(repeated, [
      doc("explicit.txt", "T4 - SHARED - Lectures:\nWeek 2:\nLecture 01 Explicitly in Term 4 [Lecture]"),
    ], [
      row("T4/SHARED/Week 2", "Lecture 01 Explicitly in Term 4", "shared|lecture|1"),
      row("Term 5/PPM 501/SHARED/Week 2", "Term 5 local task"),
    ]);
    expect(matrix.terms[0].modules[0]).toMatchObject({
      templateFiles: 1, availableTemplateItems: 1, installedTemplateItems: 1, installedRows: 1,
      statedWeeks: [2], mapping: "outline-match",
    });
    expect(matrix.terms[1].modules[0]).toMatchObject({
      templateFiles: 0, availableTemplateItems: 0, installedRows: 1,
      mapping: "no-template",
    });
    expect(matrix.unmappedTrackerRows).toBe(0);
    expect(matrix.unmappedTemplateModules).toEqual([]);
  });

  it("uses current template revisions rather than summing historical source versions", () => {
    const first = doc("NCRS.txt", "NCRS - Lectures:\n\nNCRS Lecture 01 Old [Lecture]", "2026-01-01");
    const revised = doc("NCRS.txt", "NCRS - Lectures:\n\nNCRS Lecture 01 New [Lecture]\nNCRS Lecture 02 More [Lecture]", "2026-10-14");
    const matrix = buildCurriculumCoverage(SGU_CURRICULUM, [first, revised], []);
    expect(matrix.sourceTemplateFiles).toBe(1);
    expect(matrix.terms[3].modules.find((module) => module.module === "NCRS")?.availableTemplateItems).toBe(2);
  });
});
