// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../lib/brand";
import { GuideAssistant } from "./GuideAssistant";

function renderGuide() {
  const onStart = vi.fn();
  const onClose = vi.fn();
  render(<GuideAssistant route="dashboard" onClose={onClose} onStart={onStart} />);
  const input = screen.getByLabelText("Ask how to do something in AXOM");
  return { onStart, onClose, input };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("GuideAssistant", () => {
  it("opens on popular topics and narrows to matches as you type", () => {
    const { input, onStart } = renderGuide();
    expect(screen.getByRole("dialog", { name: "AXOM Guide" })).toBeTruthy();
    expect(screen.getByText("Popular")).toBeTruthy();
    expect(screen.getByText("Generate Anki cards with AI")).toBeTruthy();

    fireEvent.change(input, { target: { value: "dark mode" } });
    expect(screen.getByText("Best matches")).toBeTruthy();
    const topic = screen.getByText("Change the theme or appearance").closest("li")!;
    fireEvent.click(within(topic).getByRole("button", { name: "Open settings" }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: "appearance", settingsTab: "appearance" }));
  });

  it("offers walkthroughs for page features", () => {
    const { input, onStart } = renderGuide();
    fireEvent.change(input, { target: { value: "make flashcards" } });
    const topic = screen.getByText("Generate Anki cards with AI").closest("li")!;
    fireEvent.click(within(topic).getByRole("button", { name: "Show me" }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: "anki-generate" }));
  });

  it("works without AI and says how to get written answers", () => {
    const { input } = renderGuide();
    expect(screen.queryByRole("button", { name: /Ask/ })).toBeNull();
    fireEvent.change(input, { target: { value: "zzzz qqqq" } });
    expect(screen.getByText(/turn on AI in Settings → Advanced/)).toBeTruthy();
  });

  it("adds a labeled AI answer when a provider is on", async () => {
    localStorage.setItem(STORAGE_KEYS.aiSettings, JSON.stringify({ mode: "mock", localEndpoint: "http://localhost:11434" }));
    const { input } = renderGuide();
    fireEvent.change(input, { target: { value: "how do I back up my data" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText(/\[DEMO\] Here's where to look/)).toBeTruthy();
    expect(screen.getByText("Where to go")).toBeTruthy();
    expect(screen.getByText(/Demo \(mock output/)).toBeTruthy();
    expect(screen.getByText("Back up or restore your data")).toBeTruthy();

    // Editing the question clears the stale answer.
    fireEvent.change(input, { target: { value: "how do I back up" } });
    expect(screen.queryByText(/\[DEMO\] Here's where to look/)).toBeNull();
  });
});
