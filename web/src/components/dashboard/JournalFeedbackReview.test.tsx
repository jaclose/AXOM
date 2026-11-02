// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalFeedbackReview } from "./JournalFeedbackReview";

const listJournalFeedback = vi.fn();
vi.mock("../../lib/journalFeedback", () => ({ listJournalFeedback: (...args: unknown[]) => listJournalFeedback(...args) }));
afterEach(() => { cleanup(); listJournalFeedback.mockReset(); });

describe("Host journal feedback review", () => {
  it("shows only submitted fields and no private page content", async () => {
    listJournalFeedback.mockResolvedValue([{
      id: "11111111-1111-4111-8111-111111111111", rating: 4,
      liked: "The open page", wantMore: "Desk light", missing: "", painPoints: "Small writing area", comment: "",
      createdAt: "2026-11-01T12:00:00.000Z",
    }]);
    render(<JournalFeedbackReview accountId="22222222-2222-4222-8222-222222222222" />);
    await waitFor(() => expect(screen.getByText("The open page")).toBeTruthy());
    expect(screen.getByText("Small writing area")).toBeTruthy();
    expect(screen.getByText(/journal pages and attachments are never included/i)).toBeTruthy();
    expect(listJournalFeedback).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222");
  });

  it("shows a recoverable error when feedback cannot load", async () => {
    listJournalFeedback.mockRejectedValue(new Error("Feedback could not be loaded."));
    render(<JournalFeedbackReview accountId="22222222-2222-4222-8222-222222222222" />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/i));
  });
});
