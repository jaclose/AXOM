// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useStore } from "../../lib/store";
import type { QuestionRecord } from "../../lib/questions";
import type { QuestionSet } from "../../lib/library";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { COURSE_QUIZ_LAUNCH_KEY } from "../../lib/course-engine/quizLaunch";
import { closeWorkspace, openEmptyWorkspace, reloadWorkspace } from "../../lib/question-content/persistenceHarness.testing";
import { ConnectedCoursePlan } from "./ConnectedCoursePlan";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), download: vi.fn(), enroll: vi.fn() }));
vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: "learner-1" } }),
}));
vi.mock("../../lib/academicLibrary/accountScope", () => ({
  academicAccountScope: () => ({ key: "learner-1", assertCurrent: () => {}, dispose: () => {} }),
}));
vi.mock("../../lib/academicLibrary/client", () => ({
  academicPreview: (...args: unknown[]) => mocks.preview(...args),
  downloadAcademicCourse: (...args: unknown[]) => mocks.download(...args),
  enrollAcademicCourse: (...args: unknown[]) => mocks.enroll(...args),
}));
vi.mock("./AcademicSharing", () => ({ AcademicSharing: () => null }));
vi.mock("../ui/primitives", () => ({
  GButton: ({ children, variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) =>
    <button type="button" {...props}>{children}</button>,
}));

const collection = "11111111-1111-4111-8111-111111111111";
const revision = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const course: AcademicCourse = {
  id: collection, title: "GOER questions", module: "GOER", term: "Term 5", visibility: "shared",
  review_status: "approved", current_revision_id: revision, owned: false, ready_questions: 2, review_questions: 1,
};
const now = "2026-10-27T00:00:00.000Z";
const question = (id: string, patch: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id, source: "imported", stem: `Synthetic question ${id}`, options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
  correctKey: "A", status: "unseen", tags: [], attempts: [], createdAt: now, updatedAt: now, module: "GOER", ...patch,
});
const set = (id: string, questionIds: string[], scope: QuestionSet["scope"] = { module: "GOER" }): QuestionSet => ({
  id, title: "Synthetic source set", questionIds, scope, sourceDocumentIds: [], tags: [], aiEnhanced: false,
  parserWarnings: [], createdAt: now,
});

