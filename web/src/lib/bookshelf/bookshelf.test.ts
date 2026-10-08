import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SGU_CURRICULUM, buildCurriculum } from "../curricula";
import type { QuestionSet } from "../library";
import { readManifest } from "../question-content/packageJson";
import type { QuestionRecord } from "../questions";
import type { Course, Term, TrackerItem } from "../types";
import { buildCourseBooks, courseBookId } from "./courseBooks";
import { applyCourseLoad, planCourseLoad } from "./loadCourse";
import { SPINE_SCALE, buildShelves, spineHeight, spineThickness } from "./model";
import { buildQuestionBankBooks, practiceSelection, type KnownPackage } from "./questionBankBooks";

const now = "2026-10-08T00:00:00.000Z";
const row = (module: string, week: number, index: number, activity: TrackerItem["activity"], passes = 0): TrackerItem => ({
  id: `${module}-${week}-${activity}-${index}`, path: `Term 2/${module}/Week ${week}`, label: `Invented ${activity} ${index}`,
  kind: "Lecture", passes, ankiPasses: 0, yield: "none", updated: now, activity,
});
const question = (id: string, module: string, week: number, setId: string | undefined, over: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id, source: "imported", stem: `Invented ${id}`, options: [{ key: "A", text: "one" }, { key: "B", text: "two" }], correctKey: "B",
  status: "unanswered" as QuestionRecord["status"], module, week, ...(setId ? { setId } : {}), tags: [], attempts: [], createdAt: now, updatedAt: now, ...over,
});
const set = (id: string, title: string, module: string, week: number, questionIds: string[], kind: QuestionSet["kind"] = "source"): QuestionSet => ({
  id, title, sourceDocumentIds: [], createdAt: now, questionIds, tags: [], aiEnhanced: false, parserWarnings: [], scope: { module, week }, kind,
});
const workspace = (): { terms: Term[]; courses: Course[] } => {
  const built = buildCurriculum(SGU_CURRICULUM);
  // Term 5 is in the workspace with its course, and GOER is not loaded yet.
  return { terms: built.terms, courses: built.courses.map((course) => (course.code === "PPM 501" ? { ...course, modules: course.modules.filter((module) => module.name !== "GOER") } : course)) };
};
const goerPackages = (): KnownPackage[] => ["biostats-epidemiology", "pharmacodynamics-pk", "endocrine-pathophysiology"].map((bank) => ({
  manifest: readManifest(JSON.parse(readFileSync(join(process.cwd(), "..", "fixtures", "qbank", "goer", "t5", "week-02", bank, "manifest.json"), "utf8")), [])!,
  hasSource: false,
}));

describe("a spine's thickness", () => {
  it("grows with the content, slowly: more is thicker, never out of proportion", () => {
    const widths = [0, 1, 10, 50, 150, 400, 5000].map((count) => spineThickness(count));
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(new Set(widths.slice(1, 6)).size).toBe(5);
    expect(widths[0]).toBe(SPINE_SCALE.min);
    expect(widths[5]).toBe(SPINE_SCALE.max);
    expect(widths[6]).toBe(SPINE_SCALE.max);
    // Fifty times the content is not fifty times the width.
    expect(spineThickness(500) / spineThickness(10)).toBeLessThan(2);
    expect(spineThickness(-3)).toBe(SPINE_SCALE.min);
  });

  it("gives a book the same height every time, within a small range", () => {
    expect(spineHeight("course:term2:bpm501:er")).toBe(spineHeight("course:term2:bpm501:er"));
    for (const id of ["a", "b", "course:term5:ppm501:goer"]) {
      expect(spineHeight(id)).toBeGreaterThanOrEqual(0.86);
      expect(spineHeight(id)).toBeLessThanOrEqual(0.98);
    }
  });
});

