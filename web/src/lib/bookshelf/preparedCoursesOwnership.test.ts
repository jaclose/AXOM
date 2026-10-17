// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareCourseTemplate } from "../course-engine/templateLibrary";
import * as vault from "../localVault";
import { openEmptyWorkspace, closeWorkspace } from "../question-content/persistenceHarness.testing";
import { useStore } from "../store";
import type { Course, Term, TrackerItem } from "../types";
import type { SourceDocument } from "../library";
import { buildCourseBooks } from "./courseBooks";
import { connectedCourseBook } from "../../components/tracker/ConnectedCoursePlan";
import type { AcademicCourse } from "../academicLibrary/client";
import { loadPreparedCourse, templatesForBook, withPreparedCourses } from "./preparedCourses";

const terms: Term[] = [{ id: "term-2", name: "Term 2" }];
const courses: Course[] = [
  { id: "core", termId: "term-2", code: "BPM 501", name: "Core", files: 0,
    modules: [{ id: "core-er", name: "ER" }] },
  { id: "elective", termId: "term-2", code: "ELECTIVE", name: "Elective", files: 0,
    modules: [{ id: "elective-er", name: "ER" }] },
];

const trackerRow = (id: string, path: string, templateKey: string, passes: number): TrackerItem => ({
  id, path, templateKey, passes, label: "Lecture 01 Evidence",
  kind: "Lecture", activity: "lecture", ankiPasses: 0, yield: "none",
  updated: "2026-10-15T00:00:00.000Z",
});

async function preparedDocument() {
  return prepareCourseTemplate(
    "T2 - ER - Course plan:\nWeek 1:\nLecture 01 Evidence [Lecture]\nWeek 2:\nLecture 02 Next [Lecture]\n",
    "er-course-plan.txt",
  );
}

const booksFor = (ownedCourses: readonly Course[], tracker: readonly TrackerItem[] = []) =>
  buildCourseBooks({ terms, courses: ownedCourses, tracker });

const exactBook = (courseCode: string, templateIds: string[]) => ({
  ...booksFor(courses).find(book => book.courseCode === courseCode)!,
  templateIds,
});

const workspaceSnapshot = () => {
  const state = useStore.getState();
  return structuredClone({ terms: state.terms, courses: state.courses, tracker: state.tracker });
};

const academicCourse = (collection: string, revision: string, module = "ER", term = "Term 2"): AcademicCourse => ({
  id: collection,
  title: "Hosted ER",
  module,
  term,
  visibility: "private",
  review_status: "approved",
  current_revision_id: revision,
  owned: true,
  ready_questions: 2,
  review_questions: 0,
});

const academicReference = (template: SourceDocument, collectionId: string, revisionId: string): SourceDocument => {
  const rawText = JSON.stringify({
    collectionId, revisionId, accountId: "owner-account", templateIds: [template.id],
    documentIds: [template.id], questionIds: ["question-1"], setIds: ["set-1"],
  });
  return {
    id: `academic-${revisionId}`,
    title: "Downloaded course reference",
    fileName: "course-reference.json",
    fileType: "axom-academic-reference",
    uploadedAt: "2026-10-15T00:00:00.000Z",
    rawText,
    sizeBytes: new TextEncoder().encode(rawText).length,
    tags: [],
    linkedQuestionSetIds: ["set-1"],
    libraryOnly: true,
  };
};