describe("hosted question collection without a weekly plan", () => {
  beforeEach(async () => {
    await openEmptyWorkspace();
    sessionStorage.clear();
    location.hash = "";
    mocks.preview.mockResolvedValue({ id: revision, collection_id: collection, template_text: "", ready_questions: 2, review_questions: 1 });
    mocks.download.mockImplementation(async () => {
      useStore.setState(state => ({ questions: [...state.questions,
        question("q1", { week: 1, setId: "set-1" }), question("q2", { week: 2, setId: "set-1" }),
        question("held", { week: 3, setId: "set-1", needsReview: true })],
      questionSets: [...state.questionSets, set("set-1", ["q1", "q2", "held"])] }));
      return { status: "complete", warnings: [], templateIds: [], documentIds: [], questionIds: ["q1", "q2", "held"], setIds: ["set-1"], bindings: { originals: [] } };
    });
  });
  afterEach(async () => { cleanup(); vi.clearAllMocks(); await closeWorkspace(); });

  it("opens instead of failing, downloads only on request, and practices exactly the ready questions", async () => {
    render(<ConnectedCoursePlan course={course} onBack={vi.fn()} onOpen={vi.fn()} onCustomize={vi.fn()} onSharingSaved={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "GOER" })).toBeTruthy();
    expect(screen.getByText(/has no weekly plan/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Create Quiz/ })).toBeNull();
    expect(mocks.download).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Download questions/ }));
    const practice = await screen.findByRole("button", { name: /Create Quiz/ });
    expect(mocks.download).toHaveBeenCalledWith(revision, expect.any(Function), expect.objectContaining({ key: "learner-1" }));
    expect(mocks.enroll).not.toHaveBeenCalled();
    // The durable receipt lets a reload reopen the same downloaded collection.
    await waitFor(() => expect(useStore.getState().documents.some(document => document.id === `academic-${revision}`)).toBe(true));
    expect(screen.getByText("2 reviewed questions are on this device.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Week 1" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Week 2" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Week 3" })).toBeTruthy();
    expect(screen.getByText("0 ready questions · 1 awaiting review")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quiz week 3" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Quiz week 2" }));
    expect(JSON.parse(sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY) ?? "null")).toEqual({
      module: "GOER", term: "Term 5", week: 2, questionIds: ["q2"], setIds: ["set-1"],
    });

    fireEvent.click(practice);
    expect(JSON.parse(sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY) ?? "null")).toEqual({
      module: "GOER", term: "Term 5", questionIds: ["q1", "q2"], setIds: ["set-1"],
    });
    expect(location.hash).toBe("#questions");
  });

  it("keeps a source question without a week in an explicit unassigned group", async () => {
    mocks.download.mockImplementationOnce(async () => {
      useStore.setState(state => ({ questions: [...state.questions, question("unassigned")] }));
      return { status: "complete", warnings: [], templateIds: [], documentIds: [], questionIds: ["unassigned"], setIds: [], bindings: { originals: [] } };
    });
    render(<ConnectedCoursePlan course={course} onBack={vi.fn()} onOpen={vi.fn()} onCustomize={vi.fn()} onSharingSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Download questions/ }));
    expect(await screen.findByRole("heading", { name: "Unassigned week" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Quiz week/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Create Quiz/ }));
    expect(JSON.parse(sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY) ?? "null")).toEqual({
      module: "GOER", term: "Term 5", questionIds: ["unassigned"], setIds: [],
    });
  });

  it("blocks a refiled source question even when its download has no sets", async () => {
    mocks.download.mockImplementationOnce(async () => {
      useStore.setState(state => ({ questions: [...state.questions, question("no-set", { week: 2 })] }));
      return { status: "complete", warnings: [], templateIds: [], documentIds: [],
        questionIds: ["no-set"], setIds: [], bindings: { originals: [] } };
    });
    render(<ConnectedCoursePlan course={course} onBack={vi.fn()} onOpen={vi.fn()} onCustomize={vi.fn()} onSharingSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Download questions/ }));
    expect(await screen.findByRole("button", { name: "Quiz week 2" })).toBeTruthy();
    const refile = (patch: Partial<QuestionRecord>) => useStore.setState(state => ({ questions: state.questions.map(item =>
      item.id === "no-set" ? { ...item, ...patch } : item) }));
    refile({ module: "NMI" });
    expect((await screen.findByRole("alert")).textContent).toMatch(/saved filing no longer matches/);
    expect(screen.queryByRole("button", { name: "Quiz week 2" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create Quiz/ })).toBeNull();
    refile({ module: "GOER", courseId: "foreign-course" });
    expect((await screen.findByRole("alert")).textContent).toMatch(/saved filing no longer matches/);
    refile({ courseId: undefined });
    fireEvent.click(await screen.findByRole("button", { name: "Quiz week 2" }));
    expect(JSON.parse(sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY) ?? "null")).toEqual({
      module: "GOER", term: "Term 5", week: 2, questionIds: ["no-set"], setIds: [],
    });
  });

  it("uses a question's stated week before its set week and inherits a set week when unstated", async () => {
    mocks.download.mockImplementationOnce(async () => {
      useStore.setState(state => ({ questions: [...state.questions,
        question("own-week", { week: 2, setId: "set-1" }), question("set-week", { setId: "set-2" })],
      questionSets: [...state.questionSets, set("set-1", ["own-week"], { module: "GOER", week: 1 }),
        set("set-2", ["set-week"], { module: "GOER", week: 2 })] }));
      return { status: "complete", warnings: [], templateIds: [], documentIds: [],
        questionIds: ["own-week", "set-week"], setIds: ["set-1", "set-2"], bindings: { originals: [] } };
    });
    render(<ConnectedCoursePlan course={course} onBack={vi.fn()} onOpen={vi.fn()} onCustomize={vi.fn()} onSharingSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Download questions/ }));
    const week2 = await screen.findByRole("button", { name: "Quiz week 2" });
    expect(screen.queryByRole("button", { name: "Quiz week 1" })).toBeNull();
    fireEvent.click(week2);
    expect(JSON.parse(sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY) ?? "null")).toEqual({
      module: "GOER", term: "Term 5", week: 2, questionIds: ["own-week", "set-week"], setIds: ["set-1", "set-2"],
    });
  });

  it("retries a missing set after reload instead of misfiling its questions", async () => {
    render(<ConnectedCoursePlan course={course} onBack={vi.fn()} onOpen={vi.fn()} onCustomize={vi.fn()} onSharingSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Download questions/ }));
    expect(await screen.findByRole("button", { name: "Quiz week 2" })).toBeTruthy();
    useStore.setState({ questionSets: [] });
    await reloadWorkspace();
    const retry = await screen.findByRole("button", { name: /Download questions/ });
    expect(screen.queryByRole("button", { name: "Quiz week 2" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Unassigned week" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create Quiz/ })).toBeNull();
    mocks.download.mockImplementationOnce(async () => {
      useStore.setState(state => ({ questionSets: [...state.questionSets, set("set-1", ["q1", "q2", "held"])] }));
      return { status: "complete", warnings: [], templateIds: [], documentIds: [],
        questionIds: ["q1", "q2", "held"], setIds: ["set-1"], bindings: { originals: [] } };
    });
    fireEvent.click(retry);
    expect(await screen.findByRole("button", { name: "Quiz week 2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Download questions/ })).toBeNull();
  });

  it("blocks a shared source after its question or set is refiled to another course", async () => {
    render(<ConnectedCoursePlan course={course} onBack={vi.fn()} onOpen={vi.fn()} onCustomize={vi.fn()} onSharingSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Download questions/ }));
    expect(await screen.findByRole("button", { name: "Quiz week 2" })).toBeTruthy();
    // A second hosted course can point to the same saved source identity.
    const current = useStore.getState().documents.find(document => document.id === `academic-${revision}`)!;
    const reference = JSON.parse(current.rawText) as Record<string, unknown>;
    useStore.setState(state => ({ documents: [...state.documents, { ...current, id: "academic-other-revision",
      rawText: JSON.stringify({ ...reference, collectionId: "other-course", revisionId: "other-revision", module: "NMI" }) }] }));
    const refileQuestion = (patch: Partial<QuestionRecord>) => useStore.setState(state => ({ questions: state.questions.map(item =>
      item.id === "q2" ? { ...item, ...patch } : item) }));
    const refileSet = (scope: QuestionSet["scope"]) => useStore.setState(state => ({ questionSets: state.questionSets.map(item =>
      item.id === "set-1" ? { ...item, scope } : item) }));
    refileQuestion({ module: "NMI" });
    expect((await screen.findByRole("alert")).textContent).toMatch(/saved filing no longer matches/);
    expect(screen.queryByRole("button", { name: "Quiz week 2" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create Quiz/ })).toBeNull();
    refileQuestion({ module: "GOER" });
    expect(await screen.findByRole("button", { name: "Quiz week 2" })).toBeTruthy();
    refileSet({ module: "NMI" });
    expect((await screen.findByRole("alert")).textContent).toMatch(/saved filing no longer matches/);
    expect(screen.queryByRole("button", { name: "Quiz week 2" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create Quiz/ })).toBeNull();
    refileSet({ module: "GOER", courseId: "foreign-course" });
    expect((await screen.findByRole("alert")).textContent).toMatch(/saved filing no longer matches/);
    refileSet({ module: "GOER" });
    refileQuestion({ courseId: "foreign-course" });
    expect((await screen.findByRole("alert")).textContent).toMatch(/saved filing no longer matches/);
    refileQuestion({ courseId: undefined });
    fireEvent.click(await screen.findByRole("button", { name: "Quiz week 2" }));
    expect(JSON.parse(sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY) ?? "null")).toEqual({
      module: "GOER", term: "Term 5", week: 2, questionIds: ["q2"], setIds: ["set-1"],
    });
  });

  it("reports a failed download without claiming the questions are on this device", async () => {
    mocks.download.mockRejectedValueOnce(new Error("A course file failed its integrity check. Your local work is unchanged."));
    render(<ConnectedCoursePlan course={course} onBack={vi.fn()} onOpen={vi.fn()} onCustomize={vi.fn()} onSharingSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Download questions/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/integrity check/);
    expect(screen.queryByRole("button", { name: /Create Quiz/ })).toBeNull();
    expect(useStore.getState().documents.some(document => document.id === `academic-${revision}`)).toBe(false);
  });
});
