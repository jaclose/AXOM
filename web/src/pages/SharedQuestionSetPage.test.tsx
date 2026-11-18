// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionSet } from "../lib/library";
import { createQuestionSetShare } from "../lib/sharing/questionSetShare";
import { resolveShare } from "../lib/sharing/supabaseSharing";
import { SharedQuestionSetPage } from "./SharedQuestionSetPage";

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  questionSets: [] as QuestionSet[],
  accountId: "account-1" as string | null,
  accountPhase: "signed-in" as "signed-in" | "signed-out" | "loading" | "unconfigured",
  accountLink: "linked" as "linked" | "unlinked" | "linked-elsewhere",
  accountBusy: false,
  accountApplyingRemote: false,
  accountRestoreOffer: false,
  accountObservers: new Set<(state: { user: { id: string } | null }) => void>(),
  storeObservers: new Set<(state: { questionSets: QuestionSet[] }, previous: { questionSets: QuestionSet[] }) => void>(),
}));

const accountState = () => ({
  user: mocks.accountId ? { id: mocks.accountId } : null,
  phase: mocks.accountPhase,
  link: mocks.accountLink,
  busy: mocks.accountBusy,
  applyingRemote: mocks.accountApplyingRemote,
  restoreOffer: mocks.accountRestoreOffer ? { id: "restore-offer" } : undefined,
});

vi.mock("../lib/account/accountStore", () => ({
  useAccount: {
    getState: accountState,
    subscribe: (listener: (state: { user: { id: string } | null }) => void) => {
      mocks.accountObservers.add(listener);
      return () => { mocks.accountObservers.delete(listener); };
    },
  },
}));

function emitAccount() {
  const state = accountState();
  mocks.accountObservers.forEach((listener) => listener(state));
}

function switchAccount(id: string | null) {
  mocks.accountId = id;
  mocks.accountPhase = id ? "signed-in" : "signed-out";
  mocks.accountLink = id ? "linked" : "unlinked";
  emitAccount();
}

function hydrateQuestionSets(next: QuestionSet[]) {
  const previous = mocks.questionSets;
  mocks.questionSets = next;
  mocks.storeObservers.forEach((listener) =>
    listener({ questionSets: next }, { questionSets: previous }));
}

vi.mock("../lib/store", () => ({
  useStore: {
    getState: () => ({
      questionSets: mocks.questionSets,
      commitSharedQuestionSetImport: mocks.commit,
    }),
    subscribe: (listener: (state: { questionSets: QuestionSet[] }, previous: { questionSets: QuestionSet[] }) => void) => {
      mocks.storeObservers.add(listener);
      return () => { mocks.storeObservers.delete(listener); };
    },
  },
}));
vi.mock("../lib/sharing/supabaseSharing", () => ({ resolveShare: vi.fn() }));

const SHARE_ID = "00000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);
const TOKEN = "b".repeat(48);
const NOW = "2026-10-15T12:00:00.000Z";

const snapshot = createQuestionSetShare({
  id: "source-set",
  title: "Synthetic shared set",
  sourceDocumentIds: [],
  createdAt: NOW,
  questionIds: ["q1"],
  tags: [],
  aiEnhanced: false,
  parserWarnings: [],
}, [{
  id: "q1",
  source: "manual",
  stem: "Synthetic question?",
  options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  correctKey: "A",
  correctAnswerText: "Alpha",
  status: "unseen",
  tags: [],
  attempts: [],
  createdAt: NOW,
  updatedAt: NOW,
}], NOW);

const NEXT_TOKEN = "c".repeat(48);
const nextShare = {
  id: "00000000-0000-4000-8000-000000000002",
  contentDigest: "d".repeat(64),
  snapshot: { ...snapshot, title: "Second shared set" },
};

