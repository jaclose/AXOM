// @vitest-environment jsdom
// APEX R74: exercise the actual receipt-bound selector through the visible term actions.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import type { DownloadReference, DownloadWorkspace } from "../../lib/academicLibrary/downloadReference";
import type { SourceDocument } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import type { Course, Term } from "../../lib/types";
import { TermCourseActions } from "./TermCourseActions";

type Workspace = DownloadWorkspace & { courses: Course[]; terms: Term[] };
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  launch: vi.fn(),
  state: undefined as unknown as Workspace,
}));
vi.mock("../../lib/store", () => ({
  useStore: Object.assign(() => mocks.state, { getState: () => mocks.state }),
}));
vi.mock("../../lib/academicLibrary/client", () => ({ listAcademicCourses: vi.fn() }));
vi.mock("../../lib/academicLibrary/accountScope", () => ({
  academicAccountScope: (key: string) => ({ key, assertCurrent: () => {}, dispose: () => {} }),
}));
vi.mock("../../lib/sync/contentDownloads", () => ({ downloadAccountContent: vi.fn() }));
vi.mock("../../lib/localVault", () => ({
  getVaultWriteCheckpoint: vi.fn(), flushLocalVaultWrites: vi.fn(), assertVaultWritesSince: vi.fn(),
}));
vi.mock("../../lib/academicLibrary/termCourses", async importOriginal => {
  const original = await importOriginal<typeof import("../../lib/academicLibrary/termCourses")>();
  return { ...original, listTermCourses: mocks.list };
});
vi.mock("../../lib/course-engine/quizLaunch", () => ({
  launchCourseQuiz: mocks.launch, MAX_COURSE_QUIZ_QUESTIONS: 2000,
}));

function catalog(id: string, revision: string): AcademicCourse {
  return {
    id, current_revision_id: revision, title: id, module: id, term: "Term 5",
    visibility: "shared", review_status: "approved", owned: false,
    ready_questions: 1, review_questions: 0,
  };
}
function receipt(id: string, revision: string, accountId: string, questionId: string, term?: string): SourceDocument {
  return {
    id: `academic-${revision}`, fileType: "axom-academic-reference",
    title: "Synthetic downloaded course receipt", fileName: "course-reference.json",
    sizeBytes: 1,
    rawText: JSON.stringify({
      collectionId: id, revisionId: revision, accountId, status: "complete",
      warnings: [], module: id, ...(term ? { term } : {}),
      questionIds: [questionId], setIds: [], templateIds: [], documentIds: [],
    } satisfies DownloadReference),
    uploadedAt: "2026-11-13", tags: [], linkedQuestionSetIds: [], libraryOnly: true,
  };
}
function question(id: string): QuestionRecord {
  return {
    id, stem: id, source: "imported",
    options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }],
    correctKey: "A", status: "unseen", tags: [], attempts: [],
    createdAt: "2026-11-13", updatedAt: "2026-11-13",
  };
}
function workspace(documents: SourceDocument[], ids: string[]): Workspace {
  return {
    documents, questions: ids.map(question), questionSets: [],
    deferredContent: undefined, courses: [], terms: [],
  };
}
const onBusyChange = vi.fn();
function actions(accountId: string, courses: readonly AcademicCourse[] = []) {
  return <TermCourseActions term="Term 5" accountId={accountId}
    courses={courses} disabled={false} onBusyChange={onBusyChange} />;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockReset();
  mocks.state = workspace([], []);
});
afterEach(cleanup);

describe("term practice with real account-scoped receipt selection", () => {
  it("does not authorize termless receipts from a visible catalog page after full lookup fails", async () => {
    const visibleLegacy = catalog("legacy", "legacy-revision");
    mocks.state = workspace([
      receipt("known", "known-revision", "account-a", "known-question", "Term 5"),
      receipt("legacy", "legacy-revision", "account-a", "legacy-question"),
    ], ["known-question", "legacy-question"]);
    mocks.list.mockRejectedValueOnce(new Error("Full term catalog unavailable."));
    render(actions("account-a", [visibleLegacy]));
    await screen.findByText("Full term catalog unavailable.");
    expect(screen.getByText(/1 answer-ready question on this device/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Older downloads without a saved term are excluded");
    fireEvent.click(screen.getByRole("button", { name: "Practice Term 5" }));
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(mocks.launch.mock.calls[0][0]).toMatchObject({
      scopeKind: "term", term: "Term 5", questionIds: ["known-question"], setIds: [],
    });
  });

  it("selects only the active receipt across A to B to A and ignores a late A catalog response", async () => {
    const aCourse = catalog("a-collection", "a-revision");
    const bCourse = catalog("b-collection", "b-revision");
    mocks.state = workspace([
      receipt("a-collection", "a-revision", "account-a", "a-question"),
      receipt("b-collection", "b-revision", "account-b", "b-question"),
    ], ["a-question", "b-question"]);
    let resolveOldA!: (courses: AcademicCourse[]) => void;
    const oldA = new Promise<AcademicCourse[]>(resolve => { resolveOldA = resolve; });
    mocks.list.mockReturnValueOnce(oldA).mockResolvedValueOnce([bCourse]).mockResolvedValueOnce([aCourse]);
    const view = render(actions("account-a"));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "Practice Term 5" }) as HTMLButtonElement).disabled).toBe(true);

    view.rerender(actions("account-b"));
    expect((screen.getByRole("button", { name: "Practice Term 5" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect((screen.getByRole("button", { name: "Practice Term 5" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Practice Term 5" }));
    expect(mocks.launch.mock.calls.at(-1)?.[0].questionIds).toEqual(["b-question"]);

    await act(async () => resolveOldA([aCourse]));
    fireEvent.click(screen.getByRole("button", { name: "Practice Term 5" }));
    expect(mocks.launch.mock.calls.at(-1)?.[0].questionIds).toEqual(["b-question"]);

    view.rerender(actions("account-a"));
    expect((screen.getByRole("button", { name: "Practice Term 5" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect((screen.getByRole("button", { name: "Practice Term 5" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Practice Term 5" }));
    expect(mocks.launch.mock.calls.at(-1)?.[0].questionIds).toEqual(["a-question"]);
    expect(mocks.launch.mock.calls.map(call => call[0].questionIds)).toEqual([
      ["b-question"], ["b-question"], ["a-question"],
    ]);
  });
});
