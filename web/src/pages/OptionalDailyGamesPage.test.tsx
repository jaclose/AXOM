// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { OptionalDailyGamesPage } from "./OptionalDailyGamesPage";

afterEach(cleanup);
describe("Daily Games hub", () => {
  it("separates local, verified external, and unverified games", () => {
    useStore.setState(makeSeed());
    render(<OptionalDailyGamesPage />);
    expect(screen.getByRole("link", { name: /play now/i }).getAttribute("href")).toBe("#daily-word");
    expect(screen.getByRole("link", { name: /open verified site/i }).getAttribute("href")).toBe("https://doctordle.org/");
    expect(screen.getByText("DESTINATION REQUIRES CONFIRMATION")).toBeTruthy();
    expect(screen.getByText("Not available yet").getAttribute("aria-disabled")).toBe("true");
  });
});
