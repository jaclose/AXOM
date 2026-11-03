// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import type { QuestionSet, SourceDocument } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import { prepareCourseTemplate } from "../../lib/course-engine/templateLibrary";
import { COURSE_QUIZ_LAUNCH_KEY } from "../../lib/course-engine/quizLaunch";
import { closeWorkspace, openEmptyWorkspace } from "../../lib/question-content/persistenceHarness.testing";
import { useStore } from "../../lib/store";
import { AcademicBankDiscovery } from "./AcademicBankDiscovery";

const mocks = vi.hoisted(() => ({
  accountId: "learner-1",
  courses: [] as AcademicCourse[],
  error: "",
  preview: vi.fn(),
  download: vi.fn(),
  enroll: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } | null }) => unknown) => select({ user: mocks.accountId ? { id: mocks.accountId } : null }),
}));
vi.mock("../../lib/academicLibrary/useAcademicCatalog", () => ({
  useAcademicCatalog: () => ({ courses: mocks.courses, loading: false, error: mocks.error, more: false, retry: mocks.retry, loadMore: vi.fn() }),
}));
vi.mock("../../lib/academicLibrary/accountScope", () => ({
  academicAccountScope: () => ({ key: mocks.accountId, assertCurrent: () => {}, dispose: () => {} }),
}));
vi.mock("../../lib/academicLibrary/client", () => ({
  academicPreview: (...args: unknown[]) => mocks.preview(...args),
  downloadAcademicCourse: (...args: unknown[]) => mocks.download(...args),
  enrollAcademicCourse: (...args: unknown[]) => mocks.enroll(...args),
}));
vi.mock("../tracker/AcademicSharing", () => ({ AcademicSharing: () => null }));

const collection = "11111111-1111-4111-8111-111111111111";
const revision = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const course: AcademicCourse = {
  id: collection, title: "FTM 1 course", module: "FTM 1", term: "Term 1", visibility: "shared",
  review_status: "approved", current_revision_id: revision, owned: false, ready_questions: 2, review_questions: 0,
};
const other: AcademicCourse = {
  ...course, id: "22222222-2222-4222-8222-222222222222", current_revision_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  title: "NB 2 course", module: "NB 2", term: "Term 2",
};
const planText = "T1 - FTM 1 - Lectures:\nWeek 1:\nLecture 01 Foundations [Lecture]\nWeek 2:\nLecture 02 Systems [Lecture]\n";
const now = "2026-11-01T00:00:00.000Z";

function reference(template: SourceDocument): SourceDocument {
  const rawText = JSON.stringify({
    collectionId: collection, revisionId: revision, accountId: "learner-1",
    status: "complete", warnings: [],
    templateIds: [template.id], documentIds: [template.id], questionIds: ["week-1", "week-2"], setIds: ["set-1", "set-2"],
  });
  return {
    id: `academic-${revision}`, title: "Downloaded course reference", fileName: "course-reference.json",
    fileType: "axom-academic-reference", uploadedAt: now, rawText,
    sizeBytes: new TextEncoder().encode(rawText).length, tags: [], linkedQuestionSetIds: ["set-1", "set-2"], libraryOnly: true,
  };
}
function question(id: string, setId: string): QuestionRecord {
  return {
    id, source: "imported", stem: `Synthetic ${id}`, options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
    correctKey: "A", status: "unseen", tags: [], attempts: [], createdAt: now, updatedAt: now,
    module: "FTM 1", setId,
  };
}
function set(id: string, questionId: string, week: number): QuestionSet {
  return {
    id, title: `Week ${week} set`, questionIds: [questionId], sourceDocumentIds: [], tags: [], aiEnhanced: false,
    parserWarnings: [], kind: "source", createdAt: now, scope: { courseId: "hosted-course", module: "FTM 1", week },
  };
}

