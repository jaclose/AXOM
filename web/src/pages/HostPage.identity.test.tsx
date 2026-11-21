// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadOperatorDashboard, searchOperatorAccounts,
  type OperatorAccount, type OperatorDashboard,
} from "../lib/operator/hostClient";
import { HostPage } from "./HostPage";

// Unlike HostPage.test.tsx, these tests do NOT mock useAccountIdentity or call
// rerender. The real Host subscription/epoch hook must react to store events.
const account = vi.hoisted(() => {
  type State = { user: { id: string } | null };
  let state: State = { user: { id: "account-a" } };
  const listeners = new Set<(next: State, previous: State) => void>();
  return {
    getState: () => state,
    subscribe: (listener: (next: State, previous: State) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    change: (userId: string | null) => {
      const previous = state;
      state = { user: userId ? { id: userId } : null };
      for (const listener of listeners) listener(state, previous);
    },
  };
});
vi.mock("../lib/account/accountStore", async () => {
  const { useSyncExternalStore } = await import("react");
  const useAccount = Object.assign(
    <T,>(select: (state: ReturnType<typeof account.getState>) => T) =>
      useSyncExternalStore(
        account.subscribe,
        () => select(account.getState()),
        () => select(account.getState()),
      ),
    { getState: account.getState, subscribe: account.subscribe },
  );
  return { useAccount };
});
vi.mock("../lib/account/supabase", () => ({ accountOperationClient: vi.fn() }));
vi.mock("../lib/operator/hostClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/operator/hostClient")>(),
  loadOperatorDashboard: vi.fn(),
  searchOperatorAccounts: vi.fn(),
}));
vi.mock("../components/questions/QuestionSetLibraryReviewQueue", async () => {
  const { useState } = await import("react");
  return {
    QuestionSetLibraryReviewQueue: ({ onReviewed }: { onReviewed?: () => void }) => {
      const [receipt, setReceipt] = useState("");
      return <section data-testid="identity-review-queue">
        <button onClick={() => { setReceipt("Account-bound review receipt"); onReviewed?.(); }}>
          Record synthetic review
        </button>
        {receipt && <p role="status">{receipt}</p>}
      </section>;
    },
  };
});
vi.mock("../components/questions/CommunityUploads", () => ({ CommunityUploads: () => null }));
vi.mock("../components/dashboard/JournalFeedbackReview", () => ({ JournalFeedbackReview: () => null }));

const ownerAccount: OperatorAccount = {
  user_id: "a-private", email: "a@example.invalid", display_name: "Account A private record",
  role: null, created_at: "2026-11-01T00:00:00Z", last_sign_in_at: null,
  ai_enabled: true, ai_daily_limit: 60, ai_used_today: 0,
};
function dashboard(role: "owner" | "moderator" | null): OperatorDashboard {
  return {
    role,
    overview: role === null ? null : {
      role, registered_accounts: role === "owner" ? 1 : null,
      shared_profiles: 0, shared_posts: 0, reports_pending: 0,
      academic_review_pending: 0, academic_approved: 0,
      ai_requests_7d: role === "owner" ? 0 : null,
    },
    accounts: role === "owner" ? [ownerAccount] : [],
    queue: [], reports: [], audit: [],
  };
}
function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function banner() {
  const element = document.querySelector(".host-banner");
  expect(element).not.toBeNull();
  return within(element as HTMLElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  account.change("account-a");
});
afterEach(() => {
  cleanup();
  account.change(null);
});

describe("Host real account identity subscription", () => {
  it("drops A's privileged search, controls and late response on an event-driven A to B switch", async () => {
    const user = userEvent.setup();
    const oldSearch = deferred<OperatorAccount[]>();
    vi.mocked(loadOperatorDashboard).mockImplementation(async id =>
      dashboard(id === "account-a" ? "owner" : "moderator"));
    vi.mocked(searchOperatorAccounts).mockReturnValue(oldSearch.promise);

    render(<HostPage />);
    expect(await screen.findByText("Account A private record")).toBeTruthy();
    await user.type(screen.getByRole("searchbox", { name: "Find account" }), "private");
    await waitFor(() => expect(searchOperatorAccounts).toHaveBeenCalledWith("account-a", "private"));

    act(() => account.change("account-b")); // No explicit rerender.
    expect(screen.queryByText("Account A private record")).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "Find account" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply AI policy" })).toBeNull();
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledWith("account-b"));
    await waitFor(() => expect(banner().getByText("Moderator")).toBeTruthy());

    await act(async () => { oldSearch.resolve([{ ...ownerAccount, display_name: "Late A search result" }]); });
    expect(screen.queryByText("Late A search result")).toBeNull();
    expect(banner().queryByText("Project CEO")).toBeNull();
  });

  it("ignores late first-A and B dashboards after A to B to A, with a fresh denied A read", async () => {
    const firstA = deferred<OperatorDashboard>();
    const middleB = deferred<OperatorDashboard>();
    const returnA = deferred<OperatorDashboard>();
    vi.mocked(loadOperatorDashboard)
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(middleB.promise)
      .mockReturnValueOnce(returnA.promise);

    render(<HostPage />);
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledWith("account-a"));
    act(() => account.change("account-b"));
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledWith("account-b"));
    act(() => account.change("account-a"));
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(3));

    await act(async () => {
      firstA.resolve(dashboard("owner"));
      middleB.resolve(dashboard("moderator"));
    });
    expect(banner().queryByText("Project CEO")).toBeNull();
    expect(screen.queryByText("Account A private record")).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply AI policy" })).toBeNull();

    await act(async () => { returnA.resolve(dashboard(null)); });
    expect(await screen.findByRole("heading", { name: "Operator permission required" })).toBeTruthy();
    expect(screen.queryByTestId("identity-review-queue")).toBeNull();
    expect(banner().queryByText("Project CEO")).toBeNull();
  });

  it("keeps the same-A review receipt across refresh, but never across an A to B to A epoch", async () => {
    const user = userEvent.setup();
    vi.mocked(loadOperatorDashboard).mockImplementation(async id =>
      dashboard(id === "account-a" ? "owner" : "moderator"));
    render(<HostPage />);
    const queue = await screen.findByTestId("identity-review-queue");
    await user.click(within(queue).getByRole("button", { name: "Record synthetic review" }));
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Account-bound review receipt")).toBeTruthy();

    act(() => account.change("account-b"));
    await waitFor(() => expect(banner().getByText("Moderator")).toBeTruthy());
    expect(screen.queryByText("Account-bound review receipt")).toBeNull();
    act(() => account.change("account-a"));
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(4));
    expect(await screen.findByTestId("identity-review-queue")).toBeTruthy();
    expect(screen.queryByText("Account-bound review receipt")).toBeNull();
  });
});
