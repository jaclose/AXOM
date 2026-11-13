// @vitest-environment jsdom
import { Profiler } from "react";
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

  it("cancels a pending inspection on Refresh before a revoked reviewer can see it", async () => {
    let completeOld!: (preview: typeof pendingPreview) => void;
    mocks.preview.mockImplementation(() => new Promise<typeof pendingPreview>(resolve => {
      completeOld = resolve;
    }));
    mocks.reviewer.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    render(<QuestionSetLibraryReviewQueue accountId="account-A" />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith("account-A", id));
    const refreshButton = screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(false);
    fireEvent.click(refreshButton);
    expect(await screen.findByText(/no academic reviewer permission/i)).toBeTruthy();

    await act(async () => { completeOld(pendingPreview); });
    expect(screen.queryByText("Account A confidential source and answer")).toBeNull();
    expect(screen.queryByText("Private correct option")).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve for library" })).toBeNull();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("drops the error from a cancelled inspection after a fresh queue loads", async () => {
    let failOld!: (error: Error) => void;
    mocks.preview.mockImplementation(() => new Promise<typeof pendingPreview>((_resolve, reject) => {
      failOld = reject;
    }));

    render(<QuestionSetLibraryReviewQueue accountId="account-A" />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith("account-A", id));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("button", { name: "Inspect" })).toBeTruthy();

    await act(async () => { failOld(new Error("Stale inspection error: source unavailable")); });
    expect(screen.queryByText(/stale inspection error/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("redacts confidential rows in the same render that starts a reviewer permission refresh", async () => {
    let finishAccess!: (allowed: boolean) => void;
    mocks.reviewer.mockResolvedValueOnce(true).mockImplementationOnce(() => new Promise<boolean>(resolve => {
      finishAccess = resolve;
    }));
    const disclosureCommits: string[] = [];
    let captureRefresh = false;
    render(<Profiler id="reviewer-queue" onRender={() => {
      // Profiler observes the committed DOM before the next passive effect.
      // Waiting until an effect clears old submissions is too late.
      if (captureRefresh && document.body.textContent?.includes("Account A pending set"))
        disclosureCommits.push("stale pending row");
      if (captureRefresh && document.body.textContent?.includes("Account A confidential source and answer"))
        disclosureCommits.push("stale inspected key");
    }}><QuestionSetLibraryReviewQueue accountId="account-A" /></Profiler>);

    fireEvent.click(await screen.findByRole("button", { name: "Inspect" }));
    expect(await screen.findByText("Account A confidential source and answer")).toBeTruthy();
    captureRefresh = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(disclosureCommits).toEqual([]);
    expect(screen.queryByText("Account A pending set")).toBeNull();
    expect(screen.queryByText("Account A confidential source and answer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Inspect" })).toBeNull();
    await act(async () => { finishAccess(false); });
    expect(await screen.findByText(/no academic reviewer permission/i)).toBeTruthy();
    expect(mocks.pending).toHaveBeenCalledTimes(1);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("keeps the old submission list hidden until refreshed reviewer and queue requests both settle", async () => {
    let finishList!: (rows: ReturnType<typeof pendingRow>[]) => void;
    mocks.pending.mockResolvedValueOnce([pendingRow("Old reviewer row")])
      .mockImplementationOnce(() => new Promise<ReturnType<typeof pendingRow>[]>(resolve => {
        finishList = resolve;
      }));
    render(<QuestionSetLibraryReviewQueue accountId="account-A" />);
    expect(await screen.findByText("Old reviewer row")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(mocks.pending).toHaveBeenCalledTimes(2));

    expect(screen.queryByText("Old reviewer row")).toBeNull();
    expect(screen.queryByRole("button", { name: "Inspect" })).toBeNull();
    await act(async () => { finishList([pendingRow("New permitted row")]); });
    expect(await screen.findByText("New permitted row")).toBeTruthy();
    expect(screen.queryByText("Old reviewer row")).toBeNull();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

});