beforeEach(() => {
  mocks.accountId = "account-1";
  mocks.accountPhase = "signed-in";
  mocks.accountLink = "linked";
  mocks.accountBusy = false;
  mocks.accountApplyingRemote = false;
  mocks.accountRestoreOffer = false;
  mocks.accountObservers.clear();
  mocks.storeObservers.clear();
  window.history.replaceState(null, "", `#/shared?token=${TOKEN}`);
  mocks.questionSets = [];
  mocks.commit.mockReset();
  vi.mocked(resolveShare).mockReset();
  vi.mocked(resolveShare).mockResolvedValue({ id: SHARE_ID, snapshot, contentDigest: DIGEST });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Shared Question Set page", () => {
  it("routes the validated server identity through the durable store action", async () => {
    mocks.commit.mockResolvedValue({
      ok: true,
      questionSetId: "local-set",
      questionIds: ["local-question"],
      added: 1,
      reused: 0,
      alreadyImported: false,
    });
    render(<SharedQuestionSetPage />);
    expect(await screen.findByRole("heading", { name: "Synthetic shared set" })).toBeTruthy();
    expect(screen.getByText("Unlisted Question Set link")).toBeTruthy();
    expect(screen.getByText(/Anyone with this link can open and import the snapshot/)).toBeTruthy();
    expect(screen.getByText(/Do not share restricted or private source material/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));

    await waitFor(() => expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({
      snapshot,
      identity: { shareId: SHARE_ID, contentDigest: DIGEST },
    })));
    expect(await screen.findByRole("button", { name: "Already in this AXOM" })).toHaveProperty("disabled", true);
  });

  it("recognizes a durable prior import after reload without another mutation", async () => {
    mocks.questionSets = [{
      id: "local-set",
      title: "Synthetic shared set",
      sourceDocumentIds: [],
      createdAt: NOW,
      questionIds: ["local-question"],
      tags: [],
      aiEnhanced: false,
      parserWarnings: [],
      importProvenance: { version: 1, shareId: SHARE_ID, contentDigest: DIGEST },
    }];
    render(<SharedQuestionSetPage />);

    expect(await screen.findByRole("button", { name: "Already in this AXOM" })).toHaveProperty("disabled", true);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("shows a durable-save failure and leaves retry available", async () => {
    mocks.commit.mockResolvedValue({
      ok: false,
      message: "Synthetic vault failure",
      rollbackFailures: [],
    });
    render(<SharedQuestionSetPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to my AXOM" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Synthetic vault failure");
    expect(screen.getByRole("button", { name: "Add to my AXOM" })).toHaveProperty("disabled", false);
  });

  it("resolves a new share token on an already-mounted page and imports only the new snapshot", async () => {
    vi.mocked(resolveShare).mockImplementation(async (token) =>
      token === TOKEN ? { id: SHARE_ID, snapshot, contentDigest: DIGEST } : nextShare,
    );
    mocks.commit.mockResolvedValue({
      ok: true, questionSetId: "second-local-set", questionIds: ["second-local-question"],
      added: 1, reused: 0, alreadyImported: false,
    });

    render(<SharedQuestionSetPage />);
    expect(await screen.findByRole("heading", { name: "Synthetic shared set" })).toBeTruthy();
    window.history.replaceState(null, "", `#/shared?token=${NEXT_TOKEN}`);
    fireEvent(window, new Event("hashchange"));

    expect(await screen.findByRole("heading", { name: "Second shared set" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: nextShare.snapshot,
      identity: { shareId: nextShare.id, contentDigest: nextShare.contentDigest },
    })));
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });

  it("ignores a previous token's late share resolution", async () => {
    let finishOld!: () => void;
    vi.mocked(resolveShare).mockImplementation((token) =>
      token === TOKEN
        ? new Promise<Awaited<ReturnType<typeof resolveShare>>>((resolve) => {
            finishOld = () => resolve({ id: SHARE_ID, snapshot, contentDigest: DIGEST });
          })
        : Promise.resolve(nextShare),
    );

    render(<SharedQuestionSetPage />);
    expect(screen.getByText("Opening shared set…")).toBeTruthy();
    window.history.replaceState(null, "", `#/shared?token=${NEXT_TOKEN}`);
    fireEvent(window, new Event("hashchange"));
    expect(await screen.findByRole("heading", { name: "Second shared set" })).toBeTruthy();

    await act(async () => { finishOld(); });
    expect(screen.getByRole("heading", { name: "Second shared set" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Synthetic shared set" })).toBeNull();
  });

  it("does not mark the next token imported when the previous token's save finishes late", async () => {
    let finishOldSave!: () => void;
    vi.mocked(resolveShare).mockImplementation(async (token) =>
      token === TOKEN ? { id: SHARE_ID, snapshot, contentDigest: DIGEST } : nextShare,
    );
    mocks.commit.mockImplementationOnce(() => new Promise((resolve) => {
      finishOldSave = () => resolve({
        ok: true, questionSetId: "first-local-set", questionIds: ["first-local-question"],
        added: 1, reused: 0, alreadyImported: false,
      });
    }));
    mocks.commit.mockResolvedValue({
      ok: true, questionSetId: "second-local-set", questionIds: ["second-local-question"],
      added: 1, reused: 0, alreadyImported: false,
    });

    render(<SharedQuestionSetPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);

    window.history.replaceState(null, "", `#/shared?token=${NEXT_TOKEN}`);
    fireEvent(window, new Event("hashchange"));
    expect(await screen.findByRole("heading", { name: "Second shared set" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to my AXOM" })).toHaveProperty("disabled", false);
    await act(async () => { finishOldSave(); });
    expect(screen.getByRole("heading", { name: "Second shared set" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to my AXOM" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(2));
    expect(mocks.commit).toHaveBeenLastCalledWith(expect.objectContaining({
      snapshot: nextShare.snapshot,
      identity: { shareId: nextShare.id, contentDigest: nextShare.contentDigest },
    }));
  });

  it("removes an earlier share preview when navigating to an incomplete link", async () => {
    render(<SharedQuestionSetPage />);
    expect(await screen.findByRole("heading", { name: "Synthetic shared set" })).toBeTruthy();
    window.history.replaceState(null, "", "#/shared");
    fireEvent(window, new Event("hashchange"));
    expect(screen.getByRole("alert").textContent).toContain("incomplete");
    expect(screen.queryByRole("button", { name: "Add to my AXOM" })).toBeNull();
    expect(screen.queryByText("Synthetic question?")).toBeNull();
  });

  it("stops a never-settling share preview and retries without accepting late old results", async () => {
    let finishOld!: () => void;
    let requests = 0;
    vi.mocked(resolveShare).mockImplementation(() => {
      requests += 1;
      if (requests === 1) {
        return new Promise<Awaited<ReturnType<typeof resolveShare>>>((resolve) => {
          finishOld = () => resolve({ id: SHARE_ID, snapshot, contentDigest: DIGEST });
        });
      }
      return Promise.resolve(nextShare);
    });

    render(<SharedQuestionSetPage />);
    expect(screen.getByText("Opening shared set…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop loading" }));
    expect(screen.getByText(/Shared set preview stopped/)).toBeTruthy();
    expect(screen.queryByText("Opening shared set…")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry opening" }));
    expect(await screen.findByRole("heading", { name: "Second shared set" })).toBeTruthy();
    expect(resolveShare).toHaveBeenCalledTimes(2);
    expect(vi.mocked(resolveShare).mock.calls[1]?.[0]).toBe(TOKEN);

    await act(async () => { finishOld(); });
    expect(screen.getByRole("heading", { name: "Second shared set" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Synthetic shared set" })).toBeNull();
  });

  it("provides a retry for transient link-resolution errors", async () => {
    vi.mocked(resolveShare)
      .mockRejectedValueOnce(new Error("Temporary network failure"))
      .mockResolvedValueOnce({ id: SHARE_ID, snapshot, contentDigest: DIGEST });

    render(<SharedQuestionSetPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("Temporary network failure");
    fireEvent.click(screen.getByRole("button", { name: "Retry opening" }));
    expect(await screen.findByRole("heading", { name: "Synthetic shared set" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(resolveShare).toHaveBeenCalledTimes(2);
  });


  it("never imports an old shared-set snapshot after silent History API token navigation", async () => {
    // App route commits use pushState/replaceState, neither emits hashchange.
    // An old mounted preview must not be imported under the new link URL.
    window.history.replaceState(null, "", `#/shared-set?token=${TOKEN}`);
    vi.mocked(resolveShare).mockImplementation(async (token) =>
      token === TOKEN ? { id: SHARE_ID, snapshot, contentDigest: DIGEST } : nextShare,
    );
    mocks.commit.mockResolvedValue({
      ok: true, questionSetId: "second-local-set", questionIds: ["second-local-question"],
      added: 1, reused: 0, alreadyImported: false,
    });

    render(<SharedQuestionSetPage />);
    expect(await screen.findByRole("heading", { name: "Synthetic shared set" })).toBeTruthy();

    window.history.pushState(null, "", `#/shared-set?token=${NEXT_TOKEN}`);
    // Deliberately no synthetic hashchange.
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    expect(mocks.commit).not.toHaveBeenCalled();

    expect(await screen.findByRole("heading", { name: "Second shared set" })).toBeTruthy();
    expect(vi.mocked(resolveShare).mock.calls.at(-1)?.[0]).toBe(NEXT_TOKEN);
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: nextShare.snapshot,
      identity: { shareId: nextShare.id, contentDigest: nextShare.contentDigest },
    })));
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });

  it("remounts a new shared-set route identity before showing or importing the new snapshot", async () => {
    window.history.replaceState(null, "", `#shared-set?token=${TOKEN}`);
    vi.mocked(resolveShare).mockImplementation(async (token) =>
      token === TOKEN ? { id: SHARE_ID, snapshot, contentDigest: DIGEST } : nextShare,
    );
    mocks.commit.mockResolvedValue({
      ok: true, questionSetId: "second-local-set", questionIds: ["second-local-question"],
      added: 1, reused: 0, alreadyImported: false,
    });

    const view = render(<SharedQuestionSetPage key={TOKEN} />);
    expect(await screen.findByRole("heading", { name: "Synthetic shared set" })).toBeTruthy();
    window.history.replaceState(null, "", `#shared-set?token=${NEXT_TOKEN}`);
    // This is the router's keyed child transition; history API sends no hashchange.
    view.rerender(<SharedQuestionSetPage key={NEXT_TOKEN} />);
    expect(await screen.findByRole("heading", { name: "Second shared set" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Synthetic shared set" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: nextShare.snapshot,
      identity: { shareId: nextShare.id, contentDigest: nextShare.contentDigest },
    })));
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });

  it("revokes a loaded preview across a batched A to B to A account switch", async () => {
    let finishReload!: () => void;
    vi.mocked(resolveShare)
      .mockResolvedValueOnce({ id: SHARE_ID, snapshot, contentDigest: DIGEST })
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishReload = () => resolve(nextShare);
      }));
    render(<SharedQuestionSetPage />);
    expect(await screen.findByRole("heading", { name: "Synthetic shared set" })).toBeTruthy();
    await act(async () => {
      switchAccount("account-2");
      switchAccount("account-1");
    });
    expect(screen.queryByRole("button", { name: "Add to my AXOM" })).toBeNull();
    expect(resolveShare).toHaveBeenCalledTimes(2);
    expect(mocks.commit).not.toHaveBeenCalled();
    await act(async () => { finishReload(); });
    expect(await screen.findByRole("heading", { name: "Second shared set" })).toBeTruthy();
  });

  it("fences an in-flight import against A to B to A session reuse", async () => {
    let finishSave!: () => void;
    mocks.commit.mockImplementationOnce(() => new Promise((resolve) => {
      finishSave = () => resolve({
        ok: true, questionSetId: "old-account-set", questionIds: ["old-question"],
        added: 1, reused: 0, alreadyImported: false,
      });
    }));
    render(<SharedQuestionSetPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    const payload = mocks.commit.mock.calls[0]?.[0];
    expect(payload.accountGuard.accountId).toBe("account-1");
    expect(payload.accountGuard.isCurrentAccount("account-1")).toBe(true);
    await act(async () => {
      switchAccount("account-2");
      switchAccount("account-1");
    });
    expect(payload.accountGuard.isCurrentAccount("account-1")).toBe(false);
    await act(async () => { finishSave(); });
    expect(screen.queryByRole("button", { name: "Already in this AXOM" })).toBeNull();
  });

  it("refuses an old account's import click before React commits the account switch", async () => {
    render(<SharedQuestionSetPage />);
    expect(await screen.findByRole("heading", { name: "Synthetic shared set" })).toBeTruthy();
    act(() => {
      switchAccount("account-2");
      fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("guards local guest imports without forbidding bearer-link access", async () => {
    switchAccount(null);
    let finishSave!: () => void;
    mocks.commit.mockImplementationOnce(() => new Promise((resolve) => {
      finishSave = () => resolve({
        ok: true, questionSetId: "guest-set", questionIds: ["guest-question"],
        added: 1, reused: 0, alreadyImported: false,
      });
    }));
    render(<SharedQuestionSetPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    const guard = mocks.commit.mock.calls[0]?.[0].accountGuard;
    expect(typeof guard.accountId).toBe("string");
    expect(guard.accountId.length).toBeGreaterThan(0);
    expect(guard.isCurrentAccount(guard.accountId)).toBe(true);
    act(() => { switchAccount("account-1"); });
    expect(guard.isCurrentAccount(guard.accountId)).toBe(false);
    await act(async () => { finishSave(); });
  });

  it("clears an obsolete imported badge after B's empty vault hydrates after share resolution", async () => {
    const previouslyImported: QuestionSet = {
      id: "A-imported-set",
      title: "Synthetic shared set",
      sourceDocumentIds: [], createdAt: NOW, questionIds: ["A-question"], tags: [],
      aiEnhanced: false, parserWarnings: [],
      importProvenance: { version: 1, shareId: SHARE_ID, contentDigest: DIGEST },
    };
    mocks.questionSets = [previouslyImported];
    render(<SharedQuestionSetPage />);
    expect(await screen.findByRole("button", { name: "Already in this AXOM" })).toHaveProperty("disabled", true);

    // Auth can switch to B before the asynchronously restored B vault arrives.
    await act(async () => { switchAccount("account-2"); });
    expect(await screen.findByRole("button", { name: "Already in this AXOM" })).toHaveProperty("disabled", true);
    await act(async () => { hydrateQuestionSets([]); });

    expect(await screen.findByRole("button", { name: "Add to my AXOM" })).toHaveProperty("disabled", false);
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Synthetic shared set" })).toBeTruthy();
  });

  it("recognizes B's imported set when vault hydration arrives after a fresh share preview", async () => {
    const bImported: QuestionSet = {
      id: "B-imported-set",
      title: "Synthetic shared set",
      sourceDocumentIds: [], createdAt: NOW, questionIds: ["B-question"], tags: [],
      aiEnhanced: false, parserWarnings: [],
      importProvenance: { version: 1, shareId: SHARE_ID, contentDigest: DIGEST },
    };
    mocks.questionSets = [];
    render(<SharedQuestionSetPage />);
    expect(await screen.findByRole("button", { name: "Add to my AXOM" })).toHaveProperty("disabled", false);
    await act(async () => { switchAccount("account-2"); });
    expect(await screen.findByRole("button", { name: "Add to my AXOM" })).toHaveProperty("disabled", false);

    await act(async () => { hydrateQuestionSets([bImported]); });
    expect(await screen.findByRole("button", { name: "Already in this AXOM" })).toHaveProperty("disabled", true);
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("holds imports when B signs in before its device workspace is linked", async () => {
    mocks.commit.mockResolvedValue({
      ok: true, questionSetId: "B-imported", questionIds: ["q1"],
      added: 1, reused: 0, alreadyImported: false,
    });
    render(<SharedQuestionSetPage />);
    expect(await screen.findByRole("button", { name: "Add to my AXOM" })).toHaveProperty("disabled", false);

    await act(async () => {
      switchAccount("account-2");
      mocks.accountLink = "linked-elsewhere";
      emitAccount();
    });
    const importButton = await screen.findByRole("button", { name: "Add to my AXOM" });
    expect(importButton).toHaveProperty("disabled", true);
    expect(screen.getByText(/Finish connecting your account workspace/)).toBeTruthy();
    fireEvent.click(importButton);
    expect(mocks.commit).not.toHaveBeenCalled();

    await act(async () => {
      mocks.accountLink = "linked";
      emitAccount();
    });
    expect(await screen.findByRole("button", { name: "Add to my AXOM" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    expect(mocks.commit.mock.calls[0][0].accountGuard.accountId).toBe("account-2");
  });

  it("blocks imports during active restore and revokes an in-flight import guard", async () => {
    let finishSave!: () => void;
    mocks.commit.mockImplementationOnce(() => new Promise((resolve) => {
      finishSave = () => resolve({
        ok: true, questionSetId: "saved", questionIds: ["q1"],
        added: 1, reused: 0, alreadyImported: false,
      });
    }));
    render(<SharedQuestionSetPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    const guard = mocks.commit.mock.calls[0][0].accountGuard;
    expect(guard.isCurrentAccount("account-1")).toBe(true);

    await act(async () => {
      mocks.accountBusy = true;
      mocks.accountApplyingRemote = true;
      emitAccount();
    });
    expect(guard.isCurrentAccount("account-1")).toBe(false);
    await act(async () => { finishSave(); });

    await act(async () => {
      mocks.accountBusy = false;
      mocks.accountApplyingRemote = false;
      mocks.accountRestoreOffer = true;
      emitAccount();
    });
    expect(screen.getByRole("button", { name: "Add to my AXOM" })).toHaveProperty("disabled", true);
    await act(async () => {
      mocks.accountRestoreOffer = false;
      emitAccount();
    });
    expect(screen.getByRole("button", { name: "Add to my AXOM" })).toHaveProperty("disabled", false);
  });

  it("does not treat an unresolved auth boot as a signed-out guest session", async () => {
    mocks.accountId = null;
    mocks.accountPhase = "loading";
    mocks.accountLink = "unlinked";
    mocks.commit.mockResolvedValue({
      ok: true, questionSetId: "guest-set", questionIds: ["q1"],
      added: 1, reused: 0, alreadyImported: false,
    });
    render(<SharedQuestionSetPage />);
    const button = await screen.findByRole("button", { name: "Add to my AXOM" });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(mocks.commit).not.toHaveBeenCalled();

    await act(async () => {
      mocks.accountPhase = "signed-out";
      emitAccount();
    });
    expect(screen.getByRole("button", { name: "Add to my AXOM" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "Add to my AXOM" }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    expect(mocks.commit.mock.calls[0][0].accountGuard.accountId).toBe("local-guest-session");
  });

});
