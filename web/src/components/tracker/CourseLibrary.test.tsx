// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildCurriculum, SGU_CURRICULUM } from "../../lib/curricula";
import type { CourseBook } from "../../lib/bookshelf/courseBooks";
import { CourseLibrary } from "./CourseLibrary";

const mocks = vi.hoisted(() => ({ useStore: vi.fn(), connected: [] as unknown[] }));
vi.mock("../../lib/store", () => ({ useStore: () => mocks.useStore() }));
vi.mock("../../lib/account/accountStore", () => {
  const account = { user: { id: "owner" } };
  // The term actions retain a canonical account scope while mounted. A
  // selector-only function is not a faithful mock of Zustand's bound store.
  return { useAccount: Object.assign(
    (select: (state: typeof account) => unknown) => select(account),
    { getState: () => account, subscribe: () => () => {} },
  ) };
});
vi.mock("../../lib/academicLibrary/useAcademicCatalog", () => ({
  useAcademicCatalog: () => ({ courses: mocks.connected, loading: false, error: "", more: false, loadMore: vi.fn(), retry: vi.fn() }),
}));
vi.mock("../../lib/academicLibrary/client", () => ({ getAcademicCourse: vi.fn() }));
vi.mock("./CoursePlan", () => ({ CoursePlan: ({ book }: { book: CourseBook }) => <h1 data-testid="opened-course">{book.module}</h1> }));
vi.mock("./ConnectedCoursePlan", () => ({ ConnectedCoursePlan: () => null }));
vi.mock("./AcademicLibraryPublisher", () => ({ AcademicLibraryPublisher: () => null }));
vi.mock("./AcademicCollectionManager", () => ({ AcademicCollectionManager: () => null }));
vi.mock("./AcademicCourseUpload", () => ({ AcademicCourseUpload: () => null }));
vi.mock("../bookshelf/PreparedLibrary", () => ({ PreparedLibrary: () => null }));

