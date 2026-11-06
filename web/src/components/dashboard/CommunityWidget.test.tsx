// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "../../lib/account/accountStore";
import type { CommunitySnapshot } from "../../lib/community/community";
import { useUi } from "../../lib/uiStore";
import { CommunityWidget } from "./CommunityWidget";

const load = vi.hoisted(() => vi.fn());
vi.mock("../../lib/community/community", () => ({ loadCommunity: load }));
const fields = new Set(["friends", "activity"]);
const user = (id: string) => ({ id, email: `${id}@example.test`, displayName: id, emailConfirmed: true });
const profile = (id: string) => ({ user_id: id, display_name: `Learner ${id}`, handle: `learner_${id}`, bio: "", discoverable: true });
const snapshot: CommunitySnapshot = {
  profiles: [profile("a"), profile("b"), profile("c")],
  connections: [{ id: "friend", requester_id: "a", addressee_id: "b", status: "accepted" }, { id: "request", requester_id: "c", addressee_id: "a", status: "pending" }],
  posts: [{ id: "post", user_id: "b", kind: "progress", visibility: "friends", activity_day: "2026-11-05", minutes: 30, cards: 10, questions: 5, set_title: null, caption: "", created_at: "2026-11-05T12:00:00Z" }],
  reactions: [],
};
beforeEach(() => {
  load.mockReset().mockResolvedValue(snapshot);
  useAccount.setState({ phase: "signed-in", user: user("a") });
  useUi.getState().clearSettingsRequest();
});
afterEach(cleanup);

describe("Community dashboard widget", () => {
  it("offers a sign-in action without fetching community data", () => {
    useAccount.setState({ phase: "signed-out", user: null });
    render(<CommunityWidget size="small" enabledFields={fields} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in to connect" }));
    expect(useUi.getState().settingsRequest).toBe("account");
    expect(load).not.toHaveBeenCalled();
  });

  it("shows accepted friends, incoming requests and shared activity with a Community destination", async () => {
    render(<CommunityWidget size="large" enabledFields={fields} />);
    expect(await screen.findByText("Learner b")).toBeTruthy();
    expect(screen.getByText("30 min · 5 questions · 10 cards")).toBeTruthy();
    expect(screen.getByRole("link", { name: /1 request/ }).getAttribute("href")).toBe("#communities");
    expect(screen.getByRole("link", { name: /Open Community/ }).getAttribute("href")).toBe("#communities");
  });

  it("clears the previous account's view immediately, ignoring a delayed response", async () => {
    let finish: (value: CommunitySnapshot) => void = () => undefined;
    load.mockReturnValueOnce(new Promise<CommunitySnapshot>(resolve => { finish = resolve; }));
    render(<CommunityWidget size="small" enabledFields={fields} />);
    await waitFor(() => expect(load).toHaveBeenCalledWith("a"));
    load.mockResolvedValue({ profiles: [], posts: [], connections: [], reactions: [] });
    act(() => useAccount.setState({ user: user("other") }));
    await act(async () => finish(snapshot));
    await waitFor(() => expect(load).toHaveBeenCalledWith("other"));
    expect(screen.queryByText("Learner b")).toBeNull();
    expect(screen.queryByText("30 min · 5 questions · 10 cards")).toBeNull();
  });

  it("removes stale activity on refresh failure and supports retry", async () => {
    render(<CommunityWidget size="small" enabledFields={fields} />);
    await screen.findByText("Learner b");
    load.mockRejectedValueOnce(new Error("Connection unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh community widget" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Connection unavailable");
    expect(screen.queryByText("Learner b")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry Community" }));
    expect(await screen.findByText("Learner b")).toBeTruthy();
  });

  it("honors hidden widget fields and never shows private posts", async () => {
    load.mockResolvedValue({ ...snapshot, posts: [{ ...snapshot.posts[0], visibility: "private" }] });
    render(<CommunityWidget size="small" enabledFields={new Set(["activity"])} />);
    await screen.findByText(/Your friends’ shared updates/);
    expect(screen.queryByText("Learner b")).toBeNull();
    expect(screen.queryByRole("link", { name: /1 request/ })).toBeNull();
  });
});
