// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOperatorDashboard, resolveReport, searchOperatorAccounts, type OperatorAccount, type OperatorDashboard } from "../lib/operator/hostClient";
import { HostPage } from "./HostPage";

vi.mock("../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: "verified-account" } }),
}));
vi.mock("../lib/operator/hostClient", () => ({
  useAccountIdentity: () => "verified-account",
  loadOperatorDashboard: vi.fn(),
  searchOperatorAccounts: vi.fn(),
  resolveReport: vi.fn(),
  setOperatorAI: vi.fn(),
  setOperatorRole: vi.fn(),
}));
vi.mock("../components/questions/QuestionSetLibraryReviewQueue", () => ({ QuestionSetLibraryReviewQueue: () => null }));
vi.mock("../components/dashboard/JournalFeedbackReview", () => ({ JournalFeedbackReview: () => null }));

const dashboard = (role: "owner" | "moderator"): OperatorDashboard => ({
  role,
  overview: {
    role, registered_accounts: role === "owner" ? 3 : null, shared_profiles: 0,
    shared_posts: 0, reports_pending: 1, academic_review_pending: 0,
    academic_approved: 0, ai_requests_7d: role === "owner" ? 0 : null,
  },
  accounts: [], queue: [], audit: [],
  reports: [{
    post_id: "post-id", author_handle: "learner", post_kind: "progress",
    reason: "spam", note: "Please review", reports: 1,
    latest_at: "2026-11-02T00:00:00Z",
  }],
});

