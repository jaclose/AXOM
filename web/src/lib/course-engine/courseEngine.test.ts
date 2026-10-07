import { describe, expect, it } from "vitest";
import type { QuestionRecord } from "../questions";
import { attendanceCategory, countActivity, TRACKER_KIND_FOR_ACTIVITY } from "./activity";
import { groupQuestionsByScope, questionScope, scopeKey, scopeProgress, trackerPathScope } from "./scope";
import { describeMapping, inferSourceMapping } from "./sourceMapping";
import {
  moduleAliases, parseCourseTemplate, planCourseTemplate, reconcileCourseTemplate, templateModules,
} from "./templateParse";
import { buildVocabulary, vocabularyFromCourses } from "./vocabulary";

// Names below follow the shapes found in a real folder of course files; the
// rules were corrected against a hand-checked sample of that folder.
const vocabulary = buildVocabulary([
  { code: "FTM 1", term: "Term 1" },
  { code: "FTM 2", term: "Term 1" },
  { code: "CPR 1", term: "Term 1" },
  { code: "CPR 2", term: "Term 1" },
  { code: "MSK", term: "Term 1" },
  { code: "ER", term: "Term 2" },
  { code: "NB Block 2", aliases: ["NB2"], term: "Term 2" },
  { code: "BPM502 Pre-Midterm", aliases: ["Pre-Midterm"], term: "Term 3" },
  { code: "BPM502 Post-Midterm", aliases: ["Post-Midterm"], term: "Term 3" },
  { code: "NCRS" },
]);
const map = (path: string) => inferSourceMapping(path, vocabulary);

