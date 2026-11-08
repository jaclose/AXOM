// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityQuestionSetLibrary } from "./CommunityQuestionSetLibrary";
import { QuestionSetLibrarySubmitDialog } from "./QuestionSetLibrarySubmitDialog";
import type { QuestionRecord } from "../../lib/questions";
import type { QuestionSet } from "../../lib/library";

const mock = vi.hoisted(() => ({
  search: vi.fn(), preview: vi.fn(), like: vi.fn(), commit: vi.fn(), owned: vi.fn(), submit: vi.fn(), withdraw: vi.fn(),
}));
vi.mock("../../lib/account/accountStore", () => {
  const accountState = { user: { id: "account-1" } };
  return {
    // Mirror Zustand's selector plus imperative session read. The publishing
    // dialog must assert both views of the same account during operations.
    useAccount: Object.assign(
      (selector: (state: typeof accountState) => unknown) => selector(accountState),
      { getState: () => accountState },
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
