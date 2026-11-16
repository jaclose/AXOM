// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { makeSeed } from "../../lib/seed";
import type { NoctyriumState } from "../../lib/types";
import type { QuestionAttempt, QuestionRecord } from "../../lib/questions";
import { RecordReview } from "./RecordReview";

const mocks = vi.hoisted(() => ({ state: {} as unknown, launch: vi.fn() }));
vi.mock("../../lib/store", () => ({ useStore: Object.assign(() => mocks.state, { getState: () => mocks.state }) }));
vi.mock("../../lib/exam/practiceLaunch", () => ({
  capturePracticeLaunchContext: (questions: unknown) => ({ scope: "test-scope", questions }),
  launchRecommendedPractice: (...args: unknown[]) => mocks.launch(...args),
}));

const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const question = (id: string, attempts: QuestionAttempt[], patch: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id, source: "imported", stem: `Synthetic ${id}`, options: [{ key: "A", text: "One" }, { key: "B", text: "Two" }], correctKey: "A",
  status: "unseen", tags: [], attempts, createdAt: at(30), updatedAt: at(30), module: "GOER", ...patch });
const wrong = (daysAgo: number, patch: Partial<QuestionAttempt> = {}): QuestionAttempt => ({ at: at(daysAgo), status: "incorrect", answerKey: "B", ...patch });
const workspace = (questions: QuestionRecord[]): NoctyriumState => ({ ...makeSeed(), questions, tracker: [], logs: [], quizSessions: [], cardReviews: [], questionSets: [] });

describe("review from the learner's record", () => {
  beforeEach(() => { mocks.launch.mockReset(); });
  afterEach(cleanup);

  it("renders nothing when the record supports no block", () => {
    mocks.state = workspace([question("never-answered", [], { module: undefined })]);
    const { container } = render(<RecordReview title="Review" sub="Sub" />);
    expect(container.textContent).toBe("");
  });

  it("starts the runner with exactly the questions a block names", () => {
    mocks.state = workspace([question("sure", [wrong(1, { certainty: "sure" })]), question("m1", [wrong(2)]), question("m2", [wrong(3)]),
      question("other", [wrong(1)], { module: "FTM 1" }), question("held", [wrong(1)], { needsReview: true })]);
    render(<RecordReview title="Review what your answers point to" sub="Sub" />);
    const region = screen.getByRole("region", { name: "Review what your answers point to" });
    expect(region.querySelectorAll("li")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /Retry 2 missed questions in GOER/ }));
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.launch.mock.calls[0][0]).toEqual(["m1", "m2"]);
    fireEvent.click(screen.getByRole("button", { name: /Recheck 1 answer you were sure of/ }));
    expect(mocks.launch.mock.calls[1][0]).toEqual(["sure"]);
    expect(mocks.launch.mock.calls.map((call) => call[0]).flat()).not.toContain("held");
  });

  it("says why a block could not start and leaves the list in place", () => {
    mocks.state = workspace([question("m1", [wrong(2)])]);
    mocks.launch.mockImplementation(() => { throw new Error("Resume or finish your current quiz in Question Bank before starting another."); });
    render(<RecordReview title="Review" sub="Sub" />);
    fireEvent.click(screen.getByRole("button", { name: /Retry 1 missed question in GOER/ }));
    expect(screen.getByRole("alert").textContent).toContain("Resume or finish your current quiz");
    expect(screen.getByRole("button", { name: /Retry 1 missed question in GOER/ })).toBeTruthy();
  });
});