describe("reading where a file belongs from its name", () => {
  it("files a quiz key under its module, number and term without asking", () => {
    const mapping = map("Review/T1 copy/CPR 1 & 2/CPR 1/IMCQ/CPR IMCQ Key _ 06.pdf");
    expect(mapping).toMatchObject({
      term: { value: "T1" }, module: { value: "CPR 1" }, activity: { value: "imcq" },
      number: 6, variant: "with-answers", status: "mapped",
    });
    expect(describeMapping(mapping)).toBe("T1 · CPR 1");
  });

  it("reads the week a file states, including a range, and keeps a folder's position apart", () => {
    const ranged = map("Bank/T1/CPR1 2/CPR Week 10_11 - Practice Questions - Anatomy_ Cardiovascular system.pdf");
    expect(ranged.week?.value).toBe(10);
    expect(ranged.weekEnd).toBe(11);
    // "CPR1 2" is the module's second part. It is not week 2 of the term.
    expect(ranged.part?.value).toBe(2);
    expect(map("Bank/T1/FTM1 1/Cell Biology Practice Questions with Answers.pdf").week).toBeUndefined();
    expect(map("Quizzes/Summer 2026_Week 3 Exam Soft Quiz_Questions only.pdf").week?.value).toBe(3);
  });

  it("takes the term from the module when no folder names it", () => {
    const mapping = map("Master Folder/NB3 Quiz/NB2 files/Week 12 NB NSCI Practice Questions_Updated.pdf");
    expect(mapping.module?.value).toBe("NB Block 2");
    expect(mapping.term).toMatchObject({ value: "T2", evidence: "NB Block 2 belongs to T2" });
  });

  it("prefers a module named outright in a folder over a prefix two modules share", () => {
    const mapping = map("Bank/T1/CPR2 2/CPR 33 Hemoglobinopathies Practice Questions with Answers.pdf");
    expect(mapping.module).toMatchObject({ value: "CPR 2" });
    expect(mapping.module!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("asks when a shared prefix is all it has", () => {
    const mapping = map("Loose/CPR Week 12 - Practice Questions Exercise physiology.pdf");
    expect(mapping.module?.evidence).toContain("could be CPR 1 or CPR 2");
    expect(mapping.status).toBe("needs-confirmation");
  });

  it("lists the lectures a practice set covers and its topic", () => {
    const mapping = map("NCRS PQs/week 3 pq copy/NCRS 18, 20 PQ - Antiarrhythmics (Set 3).pdf");
    expect(mapping).toMatchObject({
      module: { value: "NCRS" }, week: { value: 3 }, activity: { value: "pq" },
      lectureRefs: [18, 20], topic: "Antiarrhythmics (Set 3)", duplicateMarker: true, status: "mapped",
    });
    // No course says which term NCRS is in, and nothing in the path does either.
    expect(mapping.term).toBeUndefined();
  });

  it("tells the two forms of one quiz apart", () => {
    expect(map("NCRS PQs/week 2/Examsoft Quiz 4 (With Answers).pdf").variant).toBe("with-answers");
    expect(map("NCRS PQs/week 2/Examsoft Quiz 4 (Without Answers) (1).pdf").variant).toBe("questions-only");
    expect(map("ER T2/eSoft/BPM2_ESOFT QUIZ 2_S2026_GD Blank.pdf")).toMatchObject({ variant: "questions-only", number: 2 });
  });

  it("keeps a quiz number that sits between underscores or hyphens", () => {
    expect(map("FTM 1/eSoft/FTM_Esoft_Quiz_2_1_.pdf").number).toBe(2);
    expect(map("CPR 2/eSoft/CPR Esoft Quiz-4-Answers and Rationale.doc.pdf")).toMatchObject({ number: 4, variant: "with-answers" });
    expect(map("Pre-Midterm quizzes/imcq5.pdf")).toMatchObject({ activity: { value: "imcq" }, number: 5 });
  });

  it("does not let a collection folder or a module's own name decide what a file is", () => {
    // "PQ" three levels up describes the pile, not this file.
    expect(map("PQ Qbank Collection/Modules/Course PDFs/MSK Course Outline.pdf").activity).toBeUndefined();
    // "Pre-Midterm" is the module, not a midterm exam.
    expect(map("Packages/T3_PreMidterm_Lectures.txt").activity?.value).toBe("lecture");
    expect(map("MSK/MSK Lecture_DLA Objectives - Fall 2025.pdf").activity?.value).toBe("objectives");
  });

  it("does not mistake a publisher's name for an answer key, and flags a list that points into a book", () => {
    const publisher = map("NCRS PQs/wk 5/NCRS Pharmacology (ClinicalKey Student) - ANS Drugs-1.pdf");
    expect(publisher.variant).toBeUndefined();
    expect(publisher.referenceCandidate).toBe(true);
    const textbook = map("Bank/T1/MSK 1-3/MSK Week 6 PRACTICE QUESTIONS FROM GRAY.pdf");
    expect(textbook).toMatchObject({ referenceCandidate: true, status: "needs-confirmation", week: { value: 6 } });
  });

  it("offers a module for a folder one letter off, without filing it", () => {
    const mapping = map("Master Folder/PreMidtern eSoft:Quiz/IMCQ 1.pdf");
    expect(mapping.module?.value).toBe("BPM502 Pre-Midterm");
    expect(mapping.module?.evidence).toContain("close to");
    expect(mapping.status).toBe("needs-confirmation");
  });

  it("reports evidence that disagrees instead of picking a side", () => {
    const mapping = map("Review/T2 copy/Mixed Questions/FTM 2 REVIEW 2.pdf");
    expect(mapping.conflicts).toEqual([
      'file "FTM 2 REVIEW 2.pdf" sits under T2, but FTM 2 belongs to T1.',
    ]);
    expect(mapping.status).toBe("needs-confirmation");
  });

  it("leaves a file with no module in its path unresolved, and short codes inside words alone", () => {
    expect(map("Books/fundamentals-of-pathology.pdf").status).toBe("unresolved");
    // "ER" is a module; "er" inside or beside ordinary words is not.
    expect(map("Notes/summer er visits.pdf").module).toBeUndefined();
    expect(map("Review/ER OPLG notes.pdf").module?.value).toBe("ER");
  });

  it("builds its vocabulary from a workspace's own courses", () => {
    const fromCourses = vocabularyFromCourses(
      [{ id: "term-1", name: "Term 1" }],
      [{ termId: "term-1", modules: [{ name: "FTM 1" }, { name: "MSK" }] }],
    );
    expect(inferSourceMapping("Any/FTM IMCQ1.pdf", fromCourses)).toMatchObject({
      module: { value: "FTM 1" }, term: { value: "T1" }, number: 1,
    });
  });
});

const LECTURES = [
  "DEMO 1 - Lectures + DLAs:",
  "",
  "DEMO Lecture 01 First topic [Lecture]",
  "DLA 01 Background reading [DLA]",
  "",
  "DEMO Lecture 02 Second topic [Flipped Lecture]",
  "",
  "DEMO Lecture 03 Third topic [Lecture]",
  "",
  "DEMO Lecture 04 Fourth topic [Lecture]",
  "DLA 02 More reading [DLA]",
].join("\n");

const ACTIVITIES = [
  "DEMO 1 - Small Groups + IMCQs + ESoft:",
  "",
  "DEMO SG 01 Introduction [Small Group]",
  "DEMO IMCQ 01 [IMCQ]",
  "DEMO ESoft Quiz 01 [ESoft]",
  "",
  "DEMO SG 02 Cases [Small Group]",
  "DEMO IMCQ 02 [IMCQ]",
  "DEMO ESoft Quiz 02 [ESoft]",
].join("\n");

describe("course templates", () => {
  it("reads the module, the groups and every bracketed kind", () => {
    const section = parseCourseTemplate(LECTURES, "lectures.txt");
    expect(section).toMatchObject({ module: "DEMO 1", title: "Lectures + DLAs", groupCount: 4, problems: [] });
    expect(section.items.map((item) => [item.activity, item.number, item.group])).toEqual([
      ["lecture", 1, 1], ["dla", 1, 1], ["flipped-lecture", 2, 2], ["lecture", 3, 3], ["lecture", 4, 4], ["dla", 2, 4],
    ]);
  });

  it("reports a line it cannot read instead of guessing", () => {
    const section = parseCourseTemplate("DEMO 1 - Lectures:\n\nA lecture with no kind\nAnother one [Seminar]\n");
    expect(section.problems).toEqual([
      'Line 3 has no kind in brackets: "A lecture with no kind"',
      "Line 4 uses a kind AXOM does not know: [Seminar]",
    ]);
    // The unknown kind is kept as a row, so nothing the learner listed disappears.
    expect(section.items).toEqual([expect.objectContaining({ label: "Another one", activity: "other" })]);
  });

  it("takes weekly groups as weeks and spreads the day-by-day lectures across them, saying so", () => {
    const plan = planCourseTemplate([parseCourseTemplate(LECTURES), parseCourseTemplate(ACTIVITIES)], { term: "T1" });
    expect(plan.weekCount).toBe(2);
    expect(plan.items.filter((item) => item.activity === "esoft").map((item) => [item.path, item.weekBasis])).toEqual([
      ["T1/DEMO 1/Week 1", "group-order"], ["T1/DEMO 1/Week 2", "group-order"],
    ]);
    // Four lecture days over two weeks: two each, marked as worked out.
    expect(plan.items.filter((item) => item.kind === "Lecture").map((item) => [item.week, item.weekBasis])).toEqual([
      [1, "spread"], [1, "spread"], [2, "spread"], [2, "spread"],
    ]);
    expect(plan.needsConfirmation).toBe(true);
  });

  it("starts a module in the week of the term the learner gives", () => {
    const plan = planCourseTemplate([parseCourseTemplate(LECTURES), parseCourseTemplate(ACTIVITIES)], { firstWeek: 10 });
    expect([...new Set(plan.items.map((item) => item.week))].sort()).toEqual([10, 11]);
    expect(plan.items[0].path).toBe("DEMO 1/Week 10");
  });

  it("uses the weeks a template states and needs no confirmation then", () => {
    const stated = "DEMO 1 - Lectures:\n\nWeek 4:\nDEMO Lecture 01 First [Lecture]\n\nDEMO Lecture 02 Second [Lecture]\n\nWeek 5:\nDEMO Lecture 03 Third [Lecture]\n";
    const plan = planCourseTemplate([parseCourseTemplate(stated)]);
    expect(plan.items.map((item) => [item.week, item.weekBasis])).toEqual([[4, "stated"], [4, "stated"], [5, "stated"]]);
    expect(plan.needsConfirmation).toBe(false);
  });

  it("leaves rows unscheduled when nothing establishes the weeks", () => {
    const plan = planCourseTemplate([parseCourseTemplate(LECTURES)]);
    expect(plan.weekCount).toBeUndefined();
    expect(new Set(plan.items.map((item) => item.path))).toEqual(new Set(["DEMO 1/Unscheduled"]));
  });

  it("adds nothing when a template is applied twice, and renames instead of duplicating", () => {
    const plan = planCourseTemplate([parseCourseTemplate(ACTIVITIES)]);
    const applied = plan.items.map((item, index) => ({ id: `row-${index}`, path: item.path, label: item.label, templateKey: item.templateKey }));
    expect(reconcileCourseTemplate(plan, applied)).toEqual({ create: [], update: [], unchanged: 6 });

    const retitled = planCourseTemplate([parseCourseTemplate(ACTIVITIES.replace("DEMO SG 01 Introduction", "DEMO SG 01 Orientation"))]);
    expect(reconcileCourseTemplate(retitled, applied)).toEqual({
      create: [], update: [{ id: "row-0", path: "DEMO 1/Week 1", label: "DEMO SG 01 Orientation", weekSource: "template" }], unchanged: 5,
    });
  });

  it("records who placed each row, and never moves a row the learner placed", () => {
    const plan = planCourseTemplate([parseCourseTemplate(LECTURES), parseCourseTemplate(ACTIVITIES)]);
    expect(plan.items.find((item) => item.activity === "esoft")?.weekSource).toBe("template");
    const lecture = plan.items.find((item) => item.label.startsWith("DEMO Lecture 03"))!;
    expect(lecture).toMatchObject({ week: 2, weekSource: "inferred" });

    // The learner moved lecture 3 into week 1. Loading the template again leaves it there.
    const applied = plan.items.map((item, index) => ({ id: `row-${index}`, path: item.path, label: item.label, templateKey: item.templateKey, weekSource: item.weekSource }));
    const moved = applied.map((row) => (row.label.startsWith("DEMO Lecture 03") ? { ...row, path: "DEMO 1/Week 1", weekSource: "learner" as const } : row));
    expect(reconcileCourseTemplate(plan, moved)).toEqual({ create: [], update: [], unchanged: plan.items.length });
    // A new title still reaches it, without moving it.
    const retitled = planCourseTemplate([parseCourseTemplate(LECTURES.replace("Third topic", "Third topic, revised")), parseCourseTemplate(ACTIVITIES)]);
    expect(reconcileCourseTemplate(retitled, moved).update).toEqual([
      { id: moved.find((row) => row.weekSource === "learner")!.id, path: "DEMO 1/Week 1", label: "DEMO Lecture 03 Third topic, revised", weekSource: "learner" },
    ]);
  });

  it("maps template kinds onto tracker groupings every build understands", () => {
    expect(TRACKER_KIND_FOR_ACTIVITY["small-group"]).toBe("Requirement");
    expect(TRACKER_KIND_FOR_ACTIVITY.esoft).toBe("Assessment");
    expect(attendanceCategory("flipped-lecture")).toBe("lecture");
    // Counts keep acronyms as written and pluralise the rest.
    expect([countActivity("imcq", 1), countActivity("esoft", 3), countActivity("lecture", 24)]).toEqual(["1 IMCQ", "3 ESoft quizzes", "24 lectures"]);
  });

  it("derives the spellings a module is filed under", () => {
    expect(moduleAliases("NB Block 3")).toEqual(["NB3"]);
    expect(moduleAliases("BPM502 Post-Midterm")).toEqual(["Post-Midterm"]);
    expect(moduleAliases("MSK")).toEqual([]);
    expect(templateModules([parseCourseTemplate(LECTURES), parseCourseTemplate(ACTIVITIES)])).toEqual([
      { code: "DEMO 1", aliases: [], term: undefined },
    ]);
  });
});

function question(patch: Partial<QuestionRecord>): QuestionRecord {
  return {
    id: crypto.randomUUID(), source: "imported", stem: "Stem", options: [], status: "unseen", tags: [], attempts: [],
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", ...patch,
  };
}

describe("one scope for questions and tracker rows", () => {
  const attempt = (status: "correct" | "incorrect") => ({ at: "2026-07-02T00:00:00.000Z", status });

  it("treats two spellings of a module as one scope", () => {
    expect(scopeKey({ module: "FTM 1", week: 2 })).toBe(scopeKey({ module: "ftm1", week: 2 }));
    expect(scopeKey({})).toBe("unassigned");
  });

  it("lets a question inherit its set's place unless it names its own", () => {
    const sets = new Map([["set-1", { scope: { module: "FTM 1", week: 2 } }]]);
    expect(questionScope(question({ setId: "set-1" }), sets)).toMatchObject({ module: "FTM 1", week: 2 });
    expect(questionScope(question({ setId: "set-1", week: 3 }), sets)).toMatchObject({ module: "FTM 1", week: 3 });
    expect(questionScope(question({}), sets)).toEqual({ module: undefined, week: undefined, courseId: undefined });
  });

  it("reads a tracker row's scope from its path", () => {
    expect(trackerPathScope("T1/FTM 1/Week 2")).toEqual({ module: "FTM 1", week: 2 });
    expect(trackerPathScope("Question Bank/Review")).toEqual({});
  });

  it("counts a week's progress from the attempts, with nothing self-reported", () => {
    const questions = [
      question({ module: "FTM 1", week: 2, status: "correct", attempts: [attempt("correct")] }),
      question({ module: "ftm1", week: 2, status: "incorrect", attempts: [attempt("incorrect")] }),
      // Right now, wrong the first time: it does not count as first-time correct.
      question({ module: "FTM 1", week: 2, status: "correct", attempts: [attempt("incorrect"), attempt("correct")] }),
      question({ module: "FTM 1", week: 2 }),
      question({ module: "FTM 1", week: 3, status: "correct", attempts: [attempt("correct")] }),
    ];
    expect(scopeProgress(questions, trackerPathScope("T1/FTM 1/Week 2"))).toMatchObject({
      total: 4, attempted: 3, firstTimeCorrect: 1, missed: 1,
    });
    // A module-wide scope counts every week.
    expect(scopeProgress(questions, { module: "FTM 1" }).total).toBe(5);
  });

  it("groups a bank by module then week, with unassigned last", () => {
    const groups = groupQuestionsByScope([
      question({}), question({ module: "MSK", week: 2 }), question({ module: "FTM 1", week: 10 }),
      question({ module: "FTM 1", week: 2 }), question({ module: "ftm 1", week: 2 }),
    ]);
    expect(groups.map((group) => [group.module, group.week, group.questionIds.length])).toEqual([
      ["FTM 1", 2, 2], ["FTM 1", 10, 1], ["MSK", 2, 1], [undefined, undefined, 1],
    ]);
  });
});
