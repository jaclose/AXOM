// @vitest-environment jsdom
import { Profiler } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOperatorDashboard, resolveReport, searchOperatorAccounts, setOperatorAI, setOperatorRole, type OperatorAccount, type OperatorDashboard } from "../lib/operator/hostClient";
import { HostPage } from "./HostPage";

const accountIdentity = vi.hoisted(() => ({ current: "verified-account", userId: "verified-account" }));
const hostLayoutCapture = vi.hoisted(() => ({ active: false, screens: [] as string[] }));

vi.mock("../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: accountIdentity.userId } }),
}));
vi.mock("../lib/operator/hostClient", () => ({
  useAccountIdentity: () => accountIdentity.current,
  loadOperatorDashboard: vi.fn(),
  searchOperatorAccounts: vi.fn(),
  resolveReport: vi.fn(),
  setOperatorAI: vi.fn(),
  setOperatorRole: vi.fn(),
}));
vi.mock("../components/questions/QuestionSetLibraryReviewQueue", async () => {
  const { useState } = await import("react");
  return {
    QuestionSetLibraryReviewQueue: ({ refreshSignal, onReviewed }: { refreshSignal?: number; onReviewed?: () => void }) => {
      const [receipt, setReceipt] = useState("");
      return <section data-testid="host-question-set-review" data-refresh={String(refreshSignal ?? 0)}>
        <button type="button" onClick={() => {
          setReceipt("Question Set approved for search.");
          onReviewed?.();
        }}>Complete synthetic Question Set review</button>
        {receipt && <p role="status">{receipt}</p>}
      </section>;
    },
  };
});
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

