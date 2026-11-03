// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { useUi } from "../lib/uiStore";
import { DEFAULT_JOURNAL_NOTEBOOK } from "../lib/journalNotebook";
import { JournalPage } from "./JournalPage";

beforeEach(() => {
  useStore.setState({
    ...makeSeed(),
    activeDayKey: "2026-07-12",
    dayPlans: [],
    logs: [],
    tasks: [],
    journal: [{
      id: "existing",
      date: "2026-07-12T12:00:00",
      today: "Existing reflection",
      tomorrow: "Existing plan",
      blockers: "",
      energy: "Low",
      rating: "Useful",
    }],
  });
  useStore.setState((state) => ({ profile: { ...state.profile, journalNotebook: { ...DEFAULT_JOURNAL_NOTEBOOK, setupCompleted: true } } }));
  useUi.setState({ journalDay: "2026-07-12" });
});

afterEach(cleanup);

describe("Journal remediation routing", () => {
  it("updates an existing same-day entry instead of creating or overwriting a second entry", async () => {
    render(<JournalPage />);
    expect(await screen.findByRole("dialog", { name: "Full journal" })).toBeTruthy();
    expect((screen.getByLabelText("Which moment will you remember?") as HTMLTextAreaElement).value).toBe("Existing reflection");

    fireEvent.change(screen.getByLabelText("Energy"), { target: { value: "High" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(useStore.getState().journal).toHaveLength(1));
    expect(useStore.getState().journal[0]).toMatchObject({
      id: "existing",
      today: "Existing reflection",
      energy: "High",
    });
  });
});