describe("course books", () => {
  const { terms, courses } = workspace();
  const tracker = [
    ...Array.from({ length: 9 }, (_, index) => row("ER", 1, index + 1, "lecture", index < 3 ? 1 : 0)),
    ...Array.from({ length: 3 }, (_, index) => row("ER", 1, index + 1, "dla")),
    ...Array.from({ length: 4 }, (_, index) => row("ER", 2, index + 1, "lecture")),
    { ...row("ER", 1, 99, "lecture"), id: "loose", path: "Term 2/ER/Unsorted" },
    row("DM", 1, 1, "lecture"),
  ];
  const books = buildCourseBooks({ terms, courses, tracker, curricula: [SGU_CURRICULUM] });
  const book = (title: string) => books.find((entry) => entry.title === title)!;

  it("makes one book for each module of the course map, on its term's shelf, from real records", () => {
    expect(buildShelves(books).map((shelf) => shelf.label)).toEqual(["Term 1", "Term 2", "Term 3", "Term 4", "Term 5", "Boards"]);
    expect(buildShelves(books)[1].books.map((entry) => entry.title)).toEqual(["ER", "DM", "NB1", "NB2", "NB3", "BSCE 2"]);
    expect(book("ER")).toMatchObject({ identifier: "BPM 501", shelf: "Term 2", count: 17, countLabel: "17 activities", state: "available", origin: "workspace", unfiled: 1, done: 3 });
    expect(book("DM")).toMatchObject({ count: 1, countLabel: "1 activity" });
    expect(book("NB1")).toMatchObject({ count: 0, state: "empty", stateNote: "In your Course Tracker, with no activities yet." });
    // The spine carries the module's name as the data has it. Nothing is expanded.
    expect(books.every((entry) => entry.title === entry.module)).toBe(true);
  });

  it("opens to the Course Engine's own weeks and activity counts", () => {
    expect(book("ER").weeks.map((week) => [week.week, week.total, week.done, week.activities.map((activity) => activity.label)])).toEqual([
      [1, 12, 3, ["9 lectures", "3 DLAs"]],
      [2, 4, 0, ["4 lectures"]],
    ]);
    expect(book("ER").weeks[0].items[0]).toEqual({ id: "ER-1-lecture-1", label: "Invented lecture 1", kind: "Lecture" });
  });

  it("shows a module that is not loaded as an empty book from the course map, once", () => {
    expect(book("GOER")).toMatchObject({ identifier: "PPM 501", shelf: "Term 5", count: 0, state: "empty", stateNote: "Not loaded yet.", origin: "curriculum", weeks: [] });
    expect(books.filter((entry) => entry.title === "GOER")).toHaveLength(1);
    expect(books.filter((entry) => entry.title === "NMI")).toHaveLength(1);
    expect(new Set(books.map((entry) => entry.id)).size).toBe(books.length);
  });

  it("is thicker where there is more: thickness is read off the count and nothing else", () => {
    expect(spineThickness(book("ER").count)).toBeGreaterThan(spineThickness(book("DM").count));
    expect(spineThickness(book("DM").count)).toBeGreaterThan(spineThickness(book("NB1").count));
    expect(book("ER")).not.toHaveProperty("thickness");
  });
});

describe("loading a course book", () => {
  const start = workspace();
  const goer = buildCourseBooks({ ...start, tracker: [], curricula: [SGU_CURRICULUM] }).find((entry) => entry.title === "GOER")!;
  let counter = 0;
  const makeId = (prefix: string) => `${prefix}-${(counter += 1)}`;

  it("says what it will add before it adds it, and adds only what is missing", () => {
    expect(planCourseLoad(start, goer)).toEqual({
      alreadyPresent: false, addsTerm: false, addsCourse: false, addsModule: true,
      summary: "Adds the module GOER to your Course Tracker. Nothing you already have is changed or removed.",
    });
    const loaded = applyCourseLoad(start, goer, makeId);
    expect(loaded.terms).toEqual(start.terms);
    const before = start.courses.find((course) => course.code === "PPM 501")!;
    const after = loaded.courses.find((course) => course.code === "PPM 501")!;
    expect(after.modules.map((module) => module.name)).toEqual([...before.modules.map((module) => module.name), "GOER"]);
    expect(loaded.courses.filter((course) => course.code !== "PPM 501")).toEqual(start.courses.filter((course) => course.code !== "PPM 501"));
    // The workspace it was given is untouched.
    expect(before.modules.some((module) => module.name === "GOER")).toBe(false);
  });

  it("adds nothing the second time, and the book keeps its identity", () => {
    const once = applyCourseLoad(start, goer, makeId);
    const twice = applyCourseLoad(once, goer, makeId);
    expect(twice).toEqual(once);
    expect(planCourseLoad(once, goer)).toMatchObject({ alreadyPresent: true, summary: "GOER is already in your Course Tracker. Nothing will change." });
    const reloaded = buildCourseBooks({ ...once, tracker: [], curricula: [SGU_CURRICULUM] }).filter((entry) => entry.title === "GOER");
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toMatchObject({ id: goer.id, origin: "workspace", stateNote: "In your Course Tracker, with no activities yet." });
    expect(goer.id).toBe(courseBookId("Term 5", "PPM 501", "GOER"));
  });

  it("adds the term and the course too when the workspace has neither", () => {
    const loaded = applyCourseLoad({ terms: [], courses: [] }, goer, makeId);
    expect(loaded.terms.map((term) => term.name)).toEqual(["Term 5"]);
    expect(loaded.courses).toEqual([expect.objectContaining({ termId: loaded.terms[0].id, code: "PPM 501", name: "Principles & Practice of Medicine II", modules: [expect.objectContaining({ name: "GOER" })] })]);
    expect(planCourseLoad({ terms: [], courses: [] }, goer).summary).toBe("Adds the term Term 5, the course PPM 501, the module GOER to your Course Tracker. Nothing you already have is changed or removed.");
  });
});

