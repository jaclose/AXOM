// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadCommunity, loadProgressBoard, saveShareMode, searchCommunityProfiles,
  type CommunityPost, type CommunityProfile, type CommunitySnapshot,
} from "../lib/community/community";
import { loadOperatorReports, resolveReport, useOperatorAccessStatus, type OperatorRole } from "../lib/operator/hostClient";
import { resetCommunityShare, setCommunityShareMode } from "../lib/community/shareStore";
import { isoDate } from "../lib/scoring";
import { CommunityPage } from "./CommunityPage";

vi.mock("../lib/account/accountStore", () => {
  const state = { user: { id: "me", displayName: "Current learner" } };
  return { useAccount: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) };
});
vi.mock("../lib/store", () => ({
  useStore: (select: (state: { logs: []; questionSets: [] }) => unknown) => select({ logs: [], questionSets: [] }),
}));
vi.mock("../lib/operator/hostClient", () => ({
  useAccountIdentity: () => "me",
  useOperatorAccess: () => null,
  useOperatorAccessStatus: vi.fn(),
  refreshOperatorAccess: vi.fn(),
  loadOperatorReports: vi.fn(),
  resolveReport: vi.fn(),
}));
vi.mock("../lib/community/community", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/community/community")>(),
  loadCommunity: vi.fn(),
  loadProgressBoard: vi.fn(),
  saveShareMode: vi.fn(),
  searchCommunityProfiles: vi.fn(),
}));

