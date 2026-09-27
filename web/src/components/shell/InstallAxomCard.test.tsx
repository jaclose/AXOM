// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallAxomCard } from "./InstallAxomCard";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false })) });
});
afterEach(cleanup);

describe("InstallAxomCard", () => {
  it("stays absent when the browser does not support an install prompt", () => {
    render(<InstallAxomCard />);
    expect(screen.queryByRole("button", { name: /install axom/i })).toBeNull();
  });

  it("uses a supported prompt once and hides after acceptance", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event("beforeinstallprompt") as Event & { prompt: typeof prompt; userChoice: Promise<{ outcome: "accepted"; platform: string }> };
    event.prompt = prompt;
    event.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    render(<InstallAxomCard />);
    fireEvent(window, event);
    fireEvent.click(await screen.findByRole("button", { name: /install axom/i }));
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("button", { name: /install axom/i })).toBeNull());
  });

  it("does not prompt when already running standalone", () => {
    fireEvent(window, new Event("appinstalled"));
    render(<InstallAxomCard />);
    expect(screen.queryByRole("button", { name: /install axom/i })).toBeNull();
  });
});
