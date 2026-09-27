// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { newSchedule, type AnkiCard } from "../../lib/ankiCards";
import { CardReviewMode } from "./CardReviewMode";

const ai = vi.hoisted(() => ({ provider: null as unknown, sharpen: vi.fn() }));
vi.mock("../../lib/ai", async (original) => ({
  ...(await original<typeof import("../../lib/ai")>()),
  resolveActiveProvider: () => ai.provider,
  sharpenCard: ai.sharpen,
}));

const card: AnkiCard = {
  id: "c1", type: "basic", front: "Loop diuretic target?", back: "NKCC2 in the thick ascending limb", tags: [], aiGenerated: false,
  schedule: newSchedule(), createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};

beforeEach(() => {
  ai.provider = null;
  useStore.setState({ ...makeSeed(), ankiCards: [card], cardReviews: [] });
});
afterEach(cleanup);

describe("CardReviewMode", () => {
  it("reveals with Space and rates with Anki's number keys", () => {
    render(<CardReviewMode />);
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByText("NKCC2 in the thick ascending limb")).toBeTruthy();
    fireEvent.keyDown(window, { key: "3" });
    expect(useStore.getState().ankiCards[0].schedule.reps).toBeGreaterThan(0);
    expect(screen.getByText(/Queue clear — 1 reviewed/)).toBeTruthy();
  });

  it("applies an AI rewrite only when accepted and keeps the old wording", async () => {
    ai.provider = { info: { kind: "mock", label: "Demo", local: true, requiresKey: false }, available: vi.fn(), completeJson: vi.fn() };
    ai.sharpen.mockResolvedValue({ front: "Loop diuretics inhibit which transporter?", back: "NKCC2", why: "One cue, one fact." });
    render(<CardReviewMode />);
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: /Sharpen card/ }));
    await waitFor(() => expect(screen.getByText("Suggested rewrite")).toBeTruthy());
    expect(useStore.getState().ankiCards[0].front).toBe("Loop diuretic target?");
    fireEvent.click(screen.getByRole("button", { name: "Use this version" }));
    expect(useStore.getState().ankiCards[0]).toMatchObject({ front: "Loop diuretics inhibit which transporter?", back: "NKCC2" });
    expect(useStore.getState().ankiCards[0].extra).toContain("Previous version: Loop diuretic target?");
  });
});