describe("question bank books", () => {
  const { terms, courses } = workspace();
  const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
  const questions = [
    ...ids("imcq", 60).map((id) => question(id, "ER", 1, "s1")),
    ...ids("pq", 45).map((id, index) => question(id, "ER", 1, "s2", index < 6 ? { correctKey: undefined } : {})),
    ...ids("esoft", 80).map((id, index) => question(id, "ER", 2, "s3", index < 10 ? { attempts: [{ at: now, status: "correct" as QuestionRecord["status"] }] } : {})),
    ...ids("loose", 4).map((id) => question(id, "DM", 3, undefined)),
  ];
  const sets = [set("s1", "ER Week 1 IMCQ", "ER", 1, ids("imcq", 60)), set("s2", "ER Week 1 practice questions", "ER", 1, ids("pq", 45)), set("s3", "ER Week 2 ESoft", "ER", 2, ids("esoft", 80)), set("s4", "My mix", "ER", 1, ids("imcq", 20), "custom")];
  const books = buildQuestionBankBooks({ terms, courses, sets, questions, packages: goerPackages(), curricula: [SGU_CURRICULUM] });
  const book = (title: string) => books.find((entry) => entry.title === title)!;

  it("counts each question once, however many sets it is in", () => {
    expect(book("ER")).toMatchObject({ shelf: "Term 2", identifier: "BPM 501", count: 185, countLabel: "185 questions", ready: 179, attempted: 10, state: "available" });
    expect(book("ER").weeks.map((week) => [week.label, week.collections.map((collection) => [collection.title, collection.source, collection.questions, collection.ready, collection.status])])).toEqual([
      ["Week 1", [["ER Week 1 IMCQ", "IMCQ", 60, 60, "imported"], ["ER Week 1 practice questions", "School PQ", 45, 39, "awaiting-review"], ["My mix", "Personal", 20, 20, "imported"]]],
      ["Week 2", [["ER Week 2 ESoft", "ESoft", 80, 80, "imported"]]],
    ]);
    expect(book("DM").weeks[0].collections[0]).toMatchObject({ title: "Questions in no set", questions: 4, week: 3 });
  });

  it("files Term 5, GOER, Week 2 as three separate banks, and claims no question it does not have", () => {
    const goer = book("GOER");
    expect(goer).toMatchObject({ shelf: "Term 5", identifier: "PPM 501", count: 0, state: "empty", stateNote: "3 banks known, none on this device yet." });
    expect(goer.weeks).toHaveLength(1);
    expect(goer.weeks[0]).toMatchObject({ week: 2, label: "Week 2", questions: 0, ready: 0 });
    expect(goer.weeks[0].collections.map((collection) => [collection.title, collection.source, collection.status, collection.questions, collection.packageBankId])).toEqual([
      ["Biostatistics & Epidemiology", "Biostatistics / Epidemiology", "source-missing", 0, "goer-t5-w2-biostats-epidemiology"],
      ["Endocrine Pathophysiology", "Pathophysiology", "source-missing", 0, "goer-t5-w2-endocrine-pathophysiology"],
      ["Pharmacodynamics, Pharmacokinetics & Clinical Pharmacokinetics", "Pharmacology", "source-missing", 0, "goer-t5-w2-pharmacodynamics-pk"],
    ]);
    // A package that says it has seventeen questions adds none to the shelf until they are imported.
    const declared = buildQuestionBankBooks({ terms, courses, sets: [], questions: [], curricula: [SGU_CURRICULUM], packages: goerPackages().map((known) => ({ ...known, hasSource: true, summary: { questions: 17, images: 3, tables: 7, equations: 0, explanations: 5, answerKeys: 17, answerReveals: 2, blockedQuestions: 0, importable: true, issues: {} } })) });
    expect(declared[0]).toMatchObject({ title: "GOER", count: 0, state: "empty" });
    expect(declared[0].weeks[0].collections[0]).toMatchObject({ status: "available", questions: 0, declared: { questions: 17, images: 3, tables: 7, answerReveals: 2 } });
  });

  it("does not list a package twice once its bank is in the workspace", () => {
    const imported = buildQuestionBankBooks({
      terms, courses, curricula: [SGU_CURRICULUM], packages: goerPackages(),
      sets: [set("g1", "Endocrine Pathophysiology", "GOER", 2, ["g-1", "g-2"])],
      questions: [question("g-1", "GOER", 2, "g1"), question("g-2", "GOER", 2, "g1", { needsReview: true })],
    });
    const collections = imported.find((entry) => entry.title === "GOER")!.weeks[0].collections;
    expect(collections.map((collection) => [collection.title, collection.status, collection.questions, collection.ready])).toEqual([
      ["Biostatistics & Epidemiology", "source-missing", 0, 0],
      ["Endocrine Pathophysiology", "awaiting-review", 2, 1],
      ["Pharmacodynamics, Pharmacokinetics & Clinical Pharmacokinetics", "source-missing", 0, 0],
    ]);
  });

  it("offers for practice only what is ready, from sets only", () => {
    const er = book("ER");
    const week = er.weeks[0];
    const all = week.collections.map((collection) => collection.id);
    expect(practiceSelection(er, week, all, 20)).toEqual({ module: "ER", week: 1, setIds: ["s1", "s2", "s4"], count: 20 });
    expect(practiceSelection(er, week, ["set:s2"], 500)).toEqual({ module: "ER", week: 1, setIds: ["s2"], count: 39 });
    const goer = book("GOER");
    expect(practiceSelection(goer, goer.weeks[0], goer.weeks[0].collections.map((collection) => collection.id), 20)).toEqual({ module: "GOER", week: 2, setIds: [], count: 0 });
  });
});