const profile = (user_id: string, handle: string, discoverable = true): CommunityProfile => ({
  user_id, handle, display_name: handle, bio: "", discoverable,
});
const snapshot = (patch: Partial<CommunitySnapshot> = {}): CommunitySnapshot => ({
  profiles: [profile("me", "zzz_owner", false)], connections: [], posts: [], reactions: [], ...patch,
});
const progress = (id: string, user_id: string, visibility: CommunityPost["visibility"], minutes: number, questions = 0): CommunityPost => ({
  id, user_id, kind: "progress", visibility, activity_day: isoDate(new Date()), minutes, cards: 0, questions,
  set_title: null, caption: "", created_at: new Date().toISOString(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function operator(role: OperatorRole | null) {
  vi.mocked(useOperatorAccessStatus).mockReturnValue({ role, state: role ? "verified" : "denied", retry: () => {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCommunityShare();
  operator(null);
  vi.mocked(loadProgressBoard).mockResolvedValue({ me: profile("me", "zzz_owner", false), friendIds: [], profiles: [], posts: [] });
});
afterEach(cleanup);

describe("Community directory and owner profile", () => {
  it("keeps privacy controls for an owner beyond the first 100 handles and a friend-list overflow", async () => {
    const firstHundred = Array.from({ length: 100 }, (_, index) => profile(`user-${index}`, `a${String(index).padStart(3, "0")}`));
    vi.mocked(loadCommunity).mockResolvedValue(snapshot({
      profiles: [...firstHundred, profile("me", "zzz_owner", false)],
      connectionsError: "Your friend list is too large to show safely.",
    }));
    vi.mocked(loadProgressBoard).mockResolvedValue({ me: profile("me", "zzz_owner", false), friendIds: [], profiles: [], posts: [],
      connectionsError: "Friend connections could not be loaded. Refresh before comparing friends." });
    render(<CommunityPage />);
    expect(await screen.findByRole("heading", { name: "Your privacy" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Join Community" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show me" })).toBeTruthy();
    expect(screen.getAllByRole("alert").some(alert => alert.textContent?.includes("Your profile and privacy controls remain available."))).toBe(true);
    expect(await screen.findByText("Friend connections could not be loaded. Refresh before comparing friends.")).toBeTruthy();
  });

  it("finds a learner beyond the initial directory through server search", async () => {
    const user = userEvent.setup();
    const older = deferred<CommunityProfile[]>();
    vi.mocked(loadCommunity).mockResolvedValue(snapshot());
    vi.mocked(searchCommunityProfiles).mockReturnValue(older.promise);
    render(<CommunityPage />);
    const input = await screen.findByRole("searchbox", { name: "Find someone" });
    await user.type(input, "older");
    await waitFor(() => expect(searchCommunityProfiles).toHaveBeenCalledWith("me", "older"));
    expect(screen.getByText("Searching discoverable learners…")).toBeTruthy();
    await act(async () => { older.resolve([profile("older", "older_learner")]); });
    expect(screen.getByText("@older_learner")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("keeps an existing hidden friend searchable without making that profile public", async () => {
    const user = userEvent.setup();
    vi.mocked(loadCommunity).mockResolvedValue(snapshot({
      profiles: [profile("me", "owner", false), profile("friend", "hidden_friend", false)],
      connections: [{ id: "friendship", requester_id: "me", addressee_id: "friend", status: "accepted" }],
    }));
    vi.mocked(searchCommunityProfiles).mockResolvedValue([]);
    render(<CommunityPage />);
    const input = await screen.findByRole("searchbox", { name: "Find someone" });
    await user.type(input, "hidden_friend");
    await waitFor(() => expect(searchCommunityProfiles).toHaveBeenCalledWith("me", "hidden_friend"));
    expect(screen.getByText("@hidden_friend")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Friends · remove" })).toBeTruthy();
  });

  it("ignores an old response and offers retry when the current search fails", async () => {
    const user = userEvent.setup();
    const first = deferred<CommunityProfile[]>();
    vi.mocked(loadCommunity).mockResolvedValue(snapshot());
    vi.mocked(searchCommunityProfiles).mockImplementation((_id, query) =>
      query === "first" ? first.promise : Promise.reject(new Error("Connection lost")));
    render(<CommunityPage />);
    const input = await screen.findByRole("searchbox", { name: "Find someone" });
    await user.type(input, "first");
    await waitFor(() => expect(searchCommunityProfiles).toHaveBeenCalledWith("me", "first"));
    await user.clear(input);
    await user.type(input, "second");
    await act(async () => { first.resolve([profile("first", "stale_learner")]); });
    expect(screen.queryByText("@stale_learner")).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain("Connection lost");
    await user.click(screen.getByRole("button", { name: "Retry search" }));
    await waitFor(() => expect(searchCommunityProfiles).toHaveBeenCalledTimes(3));
  });
});

describe("Shared progress and moderation", () => {
  it("ranks shared study among friends, then across Community", async () => {
    const user = userEvent.setup();
    vi.mocked(loadCommunity).mockResolvedValue(snapshot());
    vi.mocked(loadProgressBoard).mockResolvedValue({
      me: profile("me", "zzz_owner", false), friendIds: ["friend"],
      profiles: [profile("me", "zzz_owner", false), profile("friend", "study_buddy"), profile("stranger", "far_away")],
      posts: [progress("p1", "me", "friends", 50, 12), progress("p2", "friend", "friends", 120, 40), progress("p3", "stranger", "community", 300, 90)],
    });
    render(<CommunityPage />);
    const board = await screen.findByRole("list", { name: /Friends leaderboard by study time/ });
    const rows = within(board).getAllByRole("listitem");
    expect(rows.map(row => within(row).getByText(/^(study_buddy|You|far_away)$/).textContent)).toEqual(["study_buddy", "You"]);
    expect(screen.getByText("You: #2 of 2")).toBeTruthy();
    await user.click(within(screen.getByRole("group", { name: "Who to compare" })).getByRole("button", { name: "Community" }));
    const community = await screen.findByRole("list", { name: /Community leaderboard by study time/ });
    expect(within(community).getAllByRole("listitem")).toHaveLength(1);
    expect(within(community).getByText("far_away")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Questions" }));
    expect(await screen.findByRole("list", { name: /Community leaderboard by questions/ })).toBeTruthy();
  });

  it("saves the automatic sharing choice on the account", async () => {
    const user = userEvent.setup();
    vi.mocked(loadCommunity).mockResolvedValue(snapshot());
    vi.mocked(saveShareMode).mockResolvedValue();
    setCommunityShareMode("me", "off");
    render(<CommunityPage />);
    const choices = await screen.findByRole("group", { name: "Automatic sharing" });
    expect(within(choices).getByRole("button", { name: /^Off/ }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(choices).getByRole("button", { name: /^Friends/ }));
    await waitFor(() => expect(saveShareMode).toHaveBeenCalledWith("me", "friends"));
    await waitFor(() => expect(within(choices).getByRole("button", { name: /^Friends/ }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("shows reported posts to a moderator and requires a reason before deciding", async () => {
    const user = userEvent.setup();
    operator("moderator");
    vi.mocked(loadCommunity).mockResolvedValue(snapshot());
    vi.mocked(loadOperatorReports).mockResolvedValueOnce([{ post_id: "post-1", author_handle: "loud_learner", post_kind: "progress",
      reason: "spam", note: "", reports: 2, latest_at: new Date().toISOString() }]).mockResolvedValue([]);
    vi.mocked(resolveReport).mockResolvedValue();
    render(<CommunityPage />);
    expect(await screen.findByRole("heading", { name: "Reported posts" })).toBeTruthy();
    expect(screen.getByText(/Moderator review/)).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Keep post" }));
    expect(resolveReport).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: "Reason for your decision" }), "Totals look ordinary");
    await user.click(screen.getByRole("button", { name: "Keep post" }));
    await waitFor(() => expect(resolveReport).toHaveBeenCalledWith("me", "post-1", "dismiss", "Totals look ordinary"));
    expect(await screen.findByText("No open reports. Private posts never enter this queue.")).toBeTruthy();
  });

  it("hides the reports panel from members", async () => {
    vi.mocked(loadCommunity).mockResolvedValue(snapshot());
    render(<CommunityPage />);
    expect(await screen.findByRole("heading", { name: "Your privacy" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Reported posts" })).toBeNull();
    expect(loadOperatorReports).not.toHaveBeenCalled();
  });
});
