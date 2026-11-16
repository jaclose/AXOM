// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { StudyAction, StudyPlan } from "../../lib/studyPlan";
import { StudyPlanPanel } from "./StudyPlanPanel";

const mocks = vi.hoisted(() => ({ launch: vi.fn(), questions: [{ id: "a" }, { id: "b" }] }));
vi.mock("../../lib/store", () => ({
  useStore: Object.assign((select: (state: { questions: unknown[] }) => unknown) => select({ questions: mocks.questions }), { getState: () => ({ questions: mocks.questions }) }),
}));
vi.mock("../../lib/exam/practiceLaunch", () => ({
  capturePracticeLaunchContext: (questions: unknown) => ({ scope: "test-scope", questions }),
  launchRecommendedPractice: (...args: unknown[]) => mocks.launch(...args),
}));

const quiet = { answered: 0, correct: 0, accuracy: null, trackerPasses: 0, cardReviews: 0, observedMinutes: 0, reportedMinutes: 0 };
const retry: StudyAction = { id: "retry-missed:goer", kind: "retry-missed", title: "Retry 2 missed questions in GOER", reason: "Your latest answer to each of 2 questions here was wrong.",
  minutes: 3, actionLabel: "Start retry", launch: { type: "practice", questionIds: ["a", "b"] } };
const course: StudyAction = { id: "continue-course:goer:2", kind: "continue-course", title: "Continue GOER, Week 2", reason: "3 activities are not started.",
  actionLabel: "Open Course Tracker", launch: { type: "route", route: "tracker" } };
const plan = (patch: Partial<StudyPlan> = {}): StudyPlan => ({ actions: [], observed: quiet, empty: false, ...patch });

describe("from your record, under Up Next", () => {
  beforeEach(() => { mocks.launch.mockReset(); window.location.hash = "productivity"; });
  afterEach(cleanup);

  it("lists each supported action with its reason and starts it through the guarded practice launch", () => {
    render(<StudyPlanPanel plan={plan({ actions: [retry, course] })} />);
    const region = screen.getByRole("region", { name: "From your record" });
    expect(within(region).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Retry 2 missed questions in GOER", "Continue GOER, Week 2"]);
    expect(region.textContent).toContain("About 3 min at your pace.");
    fireEvent.click(within(region).getByRole("button", { name: "Start retry" }));
    expect(mocks.launch).toHaveBeenCalledWith(["a", "b"], { scope: "test-scope", questions: mocks.questions }, mocks.questions);
    fireEvent.click(within(region).getByRole("button", { name: "Open Course Tracker" }));
    expect(window.location.hash).toBe("#tracker");
  });

  it("reports a refused start, and separates what AXOM recorded from what the learner typed", () => {
    mocks.launch.mockImplementation(() => { throw new Error("Resume or finish your current quiz in Question Bank before starting another."); });
    render(<StudyPlanPanel plan={plan({ actions: [retry], observed: { ...quiet, answered: 12, correct: 9, accuracy: 75, trackerPasses: 2, observedMinutes: 50, reportedMinutes: 40 } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Start retry" }));
    expect(screen.getByRole("alert").textContent).toContain("Resume or finish your current quiz");
    const recorded = screen.getByLabelText("Recorded today");
    expect(recorded.textContent).toContain("12 questions answered, 75% correct · 2 course passes · 50 min timed");
    expect(recorded.textContent).toContain("Logged by you40 min");
  });

  it("explains an empty workspace and renders nothing when there is nothing to add", () => {
    const first = render(<StudyPlanPanel plan={plan({ empty: true })} />);
    expect(screen.getByText(/AXOM plans from what you do in it/)).toBeTruthy();
    first.unmount();
    const { container } = render(<StudyPlanPanel plan={plan()} />);
    expect(container.textContent).toBe("");
  });
});
