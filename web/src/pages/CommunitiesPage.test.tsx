// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunitiesPage } from "./CommunitiesPage";

vi.mock("../components/questions/CommunityUploads", () => ({
  CommunityUploads: ({ onOpenLibrary }: { onOpenLibrary: () => void }) =>
    <button type="button" onClick={onOpenLibrary}>Open saved questions</button>,
}));
vi.mock("../lib/account/accountStore", () => ({ useAccount: (selector: (s: { user: null }) => unknown) => selector({ user: null }) }));
vi.mock("./LeaderboardsPage", () => ({ LeaderboardsPage: () => <div>Personal records loaded</div> }));
vi.mock("./CommunityPage", () => ({
  CommunityPage: () => <div>Study circle loaded</div>,
}));

beforeEach(() => {
  window.location.hash = "#communities";
});
afterEach(() => { cleanup(); });

describe("CommunitiesPage", () => {
  it("opens the existing Question Bank library from a community download", async () => {
    const user = userEvent.setup();
    render(<CommunitiesPage initialSpace="courses" />);

    expect(screen.getByRole("main", { name: "Community" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Community" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open saved questions" }));
    expect(window.location.hash).toBe("#questions");
  });

  it("keeps unfinished daily challenges out of the available spaces", () => {
    render(<CommunitiesPage initialSpace="courses" />);
    expect(screen.queryByRole("button", { name: /Daily challenge/i })).toBeNull();
    expect(screen.queryByText("Work in progress")).toBeNull();
    expect(screen.getByRole("button", { name: /Course exchange/i })).toBeTruthy();
  });

  it("opens the opt-in social space from Communities", async () => {
    const user = userEvent.setup();
    render(<CommunitiesPage initialSpace="courses" />);

    await user.click(screen.getByRole("button", { name: /Study circle/i }));
    expect(await screen.findByText("Study circle loaded")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Study circle" })).toBeTruthy();
  });
});