function workspace() {
  const { terms, courses: built } = buildCurriculum(SGU_CURRICULUM);
  const legacy = new Map([
    ["BPM 500", ["BSCE T1"]], ["BPM 501", ["BSCE T2"]],
    ["PPM 500", ["FTCM (pending)", "BSCE T4"]], ["PPM 501", ["CBSE"]],
  ]);
  return {
    terms,
    courses: built.map(course => ({ ...course, modules: [
      ...course.modules,
      ...(legacy.get(course.code) ?? []).map(name => ({ id: `legacy-${name}`, name })),
    ] })),
    tracker: [], questions: [], questionSets: [], documents: [],
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/#tracker");
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.connected = [];
  mocks.useStore.mockReturnValue(workspace());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("makes template import directly available when no course content is installed", () => {
  const onTemplate = vi.fn();
  render(<CourseLibrary onClose={vi.fn()} onTemplate={onTemplate} onOpen={vi.fn()} onCreate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Saved templates and imports" }));
  expect(onTemplate).toHaveBeenCalledOnce();
  expect(screen.getByText(/does not include your school's lecture schedule/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Import course templates" }));
  expect(onTemplate).toHaveBeenCalledTimes(2);
});

it("clears an empty search without losing the current course collection", () => {
  render(<CourseLibrary onClose={vi.fn()} onTemplate={vi.fn()} onOpen={vi.fn()} onCreate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Course map" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search courses" }), { target: { value: "unmatched-course" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear course filters" }));
  expect(screen.getAllByRole("button", { name: /^Preview / })).toHaveLength(34);
  expect(screen.getByRole("button", { name: "Course map" }).getAttribute("aria-pressed")).toBe("true");
});

it("keeps the five saved legacy shells keyboard-openable below the 29 canonical course-map cards", async () => {
  const saved = mocks.useStore();
  const onOpen = vi.fn();
  render(<CourseLibrary onClose={vi.fn()} onTemplate={vi.fn()} onOpen={onOpen} onCreate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Course map" }));

  expect(screen.getByRole("status").textContent).toContain("34 courses in the course map");
  const term1 = screen.getByRole("heading", { name: "Term 1" }).closest("section")!;
  expect(within(term1).getAllByRole("button", { name: /^Preview / })).toHaveLength(6);
  const other = screen.getByRole("heading", { name: "Other local courses" }).closest("section")!;
  expect(within(other).getAllByRole("button", { name: /^Preview / })).toHaveLength(5);
  expect(within(other).getByRole("button", { name: "Preview BSCE T1, Term 1" })).toBeTruthy();
  expect(within(other).getByRole("button", { name: "Preview CBSE, Term 5" })).toBeTruthy();

  const legacyCard = within(other).getByRole("button", { name: "Preview BSCE T1, Term 1" });
  legacyCard.focus();
  expect(document.activeElement).toBe(legacyCard);
  await userEvent.setup().keyboard("{Enter}");
  expect(screen.getByTestId("opened-course").textContent).toBe("BSCE T1");
  expect(mocks.useStore()).toBe(saved);
  expect(onOpen).not.toHaveBeenCalled();
});

it("filters canonical and other local cards by term and search without losing either", () => {
  render(<CourseLibrary onClose={vi.fn()} onTemplate={vi.fn()} onOpen={vi.fn()} onCreate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Course map" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Filter by term" }), { target: { value: "Term 4" } });
  const canonical = screen.getByRole("heading", { name: "Term 4" }).closest("section")!;
  const local = screen.getByRole("heading", { name: "Other local courses" }).closest("section")!;
  expect(within(canonical).getAllByRole("button", { name: /^Preview / })).toHaveLength(5);
  expect(within(local).getAllByRole("button", { name: /^Preview / })).toHaveLength(2);

  fireEvent.change(screen.getByRole("searchbox", { name: "Search courses" }), { target: { value: "pending" } });
  expect(screen.queryByRole("heading", { name: "Term 4" })).toBeNull();
  const filtered = screen.getByRole("heading", { name: "Other local courses" }).closest("section")!;
  expect(within(filtered).getAllByRole("button", { name: /^Preview / })).toHaveLength(1);
  expect(within(filtered).getByRole("button", { name: "Preview FTCM (pending), Term 4" })).toBeTruthy();
});

it("shows an account upload once in Available while keeping the loaded local course in My Courses", () => {
  const state = workspace();
  mocks.useStore.mockReturnValue({ ...state, tracker: [{
    id: "rhps-lecture", path: "Term 4/PPM 500/RHPS/Week 1", label: "RHPS lecture",
    kind: "Lecture", activity: "lecture", passes: 0, ankiPasses: 0, yield: "none", updated: "2026-11-02T00:00:00.000Z",
  }] });
  mocks.connected = [{
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "RHPS", module: "RHPS", term: "Term 4",
    visibility: "private", review_status: "pending", current_revision_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    owned: true, ready_questions: 19, review_questions: 496,
  }];
  render(<CourseLibrary onClose={vi.fn()} onTemplate={vi.fn()} onOpen={vi.fn()} onCreate={vi.fn()} />);

  const term4 = screen.getByRole("heading", { name: "Term 4" }).closest("section")!;
  expect(within(term4).getAllByRole("button", { name: "Preview RHPS, Term 4" })).toHaveLength(1);
  expect(screen.getByText(/Your loaded version of a course is in My Courses/)).toBeTruthy();
  fireEvent.click(within(screen.getByRole("group", { name: "Course collection" })).getByRole("button", { name: "My Courses" }));
  expect(screen.getByRole("button", { name: "Preview RHPS, Term 4" })).toBeTruthy();
  expect(screen.queryByText(/Your loaded version of a course is in My Courses/)).toBeNull();
});

it("scrolls the course surface without shifting the app shell", () => {
  const { container } = render(<div className="surface-scroll">
    <CourseLibrary onClose={vi.fn()} onTemplate={vi.fn()} onOpen={vi.fn()} onCreate={vi.fn()} />
  </div>);
  fireEvent.click(screen.getByRole("button", { name: "Course map" }));
  const surface = container.querySelector<HTMLElement>(".surface-scroll")!;
  surface.scrollTop = 180;
  fireEvent.click(screen.getAllByRole("button", { name: /^Preview / })[0]);
  expect(surface.scrollTop).toBe(0);
  expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
});

it("My Courses uses the complete collection-bound receipt, not just a shared revision document ID", () => {
  const revision = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const first = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "A", module: "Module A",
    term: "Term 4", visibility: "shared", review_status: "approved", current_revision_id: revision,
    owned: false, ready_questions: 1, review_questions: 0 };
  const second = { ...first, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "B", module: "Module B" };
  mocks.connected = [first, second];
  const rawText = JSON.stringify({ accountId: "owner", collectionId: first.id, revisionId: revision, status: "complete",
    templateIds: [], documentIds: [], questionIds: [], setIds: [],
    bindings: { originals: [], sources: [], assets: [] } });
  mocks.useStore.mockReturnValue({ ...workspace(), documents: [{
    id: `academic-${revision}`, rawText, fileType: "axom-academic-reference", title: "Downloaded course reference",
    fileName: "course-reference.json", uploadedAt: "2026-11-14", sizeBytes: rawText.length,
    tags: [], linkedQuestionSetIds: [], libraryOnly: true,
  }] });
  render(<CourseLibrary onClose={vi.fn()} onTemplate={vi.fn()} onOpen={vi.fn()} onCreate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "My Courses" }));
  expect(screen.getByRole("button", { name: "Preview Module A, Term 4" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Preview Module B, Term 4" })).toBeNull();
});