describe("prepared-course ownership", () => {
  beforeEach(openEmptyWorkspace);
  afterEach(closeWorkspace);

  it("holds a legacy template out when two courses share its term and module", async () => {
    const document = await preparedDocument();
    const books = withPreparedCourses(booksFor(courses), [document]);

    expect(books).toHaveLength(2);
    expect(books.map(book => ({ course: book.courseCode, count: book.count, templates: book.templateIds }))).toEqual([
      { course: "BPM 501", count: 0, templates: undefined },
      { course: "ELECTIVE", count: 0, templates: undefined },
    ]);
  });

  it("projects an explicitly selected template and progress only onto its intended course", async () => {
    const document = await preparedDocument();
    const tracker = [
      trackerRow("core-progress", "Term 2/BPM 501/ER/Week 1", "er|lecture|1", 1),
      trackerRow("elective-progress", "Term 2/ELECTIVE/ER/Week 1", "er|lecture|1", 0),
    ];
    const raw = booksFor(courses, tracker);
    const bound = raw.map(book => book.courseCode === "BPM 501" ? { ...book, templateIds: [document.id] } : book);
    const books = withPreparedCourses(bound, [document], tracker);
    const core = books.find(book => book.courseCode === "BPM 501")!;
    const elective = books.find(book => book.courseCode === "ELECTIVE")!;

    expect(core).toMatchObject({ count: 2, loadedActivities: 1, done: 1, templateIds: [document.id] });
    expect(core.weeks[0]).toMatchObject({ week: 1, done: 1,
      activities: [{ activity: "lecture", total: 1, done: 1 }] });
    expect(elective).toMatchObject({ count: 1, done: 0 });
    expect(elective.templateIds).toBeUndefined();
  });

  it("retains course-less legacy progress when the term and module have one owner", async () => {
    const document = await preparedDocument();
    const tracker = [trackerRow("legacy", "Term 2/ER/Week 1", "er|lecture|1", 2)];
    const [book] = withPreparedCourses(booksFor([courses[0]], tracker), [document], tracker);

    expect(book).toMatchObject({ courseCode: "BPM 501", count: 2, loadedActivities: 1, done: 1,
      templateIds: [document.id] });
    expect(book.weeks[0]).toMatchObject({ week: 1, done: 1 });
  });

  it("loads a directly selected ambiguous template into that course-scoped path", async () => {
    const document = await preparedDocument();
    useStore.setState({ terms, courses, documents: [document], tracker: [] });
    await vault.flushLocalVaultWrites();
    const selected = exactBook("ELECTIVE", [document.id]);

    await expect(loadPreparedCourse(selected)).resolves.toEqual({ status: "saved-on-device" });
    const rows = useStore.getState().tracker.filter(item => item.templateKey?.startsWith("er|"));
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.path)).toEqual([
      "Term 2/ELECTIVE/ER/Week 1",
      "Term 2/ELECTIVE/ER/Week 2",
    ]);
    expect(rows.some(row => row.path.includes("BPM 501"))).toBe(false);
  });

  it("rejects an unbound ambiguous plan before changing course structure or activities", async () => {
    const document = await preparedDocument();
    useStore.setState({ terms, courses, documents: [document], tracker: [] });
    await vault.flushLocalVaultWrites();
    const before = workspaceSnapshot();

    await expect(loadPreparedCourse(booksFor(courses)[0])).resolves.toMatchObject({
      status: "failed",
      message: expect.stringMatching(/more than one course/i),
    });
    expect(workspaceSnapshot()).toEqual(before);
  });

  it("keeps an unmatched template available for filing but will not synthesize its course", async () => {
    const document = await prepareCourseTemplate(
      "T2 - SYNTHETIC - Course plan:\nWeek 1:\nLecture 01 Evidence [Lecture]\n",
      "unmatched-course-plan.txt",
    );
    useStore.setState({ terms: [], courses: [], documents: [document], tracker: [] });
    await vault.flushLocalVaultWrites();
    const [unbound] = withPreparedCourses([], [document]);
    const before = workspaceSnapshot();

    expect(unbound).toMatchObject({
      term: "Term 2",
      module: "SYNTHETIC",
      state: "available",
      templateIds: [document.id],
    });
    expect(unbound.courseCode).toBeUndefined();
    await expect(loadPreparedCourse(unbound)).resolves.toMatchObject({
      status: "failed",
      message: expect.stringMatching(/choose the course that owns/i),
    });
    expect(workspaceSnapshot()).toEqual(before);
    expect(useStore.getState().courses.some(course => course.code === "Term 2")).toBe(false);
    expect(useStore.getState().tracker.some(item => item.path === "Term 2/SYNTHETIC/Week 1")).toBe(false);
  });

  it("rejects an exact template whose claimed course code has no canonical owner", async () => {
    const document = await preparedDocument();
    useStore.setState({ terms: [], courses: [], documents: [document], tracker: [] });
    await vault.flushLocalVaultWrites();
    const unbound = withPreparedCourses([], [document])[0];
    const claimed = { ...unbound, courseCode: "SYNTHETIC", identifier: "SYNTHETIC" };
    const before = workspaceSnapshot();

    await expect(loadPreparedCourse(claimed)).resolves.toMatchObject({
      status: "failed",
      message: expect.stringMatching(/choose the course that owns/i),
    });
    expect(workspaceSnapshot()).toEqual(before);
  });

  it("rejects a fabricated curriculum id without mutating the workspace", async () => {
    const document = await preparedDocument();
    const claimed = { ...exactBook("BPM 501", [document.id]), courseCode: "FAKE 200", curriculumId: "unverified-curriculum" };
    useStore.setState({ terms: [], courses: [], documents: [document], tracker: [] });
    await vault.flushLocalVaultWrites();
    const before = workspaceSnapshot();

    await expect(loadPreparedCourse(claimed)).resolves.toMatchObject({
      status: "failed", message: expect.stringMatching(/choose the course that owns/i),
    });
    expect(workspaceSnapshot()).toEqual(before);
  });

  it("rejects a reused book id whose structural owner fields conflict", async () => {
    const document = await preparedDocument();
    const claimed = { ...exactBook("BPM 501", [document.id]), courseCode: "OTHER 200", identifier: "OTHER 200" };
    useStore.setState({ terms, courses: [courses[0]], documents: [document], tracker: [] });
    await vault.flushLocalVaultWrites();
    const before = workspaceSnapshot();

    await expect(loadPreparedCourse(claimed)).resolves.toMatchObject({
      status: "failed", message: expect.stringMatching(/choose the course that owns/i),
    });
    expect(workspaceSnapshot()).toEqual(before);
  });

  it("rejects a stale exact template list as a whole without loading its valid member", async () => {
    const document = await preparedDocument();
    useStore.setState({ terms, courses, documents: [document], tracker: [] });
    await vault.flushLocalVaultWrites();
    const before = workspaceSnapshot();

    await expect(loadPreparedCourse(exactBook("ELECTIVE", [document.id, "missing-template"]))).resolves.toMatchObject({
      status: "failed",
      message: expect.stringMatching(/exact saved version/i),
    });
    expect(workspaceSnapshot()).toEqual(before);
  });

  it("rejects duplicate exact template references instead of silently deduplicating them", async () => {
    const document = await preparedDocument();
    useStore.setState({ terms, courses, documents: [document], tracker: [] });
    await vault.flushLocalVaultWrites();
    const before = workspaceSnapshot();

    await expect(loadPreparedCourse(exactBook("BPM 501", [document.id, document.id]))).resolves.toMatchObject({
      status: "failed",
      message: expect.stringMatching(/duplicate template references/i),
    });
    expect(workspaceSnapshot()).toEqual(before);
  });

  it("rejects an exact template from another module before creating its selected course", async () => {
    const wrongModule = await prepareCourseTemplate(
      "T5 - GOER - Course plan:\nWeek 1:\nLecture 01 Evidence [Lecture]\n",
      "goer-course-plan.txt",
    );
    const selected = exactBook("BPM 501", [wrongModule.id]);
    useStore.setState({ terms: [], courses: [], documents: [wrongModule], tracker: [] });
    await vault.flushLocalVaultWrites();
    const before = workspaceSnapshot();

    await expect(loadPreparedCourse(selected)).resolves.toMatchObject({
      status: "failed",
      message: expect.stringMatching(/different term or module/i),
    });
    expect(workspaceSnapshot()).toEqual(before);
  });

  it("preserves exact template order rather than substituting a newer family version", async () => {
    const first = await prepareCourseTemplate(
      "T2 - ER - Lectures:\nWeek 1:\nLecture 01 First [Lecture]\n",
      "er-first.txt",
      "2026-10-14T00:00:00.000Z",
    );
    const second = await prepareCourseTemplate(
      "T2 - ER - Lectures:\nWeek 2:\nLecture 02 Second [Lecture]\n",
      "er-second.txt",
      "2026-10-15T00:00:00.000Z",
    );
    const book = exactBook("BPM 501", [first.id, second.id]);

    expect(templatesForBook([second, first], book).map(template => template.document.id)).toEqual([first.id, second.id]);
  });

  it("deduplicates one workspace owner from its curriculum shell for legacy activation", async () => {
    const document = await preparedDocument();
    useStore.setState({ terms, courses: [courses[0]], documents: [document], tracker: [] });
    await vault.flushLocalVaultWrites();
    const selected = booksFor([courses[0]])[0];

    await expect(loadPreparedCourse(selected)).resolves.toEqual({ status: "saved-on-device" });
    expect(useStore.getState().tracker.filter(item => item.templateKey)).toHaveLength(2);
  });

  it("fails the whole activation when reconciliation requires identity review", async () => {
    const document = await preparedDocument();
    const duplicateRows = [
      trackerRow("duplicate-a", "Term 2/ER/Week 1", "er|lecture|1", 1),
      trackerRow("duplicate-b", "Term 2/ER/Week 1", "er|lecture|1", 0),
    ];
    const selected = exactBook("BPM 501", [document.id]);
    useStore.setState({ terms, courses: [], documents: [document], tracker: duplicateRows });
    await vault.flushLocalVaultWrites();
    const before = workspaceSnapshot();

    await expect(loadPreparedCourse(selected)).resolves.toMatchObject({
      status: "failed",
      message: expect.stringMatching(/identity review/i),
    });
    expect(workspaceSnapshot()).toEqual(before);
  });

  it("uses one stable collection owner across revisions and isolates another collection", async () => {
    const template = await preparedDocument();
    const collectionA = "11111111-1111-4111-8111-111111111111";
    const collectionB = "22222222-2222-4222-8222-222222222222";
    const tracker = [trackerRow("hosted-progress", `Term 2/academic:${collectionA}/ER/Week 1`, "er|lecture|1", 1)];
    const workspace = { terms: [], courses: [], tracker };
    const first = connectedCourseBook(academicCourse(collectionA, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), template, workspace);
    const revised = connectedCourseBook(academicCourse(collectionA, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), template, workspace);
    const other = connectedCourseBook(academicCourse(collectionB, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"), template, workspace);

    expect(first.id).toBe(revised.id);
    expect(first.courseCode).toBe(`academic:${collectionA}`);
    expect(first.done).toBe(1);
    expect(revised.done).toBe(1);
    expect(other.id).not.toBe(first.id);
    expect(other.courseCode).toBe(`academic:${collectionB}`);
    expect(other.done).toBe(0);
  });

  it("reuses one loaded course across revisions and creates a disjoint course for another collection", async () => {
    const template = await preparedDocument();
    const collectionA = "11111111-1111-4111-8111-111111111111";
    const collectionB = "22222222-2222-4222-8222-222222222222";
    const referenceA = academicReference(template, collectionA, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const referenceB = academicReference(template, collectionB, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    useStore.setState({ terms: [], courses: [], documents: [template, referenceA, referenceB], tracker: [] });
    await vault.flushLocalVaultWrites();

    const first = connectedCourseBook(academicCourse(collectionA, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), template);
    await expect(loadPreparedCourse(first)).resolves.toEqual({ status: "saved-on-device" });
    const afterFirst = useStore.getState();
    const revised = connectedCourseBook(
      academicCourse(collectionA, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
      template,
      { terms: afterFirst.terms, courses: afterFirst.courses, tracker: afterFirst.tracker },
    );
    await expect(loadPreparedCourse(revised)).resolves.toEqual({ status: "nothing-to-save" });

    const beforeOther = useStore.getState();
    const other = connectedCourseBook(
      academicCourse(collectionB, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
      template,
      { terms: beforeOther.terms, courses: beforeOther.courses, tracker: beforeOther.tracker },
    );
    await expect(loadPreparedCourse(other)).resolves.toEqual({ status: "saved-on-device" });

    const final = useStore.getState();
    expect(final.courses.filter(course => course.code === `academic:${collectionA}`)).toHaveLength(1);
    expect(final.courses.filter(course => course.code === `academic:${collectionB}`)).toHaveLength(1);
    expect(final.tracker.filter(item => item.path.includes(`academic:${collectionA}`))).toHaveLength(2);
    expect(final.tracker.filter(item => item.path.includes(`academic:${collectionB}`))).toHaveLength(2);
  });

  it("requires a durable authenticated reference before activating a hosted course", async () => {
    const template = await preparedDocument();
    const collection = "11111111-1111-4111-8111-111111111111";
    const revision = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const book = connectedCourseBook(academicCourse(collection, revision), template);
    useStore.setState({ terms: [], courses: [], documents: [template], tracker: [] });
    await vault.flushLocalVaultWrites();
    const before = workspaceSnapshot();

    await expect(loadPreparedCourse(book)).resolves.toMatchObject({
      status: "failed", message: expect.stringMatching(/choose the course that owns/i),
    });
    expect(workspaceSnapshot()).toEqual(before);

    useStore.setState({ documents: [template, academicReference(template, collection, revision)] });
    await vault.flushLocalVaultWrites();
    await expect(loadPreparedCourse(book)).resolves.toEqual({ status: "saved-on-device" });
  });

  it("never projects a downloaded hosted template onto a same-named local course", async () => {
    const template = await preparedDocument();
    const collection = "11111111-1111-4111-8111-111111111111";
    const revision = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const reference = academicReference(template, collection, revision);
    const local = booksFor([courses[0]])[0];
    const hosted = connectedCourseBook(academicCourse(collection, revision), template, {
      terms, courses: [courses[0]], tracker: [],
    });

    const [projectedLocal] = withPreparedCourses([local], [template, reference]);
    const [projectedHosted] = withPreparedCourses([{ ...hosted, templateIds: undefined }], [template, reference], [], [local, hosted]);

    expect(projectedLocal).toMatchObject({ courseCode: "BPM 501", count: 0 });
    expect(projectedLocal.templateIds).toBeUndefined();
    expect(projectedHosted).toMatchObject({
      courseCode: `academic:${collection}`,
      count: 2,
      templateIds: [template.id],
    });
  });

  it("keeps same-family hosted revisions inside their collection owner", async () => {
    const collectionA = "11111111-1111-4111-8111-111111111111";
    const collectionB = "22222222-2222-4222-8222-222222222222";
    const templateA = await prepareCourseTemplate(
      "T2 - ER - Course plan:\nWeek 1:\nLecture 01 Collection A [Lecture]\n",
      "er-course-plan.txt",
      "2026-10-14T00:00:00.000Z",
    );
    const templateB = await prepareCourseTemplate(
      "T2 - ER - Course plan:\nWeek 1:\nLecture 01 Collection B [Lecture]\n",
      "er-course-plan.txt",
      "2026-10-15T00:00:00.000Z",
    );
    const courseA = academicCourse(collectionA, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const courseB = academicCourse(collectionB, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const bookA = connectedCourseBook(courseA, templateA);
    const bookB = connectedCourseBook(courseB, templateB);
    const [projectedA] = withPreparedCourses(
      [{ ...bookA, templateIds: undefined }],
      [templateA, templateB, academicReference(templateA, collectionA, courseA.current_revision_id), academicReference(templateB, collectionB, courseB.current_revision_id)],
      [],
      [bookA, bookB],
    );

    expect(projectedA).toMatchObject({
      courseCode: `academic:${collectionA}`,
      templateIds: [templateA.id],
    });
    expect(projectedA.weeks[0].items[0].label).toBe("Lecture 01 Collection A");
  });

  it("rejects a connected preview whose parsed term or module differs from its catalog", async () => {
    const template = await preparedDocument();
    const collection = "11111111-1111-4111-8111-111111111111";
    const revision = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    expect(() => connectedCourseBook(academicCourse(collection, revision, "GOER", "Term 2"), template)).toThrow(/catalog term and module/i);
    expect(() => connectedCourseBook(academicCourse(collection, revision, "ER", "Term 5"), template)).toThrow(/catalog term and module/i);
  });
});
