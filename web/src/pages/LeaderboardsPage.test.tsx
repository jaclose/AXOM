// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { useAccount } from "../lib/account/accountStore";
import { useUi } from "../lib/uiStore";
import { LeaderboardsPage } from "./LeaderboardsPage";

beforeEach(() => {
  useStore.setState(makeSeed());
  useAccount.setState({ phase: "unconfigured", user: null });
  useUi.getState().clearSettingsRequest();
});
afterEach(cleanup);

describe("Leaderboards", () => {
  it("starts with personal standings and a local next action", () => {
    render(<LeaderboardsPage />);
    const personal = screen.getByRole("heading", { name: "Your first week sets the baseline" });
    const shared = screen.getByRole("heading", { name: "Shared study" });
    expect(personal.compareDocumentPosition(shared) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Log a study session/ })[0].getAttribute("href")).toBe("#productivity");
    expect(screen.getByText(/This build has no account service/)).toBeTruthy();
    expect(screen.getByText("Work in progress")).toBeTruthy();
  });

  it("gives signed-out learners an account settings action", () => {
    useAccount.setState({ phase: "signed-out" });
    render(<LeaderboardsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open account settings/ }));
    expect(useUi.getState().settingsRequest).toBe("account");
  });
});