describe("Question Bank hosted course discovery", () => {
  beforeEach(async () => {
    await openEmptyWorkspace();
    sessionStorage.clear();
    history.replaceState(null, "", "/");
    mocks.accountId = "learner-1";
    mocks.courses = [other, course];
    mocks.error = "";
    mocks.preview.mockResolvedValue({ id: revision, collection_id: collection, template_text: planText, ready_questions: 2, review_questions: 0 });
    mocks.enroll.mockResolvedValue(undefined);
  });
  afterEach(async () => { cleanup(); vi.clearAllMocks(); await closeWorkspace(); });

  it("keeps courses grouped by curriculum term and module order", () => {
    mocks.courses = [
      { ...course, id: "goer", term: "Term 5", module: "GOER", title: "GOER" },
      { ...course, id: "cpr1", term: "Term 1", module: "CPR 1", title: "CPR 1" },
      { ...course, id: "ftm1", term: "Term 1", module: "FTM 1", title: "FTM 1" },
      { ...course, id: "ncrs", term: "Term 4", module: "NCRS", title: "NCRS" },
    ];
    render(<AcademicBankDiscovery />);
    const region = screen.getByRole("region", { name: "Available question banks" });
    const terms = within(region).getAllByRole("region");
    expect(terms.map(term => term.getAttribute("aria-labelledby") && within(term).getByRole("heading", { level: 3 }).textContent))
      .toEqual(["Term 1", "Term 4", "Term 5"]);
    expect(within(terms[0]).getAllByRole("button").map(button => button.getAttribute("data-course-id"))).toEqual(["ftm1", "cpr1"]);
    expect(within(terms[0]).getByText("2 courses")).toBeTruthy();
  });

  it("opens the Term 1 weekly plan in Question Bank and keeps Course Tracker as an explicit choice", async () => {
    render(<AcademicBankDiscovery />);
    const terms = screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent);
    expect(terms).toEqual(["Term 1", "Term 2"]);

    fireEvent.click(screen.getByRole("button", { name: /Preview FTM 1 course and weekly question sets/ }));
    const detail = screen.getByRole("region", { name: "FTM 1 question sets" });
    expect(document.activeElement).toBe(detail);
    expect(await screen.findByRole("heading", { name: "Weekly plan" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Week 1" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Week 2" })).toBeTruthy();
    expect(location.hash).toBe("");
    expect(mocks.preview).toHaveBeenCalledWith(revision, "learner-1");

    fireEvent.click(screen.getByRole("button", { name: "All courses" }));
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search available banks" }));
    fireEvent.click(screen.getByRole("button", { name: /Preview FTM 1 course and weekly question sets/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open in Course Tracker" }));
    expect(location.hash).toBe("#tracker");
    expect(new URL(location.href).searchParams.get("course")).toBe(`remote:${collection}`);
  });

  it("loads only Week 2 after clearing the default selection, preserving the exact revision", async () => {
    mocks.download.mockImplementation(async () => {
      const template = await prepareCourseTemplate(planText, "ftm1-course-plan.txt");
      useStore.setState(state => ({ documents: [...state.documents, template] }));
      return { status: "complete", warnings: [], templateIds: [template.id], documentIds: [template.id], questionIds: [], setIds: [], bindings: { originals: [] } };
    });
    render(<AcademicBankDiscovery />);
    fireEvent.click(screen.getByRole("button", { name: /Preview FTM 1 course and weekly question sets/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear selection" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Week 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Load Course" }));

    await waitFor(() => expect(mocks.enroll).toHaveBeenCalledWith(course, [2], "learner-1"));
    expect(mocks.download).toHaveBeenCalledWith(revision, expect.any(Function), expect.objectContaining({ key: "learner-1" }));
    expect(useStore.getState().tracker.map(row => row.path)).toEqual(expect.arrayContaining([expect.stringContaining("Week 2")]));
    expect(useStore.getState().tracker.some(row => row.path.includes("Week 1"))).toBe(false);
  });

  it("starts a week quiz from the saved exact revision without mixing another week", async () => {
    const template = await prepareCourseTemplate(planText, "ftm1-course-plan.txt");
    useStore.setState({
      documents: [template, reference(template)],
      terms: [{ id: "term-1", name: "Term 1" }],
      courses: [{ id: "hosted-course", termId: "term-1", code: `academic:${collection}`, name: "FTM 1", files: 0,
        modules: [{ id: "ftm-1", name: "FTM 1" }] }],
      questions: [question("week-1", "set-1"), question("week-2", "set-2")],
      questionSets: [set("set-1", "week-1", 1), set("set-2", "week-2", 2)],
    });
    render(<AcademicBankDiscovery />);
    fireEvent.click(screen.getByRole("button", { name: /Preview FTM 1 course and weekly question sets/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Quiz week 2" }));
    expect(JSON.parse(sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY) ?? "null")).toEqual({
      courseId: "hosted-course", module: "FTM 1", term: "Term 1", week: 2, questionIds: ["week-2"], setIds: ["set-2"],
    });
    expect(location.hash).toBe("#questions");
  });

  it("hides another account's selected course and reports catalog errors", () => {
    const view = render(<AcademicBankDiscovery />);
    fireEvent.click(screen.getByRole("button", { name: /Preview FTM 1 course and weekly question sets/ }));
    mocks.accountId = "learner-2";
    mocks.courses = [];
    mocks.error = "Catalog unavailable";
    view.rerender(<AcademicBankDiscovery />);
    expect(screen.queryByRole("region", { name: "FTM 1 question sets" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Catalog unavailable");
  });
});
