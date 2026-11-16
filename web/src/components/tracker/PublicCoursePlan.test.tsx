// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import { useUi } from "../../lib/uiStore";
import { PublicCoursePlan } from "./PublicCoursePlan";

const mocks = vi.hoisted(() => ({ course: vi.fn() }));
vi.mock("../../lib/academicLibrary/publicCatalog", () => ({ getPublicCourse: (...args: unknown[]) => mocks.course(...args) }));
vi.mock("../ui/primitives", () => ({
  GButton: ({ children, variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button type="button" {...props}>{children}</button>,
}));

const ID = "11111111-1111-4111-8111-111111111111";
const course: AcademicCourse = { id: ID, title: "FTM 1 course", module: "FTM 1", term: "Term 1", visibility: "shared", review_status: "approved",
  current_revision_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", owned: false, ready_questions: 12, review_questions: 0 };
const preview = (template_text: string, patch: Record<string, unknown> = {}) => ({ id: ID, title: course.title, module: course.module, term: course.term,
  current_revision_id: course.current_revision_id, ready_questions: 12, source_revision: "2026-A", template_text, ...patch });
const SECTION_BREAK = "\n@@ AXOM course plan section @@\n";

describe("visitor course preview", () => {
  beforeEach(() => { useUi.setState({ settingsRequest: null }); });
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it("shows the reviewed weekly plan read-only and sends the visitor to sign in to use it", async () => {
    mocks.course.mockResolvedValue(preview("T1 - FTM 1 - Lectures:\nWeek 1:\nLecture 01 Foundations [Lecture]\nWeek 2:\nLecture 02 Systems [Lecture]\nLecture 03 Signals [Lecture]\n"));
    const onBack = vi.fn();
    render(<PublicCoursePlan course={course} onBack={onBack} />);
    expect(screen.getByRole("status").textContent).toBe("Opening the course plan…");
    const plan = screen.getByRole("region", { name: "FTM 1 course plan" });
    expect(await within(plan).findByRole("heading", { name: "Weekly plan" })).toBeTruthy();
    expect(mocks.course).toHaveBeenCalledWith(ID);
    expect(within(plan).getByText("Week 1").nextElementSibling?.textContent).toBe("1 activity");
    expect(within(plan).getByText("Week 2").nextElementSibling?.textContent).toBe("2 activities");
    expect(within(plan).getByText("Lecture 03 Signals")).toBeTruthy();
    expect(plan.textContent).toContain("12 reviewed questions");
    expect(plan.textContent).toContain("Source revision: 2026-A");
    expect(plan.textContent).not.toContain("tentative");
    // Read-only: nothing to select, load or practise without an account.
    expect(within(plan).queryByRole("checkbox")).toBeNull();
    expect(within(plan).queryByRole("button", { name: "Load Course" })).toBeNull();
    fireEvent.click(within(plan).getByRole("button", { name: "Sign in or create an account" }));
    expect(useUi.getState().settingsRequest).toBe("account");
    fireEvent.click(within(plan).getByRole("button", { name: /All courses/ }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("marks only AXOM-ordered activities as tentative and leaves unplaced ones without a week", async () => {
    mocks.course.mockResolvedValue(preview(`T1 - FTM 1 - Small groups:\nWeek 1:\nSG 1 Cases [Small Group]\n${SECTION_BREAK}T1 - FTM 1 - Lectures:\nLecture 01 Foundations [Lecture]\n`));
    render(<PublicCoursePlan course={course} onBack={() => {}} />);
    expect(await screen.findByText("Week 1")).toBeTruthy();
    expect(screen.getByText("Week 1").nextElementSibling?.textContent).toBe("2 activities · 1 tentative");
    expect(screen.getByText(/placed by AXOM's ordering/)).toBeTruthy();
    expect(screen.getByText("Lecture 01 Foundations").nextElementSibling?.textContent).toContain("tentative week");
    expect(screen.getByText("SG 1 Cases").nextElementSibling?.textContent).not.toContain("tentative");

    cleanup();
    mocks.course.mockResolvedValue(preview("T1 - FTM 1 - Lectures:\nLecture 01 Foundations [Lecture]\n"));
    render(<PublicCoursePlan course={course} onBack={() => {}} />);
    expect(await screen.findByText("No stated week")).toBeTruthy();
    expect(screen.queryByText("Week 1")).toBeNull();
    expect(screen.getByText(/AXOM does not assign one/)).toBeTruthy();
  });

  it("explains a question collection, a withdrawn offer and an outage, and retries on request", async () => {
    mocks.course.mockResolvedValueOnce(preview(""));
    const first = render(<PublicCoursePlan course={course} onBack={() => {}} />);
    expect(await screen.findByText("This course is a question collection without a weekly plan.")).toBeTruthy();
    first.unmount();

    mocks.course.mockResolvedValueOnce(null);
    const second = render(<PublicCoursePlan course={course} onBack={() => {}} />);
    expect(await screen.findByText(/no longer offered to visitors/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Weekly plan" })).toBeNull();
    second.unmount();

    mocks.course.mockRejectedValueOnce(new Error("This course could not be opened. Check your connection and retry."))
      .mockResolvedValueOnce(preview("T1 - FTM 1 - Lectures:\nWeek 1:\nLecture 01 Foundations [Lecture]\n"));
    render(<PublicCoursePlan course={course} onBack={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain("could not be opened");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Week 1")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
