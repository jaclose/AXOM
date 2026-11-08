// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityQuestionSetLibrary } from "./CommunityQuestionSetLibrary";
import { QuestionSetLibrarySubmitDialog } from "./QuestionSetLibrarySubmitDialog";
import type { QuestionRecord } from "../../lib/questions";
import type { QuestionSet } from "../../lib/library";

const mock = vi.hoisted(() => ({
  accountId: "account-1", search: vi.fn(), preview: vi.fn(), like: vi.fn(), commit: vi.fn(), owned: vi.fn(), submit: vi.fn(), withdraw: vi.fn(),
}));
vi.mock("../../lib/account/accountStore", () => {
  const accountState = () => ({ user: { id: mock.accountId } });
  return {
    // Mirror both Zustand's selector and imperative getState. Updating the
    // account before rerender reproduces the stale-handler click interval.
    useAccount: Object.assign(
      (selector: (state: ReturnType<typeof accountState>) => unknown) => selector(accountState()),
      { getState: accountState },
    ),
  };
});
vi.mock("../../lib/sharing/questionSetLibrary", () => ({
  searchQuestionSetLibrary: mock.search,
  loadQuestionSetLibraryPreview: mock.preview,
  setQuestionSetLibraryLike: mock.like,
  listMyQuestionSetSubmissions: mock.owned,
  submitQuestionSetToLibrary: mock.submit,
  withdrawQuestionSetSubmission: mock.withdraw,
}));
vi.mock("../../lib/store", () => ({
  useStore: Object.assign(() => ({}), { getState: () => ({ questionSets: [], commitSharedQuestionSetImport: mock.commit }) }),
}));

const summary = {
  id: "00000000-0000-4000-8000-000000000011", title: "Synthetic practice", credit: "Test author",
  tags: ["sample"], questionCount: 1, approvedAt: "2026-11-01T12:00:00Z", likes: 2, liked: false,
};
const snapshot = {
  shareFormatVersion: 1, title: summary.title, tags: ["sample"], orderedQuestionIds: ["shared-question-1"],
  questions: [{ id: "shared-question-1", stem: "Which synthetic answer is supported?",
    options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }], correctKey: "B", tags: [], citation: "Synthetic source" }],
  createdAt: "2026-11-01T12:00:00Z", copyrightNotice: "Synthetic test content",
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.accountId = "account-1";
  mock.search.mockResolvedValue([summary]);
  mock.preview.mockResolvedValue({ id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved" });
  mock.like.mockResolvedValue(undefined);
  mock.commit.mockResolvedValue({ ok: true, message: "Saved" });
  mock.owned.mockResolvedValue([]);
});
afterEach(cleanup);

describe("Community Question Set Library", () => {
  it("searches approved listings, opens a safe preview, imports, and likes", async () => {
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    expect(await screen.findByRole("heading", { name: "Synthetic practice" })).toBeTruthy();
    await user.type(screen.getByRole("searchbox", { name: "Search Community Question Sets" }), "sample");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(mock.search).toHaveBeenCalledWith("account-1", "sample", 0));
    await user.click(screen.getByRole("button", { name: "Preview set" }));
    expect(await screen.findByText("Which synthetic answer is supported?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledWith(expect.objectContaining({
      identity: { shareId: summary.id, contentDigest: "a".repeat(64) },
    })));
    expect(screen.getByRole("button", { name: "Already in my AXOM" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Like Synthetic practice" }));
    await waitFor(() => expect(mock.like).toHaveBeenCalledWith("account-1", summary.id, true));
  });

  it("refuses stale-account import and like clicks before React rerenders", async () => {
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    await user.click(screen.getByRole("button", { name: "Preview set" }));
    expect(await screen.findByText("Which synthetic answer is supported?")).toBeTruthy();

    // An auth store update can precede rendering the new account's library.
    mock.accountId = "account-2";
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    fireEvent.click(screen.getByRole("button", { name: "Like Synthetic practice" }));
    expect(mock.commit).not.toHaveBeenCalled();
    expect(mock.like).not.toHaveBeenCalled();
  });

  it("discards a previous account's preview response after a session switch", async () => {
    let resolvePreview!: (value: unknown) => void;
    mock.preview.mockImplementationOnce(() => new Promise(resolve => { resolvePreview = resolve; }));
    const view = render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    fireEvent.click(screen.getByRole("button", { name: "Preview set" }));
    await waitFor(() => expect(mock.preview).toHaveBeenCalledWith("account-1", summary.id));

    mock.accountId = "account-2";
    view.rerender(<CommunityQuestionSetLibrary />);
    await act(async () => {
      resolvePreview({ id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved" });
    });
    expect(screen.queryByText("Which synthetic answer is supported?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to my AXOM" })).toBeNull();
    expect(mock.commit).not.toHaveBeenCalled();
  });

  it("preserves explicit AI explanation and choice-rationale provenance through import", async () => {
    const generated = {
      ...snapshot,
      questions: [{
        ...snapshot.questions[0],
        explanation: "AXOM AI-assisted explanation (verify against source): Sample teaching rationale.",
        choiceRationales: {
          A: "AXOM AI-assisted rationale (verify against source): Rejected by supplied evidence.",
          B: "AXOM AI-assisted rationale (verify against source): Supported by supplied evidence.",
        },
      }],
    };
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot: generated, contentDigest: "b".repeat(64), status: "approved",
    });
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    await user.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    await user.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    const payload = mock.commit.mock.calls[0][0];
    expect(payload.snapshot.questions[0].explanation).toBe(generated.questions[0].explanation);
    expect(payload.snapshot.questions[0].choiceRationales).toEqual(generated.questions[0].choiceRationales);
    expect(payload.snapshot.questions[0].correctKey).toBe("B");
  });

  it("holds unresolved and media-bearing local questions out of public submission", async () => {
    const set = { id: "set-1", title: "Needs source review", questionIds: ["q-1"], tags: [],
      sourceDocumentIds: [], createdAt: "2026-11-01T12:00:00Z", aiEnhanced: false, parserWarnings: [] } as QuestionSet;
    const question = { id: "q-1", stem: "Which synthetic answer?", options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }],
      tags: [], attempts: [], source: "manual", status: "unseen", createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-01T12:00:00Z" } as QuestionRecord;
    const { rerender } = render(<QuestionSetLibrarySubmitDialog set={set} questions={[question]} onClose={() => {}} />);
    expect(await screen.findByText(/still held for answer or source review/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send for review/ }).hasAttribute("disabled")).toBe(true);
    rerender(<QuestionSetLibrarySubmitDialog set={set} questions={[{
      ...question, correctKey: "A", attachments: [{ assetId: "synthetic-media" }] as never,
    }]} onClose={() => {}} />);
    expect(await screen.findByText(/image or media that this library snapshot cannot carry/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send for review/ }).hasAttribute("disabled")).toBe(true);
    expect(mock.submit).not.toHaveBeenCalled();
  });
});
