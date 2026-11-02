// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useStore } from "../../lib/store";
import type { QuestionRecord } from "../../lib/questions";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { COURSE_QUIZ_LAUNCH_KEY } from "../../lib/course-engine/quizLaunch";
import { closeWorkspace, openEmptyWorkspace } from "../../lib/question-content/persistenceHarness.testing";
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

describe("hosted question collection without a weekly plan", () => {
  beforeEach(async () => {
    await openEmptyWorkspace();
    sessionStorage.clear();
    location.hash = "";
    mocks.preview.mockResolvedValue({ id: revision, collection_id: collection, template_text: "", ready_questions: 2, review_questions: 1 });
    mocks.download.mockImplementation(async () => {
      useStore.setState(state => ({ questions: [...state.questions, question("q1"), question("q2"), question("held", { needsReview: true })] }));
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

    fireEvent.click(practice);
    expect(JSON.parse(sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY) ?? "null")).toEqual({
      module: "GOER", term: "Term 5", questionIds: ["q1", "q2"], setIds: ["set-1"],
    });
    expect(location.hash).toBe("#questions");
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
