// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { NoctyriumState } from "../../lib/types";
import type { QuestionRecord } from "../../lib/questions";
import { QuestionBankLibrary } from "./QuestionBankLibrary";

const workspace = vi.hoisted(() => ({ state: {} as NoctyriumState }));
vi.mock("../../lib/store", () => ({ useStore: () => workspace.state }));
vi.mock("../bookshelf/AccountContentDownloads", () => ({ AccountContentDownloads: () => null }));
vi.mock("../bookshelf/PreparedLibrary", () => ({ PreparedLibrary: () => <p>Advanced source tools</p> }));
vi.mock("../bookshelf/AcademicBankDiscovery", () => ({ AcademicBankDiscovery: () => <section aria-label="Available question banks">Course catalog response</section> }));
vi.mock("./CommunityQuestionSetLibrary", () => ({ CommunityQuestionSetLibrary: () => <section aria-label="Shared question sets">No sets found</section> }));
vi.mock("../bookshelf/AcademicBookshelf", () => ({ AcademicBookshelf: () => <section aria-label="Question bank library">Saved course questions</section> }));
vi.mock("../bookshelf/BookContents", () => ({ QuestionBankBookContent: () => null }));

const now = "2026-11-16T12:00:00.000Z";
const readyQuestion: QuestionRecord = {
  id: "saved-question", source: "imported", stem: "Test question", module: "FTM 1", courseId: "course-1", setId: "set-1",
  options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }], correctKey: "A",
  status: "unseen", tags: [], attempts: [], createdAt: now, updatedAt: now,
};
const handlers = { onPractice: vi.fn(), onPracticeSet: vi.fn(), onOpenBank: vi.fn(), onImport: vi.fn(), onCreate: vi.fn() };

function seedQuestions(question = readyQuestion) {
  workspace.state.questions = [question];
  workspace.state.terms = [{ id: "term-1", name: "Term 1" }];
  workspace.state.courses = [{ id: "course-1", termId: "term-1", code: "FTM1", name: "FTM 1", files: 0, modules: [{ id: "module-1", name: "FTM 1" }] }];
  workspace.state.questionSets = [{ id: "set-1", title: "Saved set", questionIds: [question.id], sourceDocumentIds: [], tags: [],
    parserWarnings: [], aiEnhanced: false, createdAt: now, scope: { courseId: "course-1", module: "FTM 1" } }];
}

function catalogBeforeCollection(container: HTMLElement) {
  const catalog = container.querySelector(".qb-course-catalog")!;
  const collection = container.querySelector(".academic-library")!;
  return Boolean(catalog.compareDocumentPosition(collection) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("learner-first Question Bank library", () => {
  beforeEach(() => {
    workspace.state = { questions: [], questionSets: [], terms: [], courses: [] } as unknown as NoctyriumState;
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("opens discovery before an empty personal collection, with advanced source work closed", () => {
    const { container } = render(<QuestionBankLibrary {...handlers} heldForReview={0} />);
    expect(catalogBeforeCollection(container)).toBe(true);
    expect(container.querySelector<HTMLDetailsElement>(".qb-course-catalog")?.open).toBe(true);
    expect(screen.getByRole("region", { name: "Available question banks" })).toBeTruthy();
    expect(screen.getByText(/No saved questions yet/)).toBeTruthy();
    expect(screen.queryByText("Install a prepared course library")).toBeNull();
    expect(container.querySelector<HTMLDetailsElement>("#prepared-course-library")?.open).toBe(false);
    expect(screen.queryByText("Advanced source tools")).toBeNull();
    expect(screen.getByRole("button", { name: "Create a quiz" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Add material" }));
    expect(handlers.onImport).toHaveBeenCalledOnce();
  });

  it("keeps usable saved courses first and quiz creation available for a returning learner", () => {
    seedQuestions();
    const { container } = render(<QuestionBankLibrary {...handlers} heldForReview={0} />);
    expect(catalogBeforeCollection(container)).toBe(false);
    expect(container.querySelector<HTMLDetailsElement>(".qb-course-catalog")?.open).toBe(false);
    expect(screen.getByRole("region", { name: "Question bank library" })).toBeTruthy();
    expect(screen.getByText("1 ready to practice · 0 held for answer or source review.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create a quiz" }));
    expect(handlers.onCreate).toHaveBeenCalledOnce();
  });

  it("does not mistake a held local collection for usable practice", () => {
    seedQuestions({ ...readyQuestion, correctKey: undefined });
    const { container } = render(<QuestionBankLibrary {...handlers} heldForReview={1} />);
    expect(catalogBeforeCollection(container)).toBe(true);
    expect(container.querySelector<HTMLDetailsElement>(".qb-course-catalog")?.open).toBe(true);
    expect(screen.getByText("0 ready to practice · 1 held for answer or source review.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create a quiz" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("region", { name: "Question bank library" })).toBeTruthy();
  });

  it("switches discovery with keyboard focus and preserves an honest shared empty state", () => {
    render(<QuestionBankLibrary {...handlers} heldForReview={0} />);
    const tabs = screen.getByRole("tablist", { name: "Browse Question Bank" });
    const courses = within(tabs).getByRole("tab", { name: "Courses" });
    const shared = within(tabs).getByRole("tab", { name: "Shared sets" });
    courses.focus();
    fireEvent.keyDown(courses, { key: "ArrowRight" });
    expect(shared.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(shared);
    expect(screen.getByRole("region", { name: "Shared question sets" }).textContent).toBe("No sets found");
    expect(screen.queryByRole("region", { name: "Available question banks" })).toBeNull();
    fireEvent.keyDown(shared, { key: "Home" });
    expect(courses.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(courses);
    expect(screen.getByRole("region", { name: "Available question banks" })).toBeTruthy();
    fireEvent.click(shared);
    expect(screen.getByRole("region", { name: "Shared question sets" })).toBeTruthy();
  });

  it("loads advanced tools on demand and retains a started import when collapsed", () => {
    const { container } = render(<QuestionBankLibrary {...handlers} heldForReview={0} />);
    const advanced = container.querySelector<HTMLDetailsElement>("#prepared-course-library")!;
    advanced.open = true;
    fireEvent(advanced, new Event("toggle"));
    expect(screen.getByText("Advanced source tools")).toBeTruthy();
    advanced.open = false;
    fireEvent(advanced, new Event("toggle"));
    expect(screen.getByText("Advanced source tools")).toBeTruthy();
  });
});
