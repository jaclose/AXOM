// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionSetLibraryReviewQueue } from "./QuestionSetLibraryReviewQueue";

const mocks = vi.hoisted(() => ({
  reviewer: vi.fn(),
  pending: vi.fn(),
  preview: vi.fn(),
  decide: vi.fn(),
}));

vi.mock("../../lib/academicLibrary/client", () => ({
  isAcademicReviewer: (...args: unknown[]) => mocks.reviewer(...args),
}));
vi.mock("../../lib/sharing/questionSetLibrary", () => ({
  listPendingQuestionSets: (...args: unknown[]) => mocks.pending(...args),
  loadPendingQuestionSetReviewPreview: (...args: unknown[]) => mocks.preview(...args),
  reviewQuestionSetSubmission: (...args: unknown[]) => mocks.decide(...args),
}));

const id = "11111111-1111-4111-8111-111111111111";
const pendingRow = (title: string) => ({
  id, sourceId: "private-source", title, credit: "Contributor",
  questionCount: 1, status: "pending", reviewNote: "",
  createdAt: "2026-11-13T12:00:00Z",
});
const pendingPreview = {
  id, status: "pending" as const, reviewRevision: 1, contentDigest: "a".repeat(64),
  snapshot: {
    title: "A source-only submission",
    questions: [{
      id: "private-question", stem: "Account A confidential source and answer",
      options: [{ key: "A", text: "Private correct option" }, { key: "B", text: "Distractor" }],
      correctKey: "A", citation: "Private owner evidence",
    }],
  },
};

describe("Question Set reviewer account isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reviewer.mockResolvedValue(true);
    mocks.pending.mockResolvedValue([pendingRow("Account A pending set")]);
    mocks.preview.mockResolvedValue(pendingPreview);
    mocks.decide.mockResolvedValue(undefined);
  });
  afterEach(() => cleanup());

  it("removes an open confidential preview immediately when the reviewer account switches", async () => {
    mocks.reviewer.mockImplementation(async (account: string) => account === "account-A");
    const view = render(<QuestionSetLibraryReviewQueue accountId="account-A" />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    expect(await screen.findByText("Account A confidential source and answer")).toBeTruthy();

    view.rerender(<QuestionSetLibraryReviewQueue accountId="account-B" />);
    expect(screen.queryByText("Account A confidential source and answer")).toBeNull();
    expect(screen.queryByText("Private correct option")).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve for library" })).toBeNull();
    expect(await screen.findByText(/no academic reviewer permission/i)).toBeTruthy();
    expect(mocks.pending).toHaveBeenCalledTimes(1);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("does not reveal A's pending submission when its request completes after B's queue loads", async () => {
    let finishOld!: (rows: ReturnType<typeof pendingRow>[]) => void;
    mocks.pending.mockImplementation((account: string) => account === "account-A"
      ? new Promise<ReturnType<typeof pendingRow>[]>(resolve => { finishOld = resolve; })
      : Promise.resolve([pendingRow("Account B pending set")]));

    const view = render(<QuestionSetLibraryReviewQueue accountId="account-A" />);
    await waitFor(() => expect(mocks.pending).toHaveBeenCalledWith("account-A"));
    view.rerender(<QuestionSetLibraryReviewQueue accountId="account-B" />);
    expect(await screen.findByText("Account B pending set")).toBeTruthy();

    await act(async () => { finishOld([pendingRow("Account A pending set")]); });
    expect(screen.queryByText("Account A pending set")).toBeNull();
    expect(screen.getByText("Account B pending set")).toBeTruthy();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("drops an in-flight A preview response after switching to B", async () => {
    let finishOld!: (value: typeof pendingPreview) => void;
    mocks.preview.mockImplementation(() => new Promise<typeof pendingPreview>(resolve => {
      finishOld = resolve;
    }));
    mocks.reviewer.mockImplementation(async (account: string) => account === "account-A");

    const view = render(<QuestionSetLibraryReviewQueue accountId="account-A" />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith("account-A", id));
    view.rerender(<QuestionSetLibraryReviewQueue accountId="account-B" />);
    await act(async () => { finishOld(pendingPreview); });

    expect(screen.queryByText("Account A confidential source and answer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve for library" })).toBeNull();
    expect(await screen.findByText(/no academic reviewer permission/i)).toBeTruthy();
    expect(mocks.decide).not.toHaveBeenCalled();
  });
});
