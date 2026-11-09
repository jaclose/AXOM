// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { LeaderboardsPage } from "./LeaderboardsPage";

beforeEach(() => { useStore.setState(makeSeed()); });
afterEach(cleanup);

describe("Personal bests inside Community", () => {
  it("keeps the learner's private record available without a cloud account", () => {
    render(<LeaderboardsPage />);
    expect(screen.getByRole("heading", { name: "Your first week sets the baseline" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Log a study session/ })[0].getAttribute("href")).toBe("#productivity");
    expect(screen.getByRole("heading", { name: "Your completed weeks" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Shared study" })).toBeNull();
  });
});