const account = (id: string, name: string): OperatorAccount => ({
  user_id: id, email: `${id}@example.invalid`, display_name: name, role: null,
  created_at: "2026-11-01T00:00:00Z", last_sign_in_at: null,
  ai_enabled: true, ai_daily_limit: 60, ai_used_today: 0,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveReport).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("Host page authorization and moderation", () => {
  it("finds an older account through server search and restores the recent view when cleared", async () => {
    const user = userEvent.setup();
    const older = deferred<OperatorAccount[]>();
    const recentAccounts = Array.from({ length: 100 }, (_, index) =>
      account(`recent-${index}`, index === 0 ? "Recent student" : `Recent student ${index}`));
    vi.mocked(loadOperatorDashboard).mockResolvedValue({ ...dashboard("owner"), accounts: recentAccounts });
    vi.mocked(searchOperatorAccounts).mockReturnValue(older.promise);
    render(<HostPage />);
    const input = await screen.findByRole("searchbox", { name: "Find account" });
    expect(screen.getByText("Recent student")).toBeTruthy();
    await user.type(input, "older");
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("Searching all accounts");
    await waitFor(() => expect(searchOperatorAccounts).toHaveBeenCalledWith("verified-account", "older"));
    await act(async () => { older.resolve([account("older", "Older student")]); });
    expect(screen.getByText("Older student")).toBeTruthy();
    expect(screen.queryByText("Recent student")).toBeNull();
    await user.clear(input);
    expect(screen.getByText("Recent student")).toBeTruthy();
  });

  it("ignores a stale search response and offers retry for a failed current query", async () => {
    const user = userEvent.setup();
    const first = deferred<OperatorAccount[]>();
    vi.mocked(loadOperatorDashboard).mockResolvedValue(dashboard("owner"));
    vi.mocked(searchOperatorAccounts).mockImplementation((_id, query) => query === "first" ? first.promise : Promise.reject(new Error("Connection lost")));
    render(<HostPage />);
    const input = await screen.findByRole("searchbox", { name: "Find account" });
    await user.type(input, "first");
    await waitFor(() => expect(searchOperatorAccounts).toHaveBeenCalledWith("verified-account", "first"));
    await user.clear(input);
    await user.type(input, "second");
    await act(async () => { first.resolve([account("first", "Stale result")]); });
    expect(screen.queryByText("Stale result")).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain("Connection lost");
    await user.click(screen.getByRole("button", { name: "Retry search" }));
    await waitFor(() => expect(searchOperatorAccounts).toHaveBeenCalledTimes(3));
  });

  it("shows a clear empty state after a full-directory search finds no account", async () => {
    const user = userEvent.setup();
    vi.mocked(loadOperatorDashboard).mockResolvedValue({ ...dashboard("owner"), accounts: [account("recent", "Recent student")] });
    vi.mocked(searchOperatorAccounts).mockResolvedValue([]);
    render(<HostPage />);
    await user.type(await screen.findByRole("searchbox", { name: "Find account" }), "missing");
    expect(await screen.findByText("No accounts match that name or email.")).toBeTruthy();
    expect(screen.queryByText("Recent student")).toBeNull();
  });

  it("shows the Project CEO badge only after the role readback succeeds", async () => {
    let respond!: (value: OperatorDashboard) => void;
    vi.mocked(loadOperatorDashboard).mockReturnValue(new Promise(resolve => { respond = resolve; }));
    render(<HostPage />);
    expect(screen.getByRole("main", { name: "Host dashboard" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Host dashboard", level: 1 })).toBeTruthy();
    const banner = document.querySelector(".host-banner");
    expect(banner).not.toBeNull();
    expect(within(banner as HTMLElement).queryByText("Project CEO")).toBeNull();
    await act(async () => { respond(dashboard("owner")); });
    await waitFor(() => expect(within(banner as HTMLElement).getByText("Project CEO")).toBeTruthy());
    expect(screen.getByText("1 item in review and moderation queues.")).toBeTruthy();
  });

  it("keeps every overview count visible while separating the attention queue", async () => {
    const moderator = dashboard("moderator");
    vi.mocked(loadOperatorDashboard).mockResolvedValue({
      ...moderator,
      overview: { ...moderator.overview!, academic_review_pending: 2, shared_profiles: 4 },
    });
    render(<HostPage />);
    expect(await screen.findByRole("heading", { name: "Attention queue", level: 2 })).toBeTruthy();
    expect(screen.getByText("3 items in review and moderation queues.")).toBeTruthy();
    const overview = document.querySelector(".host-overview");
    expect(overview).not.toBeNull();
    for (const label of ["Review submissions", "Moderation reports", "Registered accounts", "Community profiles", "AI requests, 7 days", "Approved shared collections"]) {
      expect(within(overview as HTMLElement).getByText(label)).toBeTruthy();
    }
    expect(within(overview as HTMLElement).getAllByText("Restricted")).toHaveLength(2);
  });

  it("single-flights two privileged clicks in the same React event batch", async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    vi.mocked(loadOperatorDashboard).mockResolvedValue(dashboard("moderator"));
    vi.mocked(resolveReport).mockReturnValue(pending.promise);
    render(<HostPage />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss report" });
    await user.type(screen.getByRole("textbox", { name: /Reason for resolving @learner's report/ }), "Documented false report");
    // Both native events are delivered before React flushes its busy-state render.
    act(() => { dismiss.click(); dismiss.click(); });
    expect(resolveReport).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(); });
    expect(await screen.findByText("Report dismissed and audited.")).toBeTruthy();
  });

  it("does not prompt for a second destructive action while the first write is pending", async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(loadOperatorDashboard).mockResolvedValue(dashboard("moderator"));
    vi.mocked(resolveReport).mockReturnValue(pending.promise);
    render(<HostPage />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss report" });
    const remove = screen.getByRole("button", { name: "Remove post" });
    await user.type(screen.getByRole("textbox", { name: /Reason for resolving @learner's report/ }), "Documented false report");
    act(() => { dismiss.click(); remove.click(); });
    expect(resolveReport).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(); });
    confirm.mockRestore();
  });

  it("blocks the next privileged action until a fresh dashboard readback confirms the previous action", async () => {
    const user = userEvent.setup();
    const readback = deferred<OperatorDashboard>();
    vi.mocked(loadOperatorDashboard)
      .mockResolvedValueOnce(dashboard("moderator"))
      .mockReturnValueOnce(readback.promise);
    vi.mocked(resolveReport).mockResolvedValue(undefined);
    render(<HostPage />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss report" });
    await user.type(screen.getByRole("textbox", { name: /Reason for resolving @learner's report/ }), "Documented false report");
    await user.click(dismiss);
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(2));
    expect(resolveReport).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Report dismissed and audited.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss report" })).toBeNull();
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { readback.resolve({ ...dashboard("moderator"), reports: [] }); });
    expect(await screen.findByText("Report dismissed and audited.")).toBeTruthy();
    expect(resolveReport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Dismiss report" })).toBeNull();
  });

  it("holds an ambiguous failed write through readback failure until explicit successful verification", async () => {
    const user = userEvent.setup();
    vi.mocked(loadOperatorDashboard)
      .mockResolvedValueOnce(dashboard("moderator"))
      .mockRejectedValueOnce(new Error("Readback offline"))
      .mockResolvedValue(dashboard("moderator"));
    vi.mocked(resolveReport)
      .mockRejectedValueOnce(new Error("Lost acknowledgement"))
      .mockResolvedValue(undefined);
    render(<HostPage />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss report" });
    await user.type(screen.getByRole("textbox", { name: /Reason for resolving @learner's report/ }), "Documented false report");
    await user.click(dismiss);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Readback offline");
    expect(alert.textContent).toContain("may have been applied");
    expect(screen.queryByRole("button", { name: "Dismiss report" })).toBeNull();
    expect(resolveReport).toHaveBeenCalledTimes(1);
    const verify = screen.getByRole("button", { name: "Retry Host" }) as HTMLButtonElement;
    expect(verify.disabled).toBe(false);
    await user.click(verify);
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(3));
    expect((await screen.findByRole("alert")).textContent).toContain("Lost acknowledgement");
    expect(await screen.findByRole("button", { name: "Dismiss report" })).toBeTruthy();
    expect(resolveReport).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Dismiss report" }));
    await waitFor(() => expect(resolveReport).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Report dismissed and audited.")).toBeTruthy();
  });

  it("unlocks a failed privileged write so an operator can retry safely", async () => {
    const user = userEvent.setup();
    vi.mocked(loadOperatorDashboard).mockResolvedValue(dashboard("moderator"));
    vi.mocked(resolveReport)
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce(undefined);
    render(<HostPage />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss report" });
    await user.type(screen.getByRole("textbox", { name: /Reason for resolving @learner's report/ }), "Documented false report");
    await user.click(dismiss);
    expect((await screen.findByRole("alert")).textContent).toContain("Connection lost");
    await user.click(dismiss);
    await waitFor(() => expect(resolveReport).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Report dismissed and audited.")).toBeTruthy();
  });

  it("requires a reason before a moderator can dismiss a reported post", async () => {
    const user = userEvent.setup();
    vi.mocked(loadOperatorDashboard).mockResolvedValue(dashboard("moderator"));
    render(<HostPage />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss report" });
    expect((dismiss as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole("textbox", { name: /Reason for resolving @learner's report/ }), "Documented false report");
    expect((dismiss as HTMLButtonElement).disabled).toBe(false);
    await user.click(dismiss);
    await waitFor(() => expect(resolveReport).toHaveBeenCalledWith(
      "verified-account", "post-id", "dismiss", "Documented false report",
    ));
  });
});
