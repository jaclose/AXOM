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
vi.mock("../components/questions/CommunityUploads", () => ({
  CommunityUploads: ({ reviewOnly, onReviewed }: { reviewOnly?: boolean; onReviewed?: () => void }) =>
    <section data-testid="host-community-review" data-review-only={String(reviewOnly)}>
      <button type="button" onClick={onReviewed}>Complete synthetic academic review</button>
    </section>,
}));
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
  it("mounts a review-only academic course queue and refreshes Host after a verified decision", async () => {
    const user = userEvent.setup();
    vi.mocked(loadOperatorDashboard).mockResolvedValue({
      ...dashboard("owner"),
      queue: [{
        collection_id: "11111111-1111-4111-8111-111111111111",
        title: "Synthetic pending course", module: "NCRS", term: "Term 4",
        owner_id: "student", visibility: "shared", ready_questions: 8,
        review_questions: 2, updated_at: "2026-11-11T00:00:00Z",
      }],
    });
    render(<HostPage />);
    const review = await screen.findByTestId("host-community-review");
    expect(review.getAttribute("data-review-only")).toBe("true");
    expect(screen.queryByText("Share a course")).toBeNull();
    await user.click(within(review).getByRole("button", { name: "Complete synthetic academic review" }));
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(2));
  });

});
