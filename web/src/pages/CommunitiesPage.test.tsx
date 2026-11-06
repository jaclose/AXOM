// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunitiesPage } from "./CommunitiesPage";

const mocks = vi.hoisted(() => ({ requestSettings: vi.fn() }));
let account: { phase: "loading" | "unconfigured" | "signed-out" | "signed-in"; user: { id: string } | null };

vi.mock("../lib/account/accountStore", () => ({
  useAccount: (selector: (state: typeof account) => unknown) => selector(account),
}));
vi.mock("../lib/uiStore", () => ({ useUi: { getState: () => mocks } }));
vi.mock("../components/questions/CommunityUploads", () => ({
  CommunityUploads: ({ onOpenLibrary }: { onOpenLibrary: () => void }) =>
    <button type="button" onClick={onOpenLibrary}>Open saved questions</button>,
}));
vi.mock("../components/tracker/SharedDailyLeaderboard", () => ({
  SharedDailyLeaderboard: () => <div>Shared daily challenge loaded</div>,
}));
vi.mock("./CommunityPage", () => ({
  CommunityPage: () => <div>Study circle loaded</div>,
}));
vi.mock("./LeaderboardsPage", () => ({ LeaderboardsPage: () => <div>Personal study record loaded</div> }));

beforeEach(() => {
  account = { phase: "unconfigured", user: null };
  mocks.requestSettings.mockReset();
  window.location.hash = "#communities";
});
afterEach(() => { cleanup(); });

describe("CommunitiesPage", () => {
  it("opens the existing Question Bank library from a community download", async () => {
    const user = userEvent.setup();
    render(<CommunitiesPage />);

    expect(screen.getByRole("main", { name: "Community" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Community" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Course exchange/i }));
    await user.click(screen.getByRole("button", { name: "Open saved questions" }));
    expect(window.location.hash).toBe("#questions");
  });

  it("keeps the shared challenge behind account availability and optional sign-in", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CommunitiesPage />);
    await user.click(screen.getByRole("button", { name: /Daily challenge/i }));
    expect(screen.getByText("Shared challenges are unavailable here")).toBeTruthy();
    expect(screen.queryByText("Shared daily challenge loaded")).toBeNull();

    account = { phase: "loading", user: null };
    rerender(<CommunitiesPage />);
    expect(screen.getByRole("status").textContent).toContain("Checking your account");

    account = { phase: "signed-out", user: null };
    rerender(<CommunitiesPage />);
    await user.click(screen.getByRole("button", { name: "Open account settings" }));
    expect(mocks.requestSettings).toHaveBeenCalledWith("account");

    account = { phase: "signed-in", user: { id: "learner-1" } };
    rerender(<CommunitiesPage />);
    expect(await screen.findByText("Shared daily challenge loaded")).toBeTruthy();
  });

  it("opens the opt-in social space from Communities", async () => {
    const user = userEvent.setup();
    render(<CommunitiesPage />);
    expect(await screen.findByText("Study circle loaded")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Study circle" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Personal bests/i }));
    expect(await screen.findByText("Personal study record loaded")).toBeTruthy();
  });

  it("preserves the legacy personal leaderboard destination within Community", async () => {
    render(<CommunitiesPage initialSpace="records" />);
    expect(await screen.findByText("Personal study record loaded")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Personal bests/i }).getAttribute("aria-pressed")).toBe("true");
  });
});
