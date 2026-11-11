// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityQuestionSetLibrary } from "./CommunityQuestionSetLibrary";
import { QuestionSetLibrarySubmitDialog } from "./QuestionSetLibrarySubmitDialog";
import type { QuestionRecord } from "../../lib/questions";
import type { QuestionSet } from "../../lib/library";

const mock = vi.hoisted(() => ({
  sets: [] as QuestionSet[],
  accountId: "account-1", observers: new Set<(state: { user: { id: string } }) => void>(), search: vi.fn(), preview: vi.fn(), authorize: vi.fn(), like: vi.fn(), commit: vi.fn(), owned: vi.fn(), submit: vi.fn(), withdraw: vi.fn(),
}));
vi.mock("../../lib/account/accountStore", () => {
  const accountState = () => ({ user: { id: mock.accountId } });
  return {
    // Mirror both Zustand's selector and imperative getState. Updating the
    // account before rerender reproduces the stale-handler click interval.
    useAccount: Object.assign(
      (selector: (state: ReturnType<typeof accountState>) => unknown) => selector(accountState()),
      { getState: accountState, subscribe: (listener: (state: ReturnType<typeof accountState>) => void) => {
        mock.observers.add(listener);
        return () => { mock.observers.delete(listener); };
      } },
    ),
  };
});
vi.mock("../../lib/sharing/questionSetLibrary", () => ({
  searchQuestionSetLibrary: mock.search,
  loadQuestionSetLibraryPreview: mock.preview,
  authorizeQuestionSetLibraryImport: mock.authorize,
  setQuestionSetLibraryLike: mock.like,
  listMyQuestionSetSubmissions: mock.owned,
  submitQuestionSetToLibrary: mock.submit,
  withdrawQuestionSetSubmission: mock.withdraw,
}));
vi.mock("../../lib/store", () => ({
  useStore: Object.assign(() => ({}), { getState: () => ({ questionSets: mock.sets, commitSharedQuestionSetImport: mock.commit }) }),
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
  mock.sets = [];
  mock.observers.clear();
  mock.search.mockResolvedValue([summary]);
  mock.preview.mockResolvedValue({ id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved", reviewRevision: 2 });
  mock.authorize.mockImplementation(async (_account: string, selected: unknown) => selected);
  mock.like.mockResolvedValue(undefined);
  mock.commit.mockResolvedValue({ ok: true, message: "Saved" });
  mock.owned.mockResolvedValue([]);
});
afterEach(cleanup);

describe("Community Question Set Library", () => {
  const savedSet: QuestionSet = {
    id: "saved-set", title: "Saved synthetic practice", questionIds: ["local-q1"], sourceDocumentIds: [],
    tags: [], parserWarnings: [], aiEnhanced: false, createdAt: "2026-11-09T12:00:00Z",
    importProvenance: { version: 1, shareId: summary.id, contentDigest: "a".repeat(64) },
  };

  it("opens the exact saved copy directly in practice after a cloud import", async () => {
    const onPractice = vi.fn();
    mock.commit.mockImplementationOnce(async () => {
      mock.sets = [savedSet];
      return { ok: true, questionSetId: savedSet.id };
    });
    render(<CommunityQuestionSetLibrary onPractice={onPractice} />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview set" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add to my AXOM" }));
    fireEvent.click(await screen.findByRole("button", { name: "Practice this set" }));
    expect(onPractice).toHaveBeenCalledWith(savedSet);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the preview recoverable if the saved copy was removed before practice", async () => {
    mock.sets = [savedSet];
    const onPractice = vi.fn();
    render(<CommunityQuestionSetLibrary onPractice={onPractice} />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview set" }));
    await screen.findByRole("button", { name: "Practice this set" });
    mock.sets = [];
    fireEvent.click(screen.getByRole("button", { name: "Practice this set" }));
    expect(onPractice).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toContain("Add it again to practice");
    expect(screen.getByRole("button", { name: "Add to my AXOM" }).hasAttribute("disabled")).toBe(false);
  });

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

  it("revokes delayed search results after an A to B to A account round trip", async () => {
    let resolveSearch!: (value: typeof summary[]) => void;
    mock.search.mockImplementationOnce(() => new Promise(resolve => { resolveSearch = resolve; }));
    render(<CommunityQuestionSetLibrary />);
    await waitFor(() => expect(mock.search).toHaveBeenCalledWith("account-1", "", 0));
    expect(screen.getByText("Loading Question Sets…")).toBeTruthy();

    // Zustand may deliver both transitions before React commits a render.
    // The old listing has account-specific like state and must not reappear.
    act(() => {
      mock.accountId = "account-2";
      mock.observers.forEach(listener => listener({ user: { id: "account-2" } }));
      mock.accountId = "account-1";
      mock.observers.forEach(listener => listener({ user: { id: "account-1" } }));
    });
    expect(screen.queryByText("Loading Question Sets…")).toBeNull();
    await act(async () => { resolveSearch([{ ...summary, liked: true }]); });
    expect(screen.queryByRole("heading", { name: "Synthetic practice" })).toBeNull();
    expect(mock.observers.size).toBe(0);
  });

  it("suppresses stale search errors after an account session is revoked", async () => {
    let rejectSearch!: (reason: Error) => void;
    mock.search.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSearch = reject; }));
    render(<CommunityQuestionSetLibrary />);
    await waitFor(() => expect(mock.search).toHaveBeenCalledOnce());

    act(() => {
      mock.accountId = "account-2";
      mock.observers.forEach(listener => listener({ user: { id: "account-2" } }));
      mock.accountId = "account-1";
      mock.observers.forEach(listener => listener({ user: { id: "account-1" } }));
    });
    await act(async () => { rejectSearch(new Error("Old account's private query failed")); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Loading Question Sets…")).toBeNull();
    expect(mock.observers.size).toBe(0);
  });

  it("releases the search account subscription after a successful page", async () => {
    render(<CommunityQuestionSetLibrary />);
    expect(await screen.findByRole("heading", { name: "Synthetic practice" })).toBeTruthy();
    await waitFor(() => expect(mock.observers.size).toBe(0));
  });

  it("uses the latest same-batch preview selection despite out-of-order responses", async () => {
    const another = { ...summary, id: "00000000-0000-4000-8000-000000000022", title: "Second synthetic set" };
    const nextSnapshot = { ...snapshot, title: another.title, questions: [{
      ...snapshot.questions[0], id: "shared-question-2", stem: "Which second synthetic answer?",
    }] };
    mock.search.mockResolvedValueOnce([summary, another]);
    let resolveOld!: (value: unknown) => void;
    mock.preview.mockImplementation((_account: string, id: string) => id === summary.id
      ? new Promise(resolve => { resolveOld = resolve; })
      : Promise.resolve({ id: another.id, snapshot: nextSnapshot, contentDigest: "b".repeat(64), status: "approved", reviewRevision: 2 }));
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: another.title });
    const buttons = screen.getAllByRole("button", { name: "Preview set" });
    // Two clicks share the prior render's opening=false state.
    act(() => { fireEvent.click(buttons[0]); fireEvent.click(buttons[1]); });
    expect(mock.preview).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Which second synthetic answer?")).toBeTruthy();
    // The accepted preview remains bound to its originating auth session.
    await waitFor(() => expect(mock.observers.size).toBe(1));
    await act(async () => {
      resolveOld({ id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved", reviewRevision: 2 });
    });
    expect(screen.queryByText("Which synthetic answer is supported?")).toBeNull();
    expect(screen.getByText("Which second synthetic answer?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    expect(mock.commit.mock.calls[0][0].identity).toEqual({ shareId: another.id, contentDigest: "b".repeat(64) });
  });

  it("revokes a fully loaded preview after an A to B to A session round trip", async () => {
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    fireEvent.click(screen.getByRole("button", { name: "Preview set" }));
    expect(await screen.findByText("Which synthetic answer is supported?")).toBeTruthy();
    // The fetch has finished, but its import authorization must not outlive
    // the session that selected and reviewed this snapshot.
    await waitFor(() => expect(mock.observers.size).toBe(1));
    act(() => {
      mock.accountId = "account-2";
      mock.observers.forEach(listener => listener({ user: { id: "account-2" } }));
      mock.accountId = "account-1";
      mock.observers.forEach(listener => listener({ user: { id: "account-1" } }));
    });
    expect(screen.queryByRole("button", { name: "Add to my AXOM" })).toBeNull();
    expect(screen.queryByText("Which synthetic answer is supported?")).toBeNull();
    expect(mock.commit).not.toHaveBeenCalled();
    expect(mock.observers.size).toBe(0);

    // A fresh explicit preview is valid for the restored account session.
    fireEvent.click(screen.getByRole("button", { name: "Preview set" }));
    expect(await screen.findByText("Which synthetic answer is supported?")).toBeTruthy();
    await waitFor(() => expect(mock.observers.size).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(mock.observers.size).toBe(0);
  });

  it("does not reopen a dismissed preview when its request settles later", async () => {
    let rejectPreview!: (reason: Error) => void;
    mock.preview.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPreview = reject; }));
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    fireEvent.click(screen.getByRole("button", { name: "Preview set" }));
    expect(await screen.findByText("Opening this Question Set…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Opening this Question Set…")).toBeNull();
    await waitFor(() => expect(mock.observers.size).toBe(0));
    await act(async () => { rejectPreview(new Error("Dismissed preview request failed")); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Dismissed preview request failed")).toBeNull();
    expect(mock.commit).not.toHaveBeenCalled();
  });

  it("unsubscribes an unfinished preview when the library unmounts", async () => {
    mock.preview.mockImplementationOnce(() => new Promise(() => {}));
    const view = render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    fireEvent.click(screen.getByRole("button", { name: "Preview set" }));
    await waitFor(() => expect(mock.preview).toHaveBeenCalledOnce());
    expect(mock.observers.size).toBe(1);
    view.unmount();
    expect(mock.observers.size).toBe(0);
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
      resolvePreview({ id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved", reviewRevision: 2 });
    });
    expect(screen.queryByText("Which synthetic answer is supported?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to my AXOM" })).toBeNull();
    expect(mock.commit).not.toHaveBeenCalled();
  });


  it("refuses a stale SQL authorization response before the local vault is called", async () => {
    let finishAuthorization!: (value: unknown) => void;
    mock.authorize.mockImplementationOnce(() => new Promise(resolve => { finishAuthorization = resolve; }));
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    fireEvent.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.authorize).toHaveBeenCalledOnce());
    expect(mock.commit).not.toHaveBeenCalled();

    // The server may authorize the original revision while a sign-out and
    // return to the same account happen before its response is consumed.
    act(() => {
      mock.accountId = "account-2";
      mock.observers.forEach(listener => listener({ user: { id: "account-2" } }));
      mock.accountId = "account-1";
      mock.observers.forEach(listener => listener({ user: { id: "account-1" } }));
    });
    await act(async () => {
      finishAuthorization({
        id: summary.id, snapshot, contentDigest: "a".repeat(64),
        status: "approved", reviewRevision: 2,
      });
    });
    expect(mock.commit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Already in my AXOM" })).toBeNull();
    expect(screen.queryByText("Which synthetic answer is supported?")).toBeNull();
    expect(mock.observers.size).toBe(0);

    // A fresh, deliberate preview may obtain its own new SQL authorization.
    fireEvent.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.authorize).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    expect(mock.commit.mock.calls[0][0].identity).toEqual({
      shareId: summary.id, contentDigest: "a".repeat(64),
    });
  });

  it("revokes in-flight import authorization across an A to B to A account round trip", async () => {
    let resolveImport!: (value: unknown) => void;
    mock.commit.mockImplementationOnce(() => new Promise(resolve => { resolveImport = resolve; }));
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    await user.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    await user.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    const guard = mock.commit.mock.calls[0][0].accountGuard;
    expect(guard.isCurrentAccount("account-1")).toBe(true);

    // No React rerender is necessary for Zustand subscribers to see the
    // intermediate account. Identity equality on its own would miss this.
    act(() => {
      mock.accountId = "account-2";
      mock.observers.forEach(listener => listener({ user: { id: "account-2" } }));
      mock.accountId = "account-1";
      mock.observers.forEach(listener => listener({ user: { id: "account-1" } }));
    });
    expect(guard.isCurrentAccount("account-1")).toBe(false);
    expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull();
    expect(screen.queryByText("Which synthetic answer is supported?")).toBeNull();
    await act(async () => { resolveImport({ ok: true, added: 1 }); });
    expect(screen.queryByRole("button", { name: "Already in my AXOM" })).toBeNull();
    expect(mock.observers.size).toBe(0);
  });

  it("discards a delayed preview even when the original account returns", async () => {
    let resolvePreview!: (value: unknown) => void;
    mock.preview.mockImplementationOnce(() => new Promise(resolve => { resolvePreview = resolve; }));
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    fireEvent.click(screen.getByRole("button", { name: "Preview set" }));
    await waitFor(() => expect(mock.preview).toHaveBeenCalledOnce());
    act(() => {
      mock.accountId = "account-2";
      mock.observers.forEach(listener => listener({ user: { id: "account-2" } }));
      mock.accountId = "account-1";
      mock.observers.forEach(listener => listener({ user: { id: "account-1" } }));
    });
    await act(async () => { resolvePreview({ id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved", reviewRevision: 2 }); });
    expect(screen.queryByText("Which synthetic answer is supported?")).toBeNull();
    expect(screen.queryByText("Opening this Question Set…")).toBeNull();
    expect(mock.observers.size).toBe(0);
  });

  it("sends only one like RPC for rapid clicks before React commits the disabled state", async () => {
    let resolveLike!: (value: unknown) => void;
    mock.like.mockImplementationOnce(() => new Promise(resolve => { resolveLike = resolve; }));
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    const button = screen.getByRole("button", { name: "Like Synthetic practice" });
    // Both handlers run in a single React batch against the previous render.
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mock.like).toHaveBeenCalledTimes(1);
    expect(mock.like).toHaveBeenCalledWith("account-1", summary.id, true);
    await act(async () => { resolveLike(undefined); });
    expect(screen.getByRole("button", { name: "Unlike Synthetic practice" }).getAttribute("aria-pressed")).toBe("true");
    expect(mock.observers.size).toBe(0);
  });

  it("releases a revoked like reservation for a new account session without trusting the old completion", async () => {
    let resolveOld!: (value: unknown) => void;
    let resolveNew!: (value: unknown) => void;
    mock.like.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    fireEvent.click(screen.getByRole("button", { name: "Like Synthetic practice" }));
    expect(mock.like).toHaveBeenCalledTimes(1);
    // The A → B → A transition may occur before React sees account B.
    act(() => {
      mock.accountId = "account-2";
      mock.observers.forEach(listener => listener({ user: { id: "account-2" } }));
      mock.accountId = "account-1";
      mock.observers.forEach(listener => listener({ user: { id: "account-1" } }));
    });
    await screen.findByRole("heading", { name: "Synthetic practice" });
    fireEvent.click(screen.getByRole("button", { name: "Like Synthetic practice" }));
    expect(mock.like).toHaveBeenCalledTimes(2);
    await act(async () => { resolveOld(undefined); });
    expect(screen.getByRole("button", { name: "Like Synthetic practice" }).getAttribute("aria-pressed")).toBe("false");
    await act(async () => { resolveNew(undefined); });
    expect(screen.getByRole("button", { name: "Unlike Synthetic practice" }).getAttribute("aria-pressed")).toBe("true");
    expect(mock.observers.size).toBe(0);
  });

  it("does not credit a delayed like after leaving and returning to the same account", async () => {
    let resolveLike!: (value: unknown) => void;
    mock.like.mockImplementationOnce(() => new Promise(resolve => { resolveLike = resolve; }));
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    await user.click(screen.getByRole("button", { name: "Like Synthetic practice" }));
    await waitFor(() => expect(mock.like).toHaveBeenCalledOnce());
    act(() => {
      mock.accountId = "account-2";
      mock.observers.forEach(listener => listener({ user: { id: "account-2" } }));
      mock.accountId = "account-1";
      mock.observers.forEach(listener => listener({ user: { id: "account-1" } }));
    });
    await act(async () => { resolveLike(undefined); });
    expect((await screen.findByRole("button", { name: "Like Synthetic practice" })).getAttribute("aria-pressed")).toBe("false");
    expect(mock.observers.size).toBe(0);
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
    mock.preview.mockResolvedValue({
      id: summary.id, snapshot: generated, contentDigest: "b".repeat(64), status: "approved", reviewRevision: 2,
    });
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    await user.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    const reveal = screen.getByText("Reveal recorded answer and teaching notes");
    const teaching = reveal.closest("details");
    expect(teaching?.open).toBe(false);
    expect(mock.commit).not.toHaveBeenCalled();
    await user.click(reveal);
    expect(teaching?.open).toBe(true);
    expect(screen.getByText(/Submitted answer: B/)).toBeTruthy();
    expect(screen.getByText(/AI-assisted teaching text/)).toBeTruthy();
    expect(screen.getByText(generated.questions[0].explanation)).toBeTruthy();
    expect(screen.getByText(generated.questions[0].choiceRationales.A)).toBeTruthy();
    expect(screen.getByText(generated.questions[0].choiceRationales.B)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    const payload = mock.commit.mock.calls[0][0];
    expect(payload.snapshot.questions[0].explanation).toBe(generated.questions[0].explanation);
    expect(payload.snapshot.questions[0].choiceRationales).toEqual(generated.questions[0].choiceRationales);
    expect(payload.snapshot.questions[0].correctKey).toBe("B");
  });

  it("discloses absent source citations and missing distractor rationales without changing approved evidence", async () => {
    const approved = {
      ...snapshot,
      questions: [{
        ...snapshot.questions[0],
        citation: undefined,
        explanation: "The synthetic review includes a general explanation but no option-specific evidence.",
        choiceRationales: undefined,
      }],
    };
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot: approved, contentDigest: "f".repeat(64),
      status: "approved", reviewRevision: 7,
    });
    render(<CommunityQuestionSetLibrary />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    expect(screen.getByText(/No source citation is included for this question/)).toBeTruthy();
    fireEvent.click(screen.getByText("Reveal recorded answer and teaching notes"));
    expect(screen.getByText(/No choice-by-choice rationales were included/)).toBeTruthy();
    expect(screen.queryByText(/AI-assisted teaching text/)).toBeNull();
    expect(screen.getByText(/Submitted answer: B/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    expect(mock.commit.mock.calls[0][0].snapshot.questions[0]).toEqual(approved.questions[0]);
    expect(mock.authorize.mock.calls[0][1]).toMatchObject({
      reviewRevision: 7, contentDigest: "f".repeat(64),
    });
  });

  it("flags partially supported choices without inventing a missing correct-answer rationale", async () => {
    const partial = {
      ...snapshot,
      questions: [{
        ...snapshot.questions[0],
        explanation: "A general synthetic explanation was submitted for the selected option.",
        choiceRationales: { A: "Only the distractor A was explained." },
      }],
    };
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot: partial, contentDigest: "1".repeat(64),
      status: "approved", reviewRevision: 4,
    });
    render(<CommunityQuestionSetLibrary />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    fireEvent.click(screen.getByText("Reveal recorded answer and teaching notes"));
    expect(screen.getByText(/Some answer choices lack recorded rationales/)).toBeTruthy();
    expect(screen.getByText("Only the distractor A was explained.")).toBeTruthy();
    expect(screen.queryByText(/No choice-by-choice rationales were included/)).toBeNull();
    expect(screen.queryByText(/AI-assisted teaching text/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    expect(mock.commit.mock.calls[0][0].snapshot.questions[0]).toEqual(partial.questions[0]);
    expect(mock.authorize.mock.calls[0][1].reviewRevision).toBe(4);
  });

  it("discloses partial rationale-only teaching without inventing a general explanation", async () => {
    const rationaleOnly = {
      ...snapshot,
      questions: [{
        ...snapshot.questions[0],
        explanation: undefined,
        choiceRationales: {
          A: "AXOM AI-assisted rationale (verify against source): A is unsupported by the synthetic source.",
        },
      }],
    };
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot: rationaleOnly, contentDigest: "2".repeat(64),
      status: "approved", reviewRevision: 8,
    });
    render(<CommunityQuestionSetLibrary />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    fireEvent.click(screen.getByText("Reveal recorded answer and teaching notes"));
    expect(screen.getByText(/No general explanation was included/)).toBeTruthy();
    expect(screen.getByText(/Some answer choices lack recorded rationales/)).toBeTruthy();
    expect(screen.getByText(/AI-assisted teaching text/)).toBeTruthy();
    expect(screen.getByText(/A is unsupported by the synthetic source/)).toBeTruthy();
    expect(screen.queryByText(/No teaching rationale was included/)).toBeNull();
    expect(screen.queryByText(/No choice-by-choice rationales were included/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    expect(mock.commit.mock.calls[0][0].snapshot.questions[0]).toEqual(rationaleOnly.questions[0]);
    expect(mock.authorize.mock.calls[0][1]).toMatchObject({
      reviewRevision: 8, contentDigest: "2".repeat(64),
    });
  });

  it("does not warn about missing evidence when a submitted citation and individual rationales exist", async () => {
    const approved = {
      ...snapshot,
      questions: [{
        ...snapshot.questions[0],
        explanation: "The selected synthetic option is supported by the recorded synthetic citation.",
        choiceRationales: { A: "The source rules out A.", B: "The source supports B." },
      }],
    };
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot: approved, contentDigest: "e".repeat(64),
      status: "approved", reviewRevision: 2,
    });
    render(<CommunityQuestionSetLibrary />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    expect(screen.queryByText(/No source citation is included/)).toBeNull();
    fireEvent.click(screen.getByText("Reveal recorded answer and teaching notes"));
    expect(screen.queryByText(/No choice-by-choice rationales were included/)).toBeNull();
    expect(screen.getByText("The source rules out A.")).toBeTruthy();
    expect(screen.getByText("The source supports B.")).toBeTruthy();
  });

  it("shows recorded choice rationales when reviewed option and rationale key casing differ", async () => {
    // Both spellings are accepted by the snapshot validator. They must map
    // to the same reviewed choices without fabricating any missing rationale.
    const reviewed = {
      ...snapshot,
      questions: [{
        ...snapshot.questions[0],
        choiceRationales: {
          a: "Source-reviewed note: Alpha contradicts the synthetic answer.",
          b: "Source-reviewed note: Beta is the keyed synthetic answer.",
        },
      }],
    };
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot: reviewed, contentDigest: "b".repeat(64),
      status: "approved", reviewRevision: 2,
    });
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    await user.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    await user.click(screen.getByText("Reveal recorded answer and teaching notes"));
    expect(screen.getByText(/Submitted answer: B/)).toBeTruthy();
    expect(screen.getByText(reviewed.questions[0].choiceRationales.a)).toBeTruthy();
    expect(screen.getByText(reviewed.questions[0].choiceRationales.b)).toBeTruthy();
    expect(screen.queryByText(/AI-assisted teaching text/)).toBeNull();
    expect(mock.commit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    // The UI normalizes the lookup only; it never rewrites the approved
    // revision, answer key, choice rationales, or provenance during import.
    expect(mock.commit.mock.calls[0][0].snapshot.questions[0]).toEqual(reviewed.questions[0]);
  });

  it("shows the recorded choice text for source-valid padded answer keys without changing publication evidence", async () => {
    // Shared snapshot validation accepts surrounding whitespace and case
    // differences in correctKey. The preview must use the same normalization
    // for lookup, without silently replacing the source-reviewed answer key.
    const approved = {
      ...snapshot,
      questions: [{ ...snapshot.questions[0], correctKey: " b ",
        choiceRationales: { " b ": "Reviewed note: this source supports the keyed choice." },
      }],
    };
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot: approved, contentDigest: "b".repeat(64),
      status: "approved", reviewRevision: 2,
    });
    render(<CommunityQuestionSetLibrary />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    fireEvent.click(screen.getByText("Reveal recorded answer and teaching notes"));
    const key = screen.getByText("Submitted answer: b");
    expect(key.closest("p")?.textContent).toContain("Second");
    expect(screen.getByText("Reviewed note: this source supports the keyed choice.")).toBeTruthy();
    expect(screen.queryByText(/No recorded answer key/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    expect(mock.commit.mock.calls[0][0].snapshot.questions[0]).toEqual(approved.questions[0]);
    expect(mock.authorize.mock.calls[0][1]).toMatchObject({
      reviewRevision: 2, contentDigest: "b".repeat(64),
    });
  });

  it("labels approved visual intent as unreviewed planning metadata without altering the imported questions", async () => {
    const visuallyTagged = {
      ...snapshot,
      tags: ["visual:intent:histology-micrograph", "visual:keyword:glomerulus", "renal"],
      questions: [{
        ...snapshot.questions[0],
        tags: ["visual:intent:histology-micrograph", "visual:keyword:glomerulus", "visual:keyword:eosin"],
      }],
    };
    mock.search.mockResolvedValueOnce([{
      ...summary, tags: ["visual:intent:histology-micrograph", "renal", "visual:keyword:glomerulus"],
    }]);
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot: visuallyTagged, contentDigest: "b".repeat(64), status: "approved", reviewRevision: 2,
    });
    render(<CommunityQuestionSetLibrary />);
    const heading = await screen.findByRole("heading", { name: "Synthetic practice" });
    const card = heading.closest("article");
    expect(card?.textContent).toContain("renal");
    expect(card?.textContent).not.toContain("visual:");
    fireEvent.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    expect(screen.getByText("1 question · renal")).toBeTruthy();
    expect(screen.getByText(/Visual intent metadata: histology micrograph/)).toBeTruthy();
    expect(screen.getByText(/No diagram is included.*media rights require separate review/)).toBeTruthy();
    expect(screen.queryByText(/visual:intent:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    // Metadata is advisory in the UI, yet the source-checked snapshot and its
    // digest/revision remain exactly what the server authorized for import.
    expect(mock.commit.mock.calls[0][0].snapshot).toEqual(visuallyTagged);
    expect(mock.commit.mock.calls[0][0].snapshot.questions[0].correctKey).toBe("B");
  });

  it("ignores unknown visual-intent kinds rather than presenting them as reviewed images", async () => {
    mock.search.mockResolvedValueOnce([{
      ...summary, tags: ["visual:intent:untrusted", "visual:keyword:unlicensed", "renal"],
    }]);
    mock.preview.mockResolvedValueOnce({
      id: summary.id,
      snapshot: {
        ...snapshot, tags: ["visual:intent:untrusted", "renal"],
        questions: [{ ...snapshot.questions[0], tags: ["visual:intent:untrusted", "visual:keyword:unlicensed"] }],
      },
      contentDigest: "c".repeat(64), status: "approved", reviewRevision: 2,
    });
    render(<CommunityQuestionSetLibrary />);
    const heading = await screen.findByRole("heading", { name: "Synthetic practice" });
    expect(heading.closest("article")?.textContent).not.toContain("visual:");
    fireEvent.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    expect(screen.queryByText(/Visual intent metadata/)).toBeNull();
    expect(screen.getByText("1 question · renal")).toBeTruthy();
  });

  it("retains bounded recognized visual plans when an unknown intent comes first", async () => {
    const visualTags = [
      "visual:intent:untrusted", "visual:intent:constructor",
      "visual:intent:histology-micrograph", "visual:intent:mechanism-diagram", "visual:intent:histology-micrograph",
      "visual:intent:gross-pathology-specimen", "visual:intent:microbiology-image",
      "visual:keyword:glomerulus",
    ];
    const inspected = {
      ...snapshot,
      questions: [{ ...snapshot.questions[0], tags: visualTags }],
    };
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot: inspected, contentDigest: "d".repeat(64),
      status: "approved", reviewRevision: 2,
    });
    render(<CommunityQuestionSetLibrary />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    const label = screen.getByText(/Visual intent metadata:/);
    expect(label.textContent).toContain("histology micrograph, mechanism diagram, gross pathology specimen");
    expect(label.textContent).not.toContain("untrusted");
    expect(label.textContent).not.toContain("microbiology image"); // Max three recognized kinds.
    expect(label.textContent).toContain("No diagram is included");
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    // Presentation cannot rewrite the immutable approved tags, key or revision.
    expect(mock.commit.mock.calls[0][0].snapshot).toEqual(inspected);
    expect(mock.authorize.mock.calls[0][1]).toMatchObject({
      reviewRevision: 2, contentDigest: "d".repeat(64),
    });
  });

  it("does not mistake an empty rationale map for source-reviewed teaching evidence", async () => {
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot: {
        ...snapshot,
        questions: [{ ...snapshot.questions[0], explanation: undefined, choiceRationales: {} }],
      },
      contentDigest: "d".repeat(64), status: "approved", reviewRevision: 2,
    });
    render(<CommunityQuestionSetLibrary />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    fireEvent.click(screen.getByText("Reveal recorded answer and teaching notes"));
    expect(screen.getByText("No teaching rationale was included in this approved snapshot.")).toBeTruthy();
    expect(screen.queryByText(/AI-assisted teaching text/)).toBeNull();
  });

  it("does not invent an answer key or rationale in a legacy preview without evidence", async () => {
    mock.preview.mockResolvedValue({
      id: summary.id,
      snapshot: { ...snapshot, questions: [{ ...snapshot.questions[0], correctKey: undefined }] },
      contentDigest: "c".repeat(64), status: "approved", reviewRevision: 1,
    });
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await user.click(await screen.findByRole("button", { name: "Preview set" }));
    await user.click(screen.getByText("Reveal recorded answer and teaching notes"));
    expect(screen.getByText("No recorded answer key. Do not infer one from the explanation.")).toBeTruthy();
    expect(screen.getByText("No teaching rationale was included in this approved snapshot.")).toBeTruthy();
    expect(screen.queryByText(/Submitted answer:/)).toBeNull();
    expect(mock.commit).not.toHaveBeenCalled();
  });

  it("checks the live approved listing again before importing a previously reviewed preview", async () => {
    // The account guard is live while the vault commit is invoked, then must
    // expire when the import operation settles. A completed import must not
    // leave behind authorization that could be reused later.
    let authorizedDuringCommit = false;
    mock.commit.mockImplementationOnce(async (payload: { accountGuard: { isCurrentAccount: (id: string) => boolean } }) => {
      authorizedDuringCommit = payload.accountGuard.isCurrentAccount("account-1");
      return { ok: true, message: "Saved" };
    });
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    await user.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    await user.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledOnce());
    expect(mock.preview).toHaveBeenCalledTimes(1);
    expect(mock.authorize).toHaveBeenCalledWith("account-1", expect.objectContaining({
      id: summary.id, contentDigest: "a".repeat(64), reviewRevision: 2,
    }));
    const imported = mock.commit.mock.calls[0][0];
    expect(imported.snapshot.questions[0].correctKey).toBe("B");
    expect(imported.identity).toEqual({ shareId: summary.id, contentDigest: "a".repeat(64) });
    expect(authorizedDuringCommit).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Already in my AXOM" }).hasAttribute("disabled")).toBe(true));
    expect(imported.accountGuard.isCurrentAccount("account-1")).toBe(false);
  });

  it("does not acknowledge failed vault persistence and rechecks approval before retry", async () => {
    mock.commit.mockResolvedValueOnce({ ok: false, message: "Synthetic vault is unavailable" })
      .mockResolvedValueOnce({ ok: true, message: "Saved" });
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    await user.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    await user.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    expect(await screen.findByText("Synthetic vault is unavailable")).toBeTruthy();
    expect(mock.commit).toHaveBeenCalledOnce();
    const first = mock.commit.mock.calls[0][0];
    expect(first.snapshot.questions[0].correctKey).toBe("B");
    await waitFor(() => expect(first.accountGuard.isCurrentAccount("account-1")).toBe(false));
    expect(screen.getByRole("button", { name: "Add to my AXOM" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Already in my AXOM" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.commit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Already in my AXOM" }).hasAttribute("disabled")).toBe(true));
    // Opening one preview plus one separate server authorization per attempt;
    // a failed vault write never grants a reusable permit.
    expect(mock.preview).toHaveBeenCalledTimes(1);
    expect(mock.authorize).toHaveBeenCalledTimes(2);
    expect(mock.commit.mock.calls[1][0].identity).toEqual({
      shareId: summary.id, contentDigest: "a".repeat(64),
    });
    expect(mock.commit.mock.calls[1][0].snapshot.questions[0].correctKey).toBe("B");
    expect(mock.commit.mock.calls[1][0].accountGuard.isCurrentAccount("account-1")).toBe(false);
  });

  it("rejects a listing changed to pending after an approved preview", async () => {
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved", reviewRevision: 2,
    });
    mock.authorize.mockResolvedValueOnce({
      id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "pending", reviewRevision: 3,
    });
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    await user.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    await user.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    expect(await screen.findByText(/reviewed Question Set changed/)).toBeTruthy();
    expect(mock.commit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Add to my AXOM" })).toBeNull();
    expect(mock.observers.size).toBe(0);
  });

  it("rejects same-content reapproval at a newer review revision", async () => {
    mock.authorize.mockResolvedValueOnce({
      id: summary.id, snapshot, contentDigest: "a".repeat(64),
      status: "approved", reviewRevision: 4,
    });
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    await user.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    await user.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    expect(await screen.findByText(/reviewed Question Set changed/)).toBeTruthy();
    expect(mock.commit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Add to my AXOM" })).toBeNull();
  });

  it("refuses to import a withdrawn listing after the preview was loaded", async () => {
    mock.preview.mockReset().mockResolvedValueOnce({
      id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved", reviewRevision: 2,
    });
    mock.authorize.mockRejectedValueOnce(new Error("This Question Set is unavailable. It may have been withdrawn."));
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    await user.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    await user.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    expect(await screen.findByText(/may have been withdrawn/)).toBeTruthy();
    expect(mock.authorize).toHaveBeenCalledTimes(1);
    expect(mock.commit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Add to my AXOM" })).toBeNull();
    expect(mock.observers.size).toBe(0);
  });

  it("refuses changed reviewed snapshots without importing a different answer key", async () => {
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved", reviewRevision: 2,
    });
    mock.authorize.mockResolvedValueOnce({
      id: summary.id, snapshot: { ...snapshot, questions: [{ ...snapshot.questions[0], correctKey: "A" }] },
      contentDigest: "b".repeat(64), status: "approved", reviewRevision: 2,
    });
    const user = userEvent.setup();
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    await user.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    await user.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    expect(await screen.findByText(/reviewed Question Set changed/)).toBeTruthy();
    expect(mock.commit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Add to my AXOM" })).toBeNull();
  });

  it("revokes a pending live-import approval check on an A to B to A session round trip", async () => {
    let finishReview!: (value: unknown) => void;
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved", reviewRevision: 2,
    });
    mock.authorize.mockImplementationOnce(() => new Promise(resolve => { finishReview = resolve; }));
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    fireEvent.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mock.authorize).toHaveBeenCalledTimes(1));
    expect(mock.commit).not.toHaveBeenCalled();
    act(() => {
      mock.accountId = "account-2";
      mock.observers.forEach(listener => listener({ user: { id: "account-2" } }));
      mock.accountId = "account-1";
      mock.observers.forEach(listener => listener({ user: { id: "account-1" } }));
    });
    await act(async () => {
      finishReview({ id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved", reviewRevision: 2 });
    });
    expect(mock.commit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Add to my AXOM" })).toBeNull();
    expect(mock.observers.size).toBe(0);
  });

  it("coalesces rapid same-frame import clicks before the live approval check settles", async () => {
    let finishReview!: (value: unknown) => void;
    mock.preview.mockResolvedValueOnce({
      id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved", reviewRevision: 2,
    });
    mock.authorize.mockImplementationOnce(() => new Promise(resolve => { finishReview = resolve; }));
    render(<CommunityQuestionSetLibrary />);
    await screen.findByRole("heading", { name: "Synthetic practice" });
    fireEvent.click(screen.getByRole("button", { name: "Preview set" }));
    await screen.findByText("Which synthetic answer is supported?");
    const button = screen.getByRole("button", { name: "Add to my AXOM" });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(mock.authorize).toHaveBeenCalledTimes(1);
    expect(mock.commit).not.toHaveBeenCalled();
    await act(async () => {
      finishReview({ id: summary.id, snapshot, contentDigest: "a".repeat(64), status: "approved", reviewRevision: 2 });
    });
    expect(mock.commit).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Already in my AXOM" })).toBeTruthy();
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
