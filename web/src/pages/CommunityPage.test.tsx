// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCommunity, searchCommunityProfiles, type CommunityProfile, type CommunitySnapshot } from "../lib/community/community";
import { CommunityPage } from "./CommunityPage";

vi.mock("../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string; displayName: string } }) => unknown) =>
    select({ user: { id: "me", displayName: "Current learner" } }),
}));
vi.mock("../lib/store", () => ({
  useStore: (select: (state: { logs: []; questionSets: [] }) => unknown) => select({ logs: [], questionSets: [] }),
}));
vi.mock("../lib/operator/hostClient", () => ({ useAccountIdentity: () => "me", operatorRole: async () => null }));
vi.mock("../lib/community/community", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/community/community")>(),
  loadCommunity: vi.fn(),
  searchCommunityProfiles: vi.fn(),
}));

const profile = (user_id: string, handle: string, discoverable = true): CommunityProfile => ({
  user_id, handle, display_name: handle, bio: "", discoverable,
});
const snapshot = (patch: Partial<CommunitySnapshot> = {}): CommunitySnapshot => ({
  profiles: [profile("me", "zzz_owner", false)], connections: [], posts: [], reactions: [], ...patch,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Community directory and owner profile", () => {
  it("keeps privacy controls for an owner beyond the first 100 handles and a friend-list overflow", async () => {
    const firstHundred = Array.from({ length: 100 }, (_, index) => profile(`user-${index}`, `a${String(index).padStart(3, "0")}`));
    vi.mocked(loadCommunity).mockResolvedValue(snapshot({
      profiles: [...firstHundred, profile("me", "zzz_owner", false)],
      connectionsError: "Your friend list is too large to show safely.",
    }));
    render(<CommunityPage />);
    expect(await screen.findByRole("heading", { name: "Your privacy" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Join Community" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show me" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Your profile and privacy controls remain available.");
    expect(screen.getByText("Friend standings are unavailable until your connections load.")).toBeTruthy();
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
