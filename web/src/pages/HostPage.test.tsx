// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOperatorDashboard, resolveReport, type OperatorDashboard } from "../lib/operator/hostClient";
import { HostPage } from "./HostPage";

vi.mock("../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: "verified-account" } }),
}));
vi.mock("../lib/operator/hostClient", () => ({
  useAccountIdentity: () => "verified-account",
  loadOperatorDashboard: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveReport).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("Host page authorization and moderation", () => {
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