function hostBanner() {
  const banner = screen.getByRole("main", { name: "Host dashboard" }).querySelector(".host-banner");
  expect(banner).not.toBeNull();
  return within(banner as HTMLElement);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  accountIdentity.current = "verified-account";
  accountIdentity.userId = "verified-account";
  hostLayoutCapture.active = false; hostLayoutCapture.screens = [];
  vi.clearAllMocks();
  vi.mocked(resolveReport).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("Host page authorization and moderation", () => {
  it("never renders an old owner directory during the layout phase of a same-account role recheck", async () => {
    const user = userEvent.setup();
    const newRole = deferred<OperatorDashboard>();
    const ownerSnapshot = { ...dashboard("owner"), accounts: [account("owner-private", "PRIVATE DIRECTORY ENTRY")] };
    vi.mocked(loadOperatorDashboard).mockResolvedValueOnce(ownerSnapshot).mockReturnValueOnce(newRole.promise);
    // The Profiler stays mounted when Host unmounts its privileged children during
    // reauthorization. A layout effect inside CommunityUploads would miss that commit.
    hostLayoutCapture.active = true;
    render(<Profiler id="host-authorization" onRender={() => {
      if (hostLayoutCapture.active) hostLayoutCapture.screens.push(document.body.textContent ?? "");
    }}><HostPage /></Profiler>);
    expect(await screen.findByText("PRIVATE DIRECTORY ENTRY")).toBeTruthy();
    // Positive control: demonstrate this observer sees the authorized owner DOM.
    expect(hostLayoutCapture.screens.some(snapshot => snapshot.includes("PRIVATE DIRECTORY ENTRY"))).toBe(true);

    hostLayoutCapture.screens = [];
    await user.click(screen.getByRole("button", { name: /^Refresh$/ }));
    // A nonempty refresh-commit sample is mandatory; an empty array cannot pass privacy.
    expect(hostLayoutCapture.screens.length).toBeGreaterThan(0);
    expect(hostLayoutCapture.screens.some(snapshot => snapshot.includes("PRIVATE DIRECTORY ENTRY"))).toBe(false);
    expect(screen.queryByText("PRIVATE DIRECTORY ENTRY")).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply AI policy" })).toBeNull();

    await act(async () => { newRole.resolve(dashboard("moderator")); });
    await waitFor(() => expect(hostBanner().getByText("Moderator")).toBeTruthy());
    expect(screen.queryByText("PRIVATE DIRECTORY ENTRY")).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "Find account" })).toBeNull();
  });


  it("rejects a stale moderation click in the same event batch as an authorization refresh", async () => {
    const newRole = deferred<OperatorDashboard>();
    vi.mocked(loadOperatorDashboard)
      .mockResolvedValue(dashboard("moderator"))
      .mockResolvedValueOnce(dashboard("owner"))
      .mockReturnValueOnce(newRole.promise);
    render(<HostPage />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss report" });
    fireEvent.change(screen.getByRole("textbox", { name: /Reason for resolving @learner's report/i }), {
      target: { value: "Verified against the report evidence." },
    });
    expect((dismiss as HTMLButtonElement).disabled).toBe(false);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));
      // This old control has not yet been detached by React's batched commit.
      fireEvent.click(dismiss);
    });
    expect(resolveReport).not.toHaveBeenCalled();
    await act(async () => { newRole.resolve(dashboard("moderator")); });
    expect(screen.queryByRole("searchbox", { name: "Find account" })).toBeNull();
  });

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

  it("remounts Host without A-only controls or pending A search results after switching to B", async () => {
    const user = userEvent.setup();
    const oldSearch = deferred<OperatorAccount[]>();
    const ownerDashboard = { ...dashboard("owner"), accounts: [account("a-private", "A-only account")] };
    vi.mocked(loadOperatorDashboard).mockImplementation(id =>
      Promise.resolve(id === "verified-account" ? ownerDashboard : dashboard("moderator")));
    vi.mocked(searchOperatorAccounts).mockReturnValue(oldSearch.promise);

    const { rerender } = render(<HostPage />);
    expect(await screen.findByText("A-only account")).toBeTruthy();
    await user.type(screen.getByRole("searchbox", { name: "Find account" }), "private");
    await waitFor(() => expect(searchOperatorAccounts).toHaveBeenCalledWith("verified-account", "private"));

    accountIdentity.current = "second-account";
    accountIdentity.userId = "second-account";
    rerender(<HostPage />);
    expect(screen.queryByText("A-only account")).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply AI policy" })).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "Find account" })).toBeNull();

    await act(async () => { oldSearch.resolve([account("a-late", "Late A search result")]); });
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledWith("second-account"));
    expect(screen.queryByText("Late A search result")).toBeNull();
    expect(hostBanner().queryByText("Project CEO")).toBeNull();
    await waitFor(() => expect(hostBanner().getByText("Moderator")).toBeTruthy());
  });

  it("ignores A's late privileged dashboard response after verified identity switches to B", async () => {
    const oldRead = deferred<OperatorDashboard>();
    const newRead = deferred<OperatorDashboard>();
    vi.mocked(loadOperatorDashboard).mockImplementation(id =>
      id === "verified-account" ? oldRead.promise : newRead.promise);

    const { rerender } = render(<HostPage />);
    accountIdentity.current = "second-account";
    accountIdentity.userId = "second-account";
    rerender(<HostPage />);
    await act(async () => {
      oldRead.resolve({ ...dashboard("owner"), accounts: [account("a-private", "A-only account")] });
    });
    expect(hostBanner().queryByText("Project CEO")).toBeNull();
    expect(screen.queryByText("A-only account")).toBeNull();

    await act(async () => { newRead.resolve(dashboard("moderator")); });
    expect(screen.getByRole("heading", { name: "Host dashboard" })).toBeTruthy();
    expect(hostBanner().queryByText("Project CEO")).toBeNull();
    expect(hostBanner().getByText("Moderator")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply AI policy" })).toBeNull();
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
    vi.mocked(loadOperatorDashboard).mockResolvedValueOnce(dashboard("moderator"))
      .mockResolvedValue({ ...dashboard("moderator"), reports: [] });
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

  it("does not reinterpret a cleared daily AI cap as an explicit zero quota", async () => {
    const user = userEvent.setup();
    const target = account("target-account", "Target learner");
    vi.mocked(loadOperatorDashboard).mockResolvedValue({
      ...dashboard("owner"), accounts: [target],
    });
    vi.mocked(setOperatorAI).mockResolvedValue(undefined);
    render(<HostPage />);
    await screen.findByText("Target learner");

    const cap = screen.getByRole("spinbutton", { name: "Daily AI request cap" });
    const apply = screen.getByRole("button", { name: "Apply AI policy" }) as HTMLButtonElement;
    await user.type(screen.getByRole("textbox", { name: /Reason for changing Target learner/ }),
      "Reviewed intentional AI request cap adjustment");

    // The operator is still editing. An empty HTML number field is not an
    // instruction to replace the existing nonzero cap with zero.
    await user.clear(cap);
    expect((cap as HTMLInputElement).value).toBe("");
    expect(apply.disabled).toBe(true);
    await user.click(apply);
    expect(setOperatorAI).not.toHaveBeenCalled();

    // Entering a literal 0 is a deliberate, permitted disablement with audit.
    await user.type(cap, "0");
    expect((cap as HTMLInputElement).value).toBe("0");
    expect(apply.disabled).toBe(false);
    await user.click(apply);
    expect(setOperatorAI).toHaveBeenCalledWith(
      "verified-account", "target-account", true, 0, "Reviewed intentional AI request cap adjustment",
    );
  });

  it("requires a new role-specific audit receipt and matching account state before reporting success", async () => {
    const user = userEvent.setup();
    const target = account("target-account", "Target learner");
    const initial = { ...dashboard("owner"), accounts: [target] };
    const updated = {
      ...dashboard("owner"), accounts: [{ ...target, role: "moderator" as const }],
      audit: [{
        id: "synthetic-new-audit", actor_id: "verified-account", target_id: target.user_id,
        action: "account.role", metadata: { assigned: "moderator", reason: "Reviewed requested role change" },
        created_at: "2026-11-12T00:00:00.000Z",
      }],
    };
    vi.mocked(loadOperatorDashboard)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ...initial, accounts: [{ ...target, role: "moderator" as const }] })
      .mockResolvedValue(updated);
    vi.mocked(setOperatorRole).mockResolvedValue(undefined);
    render(<HostPage />);
    await screen.findByText("Target learner");
    await user.selectOptions(screen.getByRole("combobox", { name: "Role" }), "moderator");
    await user.type(screen.getByRole("textbox", { name: /Reason for changing Target learner/ }), "Reviewed requested role change");
    await user.click(screen.getByRole("button", { name: "Apply role" }));
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Role updated and audited.")).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain("did not confirm");
    await user.click(screen.getByRole("button", { name: "Retry Host" }));
    expect(await screen.findByText("Role updated and audited.")).toBeTruthy();
    expect(setOperatorRole).toHaveBeenCalledTimes(1);
  });

  it("holds a successful transport response when the Host readback contradicts the requested report resolution", async () => {
    const user = userEvent.setup();
    vi.mocked(loadOperatorDashboard)
      .mockResolvedValueOnce(dashboard("moderator"))
      .mockResolvedValueOnce(dashboard("moderator"))
      .mockResolvedValue({ ...dashboard("moderator"), reports: [] });
    vi.mocked(resolveReport).mockResolvedValue(undefined);
    render(<HostPage />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss report" });
    await user.type(screen.getByRole("textbox", { name: /Reason for resolving @learner's report/ }), "Documented false report");
    await user.click(dismiss);
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Report dismissed and audited.")).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain("did not confirm");
    expect((screen.getByRole("button", { name: "Dismiss report" }) as HTMLButtonElement).disabled).toBe(true);
    expect(resolveReport).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Retry Host" }));
    expect(await screen.findByText("Report dismissed and audited.")).toBeTruthy();
    expect(resolveReport).toHaveBeenCalledTimes(1);
  });

  it("holds an ambiguous failed write through readback failure until explicit successful verification", async () => {
    const user = userEvent.setup();
    vi.mocked(loadOperatorDashboard)
      .mockResolvedValueOnce(dashboard("moderator"))
      .mockRejectedValueOnce(new Error("Readback offline"))
      .mockResolvedValueOnce(dashboard("moderator"))
      .mockResolvedValue({ ...dashboard("moderator"), reports: [] });
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
    vi.mocked(loadOperatorDashboard).mockResolvedValueOnce(dashboard("moderator"))
      .mockResolvedValueOnce(dashboard("moderator"))
      .mockResolvedValue({ ...dashboard("moderator"), reports: [] });
    vi.mocked(resolveReport)
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce(undefined);
    render(<HostPage />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss report" });
    await user.type(screen.getByRole("textbox", { name: /Reason for resolving @learner's report/ }), "Documented false report");
    await user.click(dismiss);
    expect((await screen.findByRole("alert")).textContent).toContain("Connection lost");
    // The verified refresh replaces the old controls, so retry on the current snapshot.
    await user.click(await screen.findByRole("button", { name: "Dismiss report" }));
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
    expect(await screen.findByText("Academic course review recorded. Checking Host queues.")).toBeTruthy();
    // Review callbacks must use the same version generator as manual Host refresh.
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(3));
  });

  it("preserves the current account's Question Set review receipt across Host refresh, but not an identity switch", async () => {
    const user = userEvent.setup();
    const refreshRead = deferred<OperatorDashboard>();
    vi.mocked(loadOperatorDashboard)
      .mockResolvedValueOnce(dashboard("owner"))
      .mockReturnValueOnce(refreshRead.promise)
      .mockResolvedValue(dashboard("moderator"));
    const view = render(<HostPage />);
    await screen.findByRole("heading", { name: "Attention queue" });
    const queue = screen.getByTestId("host-question-set-review");
    await user.click(within(queue).getByRole("button", { name: "Complete synthetic Question Set review" }));
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(2));
    // A valid child receipt must not be erased by an unrelated Host snapshot refresh.
    expect(screen.getByText("Question Set approved for search.")).toBeTruthy();
    expect(screen.getByText("Question Set review recorded. Checking Host queues.")).toBeTruthy();
    await act(async () => { refreshRead.resolve(dashboard("owner")); });
    expect(screen.getByText("Question Set approved for search.")).toBeTruthy();

    // A real identity epoch change is different: the old account's receipt must disappear.
    accountIdentity.current = "different-account";
    accountIdentity.userId = "different-account";
    view.rerender(<HostPage />);
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledWith("different-account"));
    expect(screen.queryByText("Question Set approved for search.")).toBeNull();
    await waitFor(() => expect(hostBanner().getByText("Moderator")).toBeTruthy());
  });

  it("discards another account's review receipt even if the Host identity epoch lags", async () => {
    const user = userEvent.setup();
    vi.mocked(loadOperatorDashboard).mockResolvedValue(dashboard("owner"));
    const view = render(<HostPage />);
    await screen.findByRole("heading", { name: "Attention queue" });
    await user.click(within(screen.getByTestId("host-question-set-review"))
      .getByRole("button", { name: "Complete synthetic Question Set review" }));
    expect(await screen.findByText("Question Set approved for search.")).toBeTruthy();

    // Account ID can update before the identity epoch subscription settles.
    // The queue must be scoped to the actual ID, not just the parent refresh lifecycle.
    accountIdentity.userId = "another-account";
    view.rerender(<HostPage />);
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledWith("another-account"));
    expect(screen.queryByText("Question Set approved for search.")).toBeNull();
    expect(screen.getByTestId("host-question-set-review")).toBeTruthy();
  });

  it("withholds the Question Set queue until the current account is verified as a Host operator", async () => {
    const pending = deferred<OperatorDashboard>();
    vi.mocked(loadOperatorDashboard).mockReturnValue(pending.promise);
    render(<HostPage />);
    expect(screen.queryByTestId("host-question-set-review")).toBeNull();
    await act(async () => { pending.resolve({ ...dashboard("moderator"), role: null, overview: null }); });
    await screen.findByRole("heading", { name: "Operator permission required" });
    expect(screen.queryByTestId("host-question-set-review")).toBeNull();
  });

  it("unmounts the review receipt when the current account loses Host authorization", async () => {
    const user = userEvent.setup();
    const refreshRead = deferred<OperatorDashboard>();
    vi.mocked(loadOperatorDashboard)
      .mockResolvedValueOnce(dashboard("owner"))
      .mockReturnValueOnce(refreshRead.promise);
    render(<HostPage />);
    await screen.findByRole("heading", { name: "Attention queue" });
    await user.click(within(screen.getByTestId("host-question-set-review"))
      .getByRole("button", { name: "Complete synthetic Question Set review" }));
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Question Set approved for search.")).toBeTruthy();
    await act(async () => { refreshRead.resolve({ ...dashboard("moderator"), role: null, overview: null }); });
    await screen.findByRole("heading", { name: "Operator permission required" });
    expect(screen.queryByTestId("host-question-set-review")).toBeNull();
    expect(screen.queryByText("Question Set approved for search.")).toBeNull();
  });

  it("refreshes standalone Question Set reviewer permissions from Host and Host after a completed decision", async () => {
    const user = userEvent.setup();
    vi.mocked(loadOperatorDashboard).mockResolvedValue(dashboard("owner"));
    render(<HostPage />);
    await screen.findByRole("heading", { name: "Attention queue" });
    const reviewQueue = () => screen.getByTestId("host-question-set-review");
    expect(reviewQueue().getAttribute("data-refresh")).toBe("0");
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(reviewQueue().getAttribute("data-refresh")).toBe("1"));
    await user.click(within(reviewQueue()).getByRole("button", { name: "Complete synthetic Question Set review" }));
    await waitFor(() => expect(loadOperatorDashboard).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("Question Set review recorded. Checking Host queues.")).toBeTruthy();
    await waitFor(() => expect(reviewQueue().getAttribute("data-refresh")).toBe("2"));
  });

});
