// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildCurriculum, SGU_CURRICULUM } from "../../lib/curricula";
import type { CourseBook } from "../../lib/bookshelf/courseBooks";
import { CourseLibrary } from "./CourseLibrary";

const mocks = vi.hoisted(() => ({ useStore: vi.fn() }));
vi.mock("../../lib/store", () => ({ useStore: () => mocks.useStore() }));
vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: "owner" } }),
}));
vi.mock("../../lib/academicLibrary/useAcademicCatalog", () => ({
  useAcademicCatalog: () => ({ courses: [], loading: false, error: "", more: false, loadMore: vi.fn(), retry: vi.fn() }),
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
  mocks.useStore.mockReturnValue(workspace());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

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
