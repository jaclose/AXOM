// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDailyRequirement } from "../../lib/dailySuccess";
import type { QuestionRecord } from "../../lib/questions";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import type { JournalEntry } from "../../lib/types";
import { useUi } from "../../lib/uiStore";
import { CloseoutModal } from "./CloseoutModal";

const DAY = "2035-04-13";

beforeEach(() => {
  setCloseoutState();
  useUi.setState({ journalDay: null });
  window.location.hash = "#dashboard";
});

afterEach(cleanup);

describe("CloseoutModal daily loop", () => {
  it("shows the canonical Day at a Glance, exact reflection prompts, and saves numeric energy", () => {
    const onClose = vi.fn();
    render(<CloseoutModal onClose={onClose} />);

    const glance = screen.getByRole("region", { name: "Day at a glance" });
    expect(within(glance).getByText("Day at a Glance")).toBeTruthy();
    expect(within(glance).getByText("Intention: Finish the renal review")).toBeTruthy();
    expect(within(glance).getByText("Targets: 1/1 met")).toBeTruthy();
    expect(within(glance).getByText("25 focused min · 1 questions · 12 cards")).toBeTruthy();
    expect(within(glance).getByText(/1 tasks completed · 1 open loop/)).toBeTruthy();

    const prompts = [
      "What went well?",
      "One win",
      "What got in the way?",
      "One unfinished loop",
      "What matters tomorrow?",
      "Energy now (0–100)",
    ];
    for (const prompt of prompts) expect(screen.getByLabelText(prompt)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "Finished the question block" } });
    fireEvent.change(screen.getByLabelText("One win"), { target: { value: "Stayed focused" } });
    fireEvent.change(screen.getByLabelText("What got in the way?"), { target: { value: "A late meeting" } });
    fireEvent.change(screen.getByLabelText("One unfinished loop"), { target: { value: "Finish the summary" } });
    fireEvent.change(screen.getByLabelText("What matters tomorrow?"), { target: { value: "Start cardiology" } });
    const energyInput = screen.getByLabelText("Energy now (0–100)") as HTMLInputElement;
    expect(energyInput.min).toBe("0");
    expect(energyInput.max).toBe("100");
    fireEvent.change(energyInput, { target: { value: "73" } });
    fireEvent.click(screen.getByText("Planning details"));
    fireEvent.click(screen.getByRole("button", { name: "Higher" }));

    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close the day" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(useStore.getState().closeouts).toHaveLength(1);
    expect(useStore.getState().closeouts[0]).toMatchObject({
      dayKey: DAY,
      completedSummary: "Finished the question block",
      oneWin: "Stayed focused",
      blocker: "A late meeting",
      remainingSummary: "Finish the summary",
      tomorrowFirstTask: "Start cardiology",
      energyNow: 73,
      energyVsMorning: "higher",
      tomorrowMode: "auto",
    });
    // The closeout always becomes today's journal page.
    expect(useStore.getState().journal).toHaveLength(1);
    expect(useStore.getState().journal[0]).toMatchObject({
      date: `${DAY}T20:30:00`,
      today: "Finished the question block",
      tomorrow: "Start cardiology",
      blockers: "A late meeting",
      energy: "High",
      rating: "Daily closeout",
      wins: ["Stayed focused"],
      losses: ["Finish the summary"],
    });
  });

  it("merges into an existing same-day entry without overwriting anything written there", () => {
    const existing: JournalEntry = {
      id: "existing-journal",
      date: `${DAY}T09:00:00`,
      today: "Existing reflection",
      tomorrow: "Existing plan",
      blockers: "",
      energy: "Medium",
      rating: "Useful",
    };
    useStore.setState({ journal: [existing] });
    render(<CloseoutModal onClose={vi.fn()} />);

    expect(screen.getByText(/your writing there stays as it is/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "New closeout reflection" } });
    fireEvent.change(screen.getByLabelText("One win"), { target: { value: "Kept going" } });
    fireEvent.change(screen.getByLabelText("What got in the way?"), { target: { value: "Fatigue" } });
    fireEvent.click(screen.getByRole("button", { name: "Close the day" }));

    const [page] = useStore.getState().journal;
    expect(useStore.getState().journal).toHaveLength(1);
    expect(page).toMatchObject({
      id: "existing-journal",
      today: "Existing reflection",
      tomorrow: "Existing plan",
      blockers: "Fatigue",
      energy: "Medium",
      wins: ["Kept going"],
    });
    expect(useStore.getState().closeouts[0].completedSummary).toBe("New closeout reflection");
  });

  it("derives the journal energy label from the entered score", () => {
    render(<CloseoutModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "Completed the core review" } });
    fireEvent.change(screen.getByLabelText("One win"), { target: { value: "Asked for help early" } });
    fireEvent.change(screen.getByLabelText("What got in the way?"), { target: { value: "Noisy room" } });
    fireEvent.change(screen.getByLabelText("What matters tomorrow?"), { target: { value: "Review weak questions" } });
    fireEvent.change(screen.getByLabelText("Energy now (0–100)"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Close the day" }));

    expect(useStore.getState().journal).toHaveLength(1);
    expect(useStore.getState().journal[0]).toMatchObject({
      date: `${DAY}T20:30:00`,
      today: "Completed the core review",
      wins: ["Asked for help early"],
      tomorrow: "Review weak questions",
      blockers: "Noisy room",
      energy: "Low",
      rating: "Daily closeout",
    });
  });

  it("saves before expanding into the full notebook and routes to the same day", () => {
    const onClose = vi.fn();
    render(<CloseoutModal onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("What matters tomorrow?"), { target: { value: "Start cardiology" } });

    fireEvent.click(screen.getByRole("button", { name: "Expand into full notebook" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(useStore.getState().closeouts).toHaveLength(1);
    expect(useStore.getState().closeouts[0].tomorrowFirstTask).toBe("Start cardiology");
    expect(useStore.getState().journal[0]).toMatchObject({ tomorrow: "Start cardiology" });
    expect(useUi.getState().journalDay).toBe(DAY);
    expect(window.location.hash).toBe("#journal");
  });
});

function setCloseoutState() {
  const seed = makeSeed();
  const target = makeDailyRequirement({
    id: "focus-target",
    label: "Focused study",
    source: { kind: "study-minutes" },
    target: 25,
    unit: "minutes",
    trackingStartsAt: DAY,
  }, DAY);
  useStore.setState({
    ...seed,
    activeDayKey: DAY,
    profile: {
      ...seed.profile,
      dailySuccess: { version: 1, configuredAt: DAY, requirements: [target] },
    },
    dayPlans: [{
      dayKey: DAY,
      intention: "Finish the renal review",
      wins: ["Complete the question block"],
      createdAt: `${DAY}T07:00:00.000Z`,
    }],
    logs: [{
      id: "study-log",
      dayKey: DAY,
      ts: `${DAY}T10:00:00.000Z`,
      type: "Focused study",
      minutes: 25,
      cards: 12,
      academic: true,
      productive: true,
    }],
    tasks: [
      {
        id: "completed-task",
        title: "Complete the question block",
        done: true,
        archived: false,
        created: `${DAY}T07:00:00.000Z`,
        completedAt: `${DAY}T12:00:00.000Z`,
      },
      {
        id: "open-task",
        title: "Write the summary",
        done: false,
        archived: false,
        created: `${DAY}T07:00:00.000Z`,
        due: DAY,
      },
    ],
    questions: [questionWithAttempt()],
    sessions: [],
    closeouts: [],
    recoveryPlans: [],
    habits: [],
    habitEntries: [],
    journal: [],
    energyFactors: [],
  });
}

function questionWithAttempt(): QuestionRecord {
  return {
    id: "question-1",
    source: "manual",
    stem: "Which answer is supported?",
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    correctKey: "B",
    status: "correct",
    tags: [],
    attempts: [{ at: `${DAY}T11:00:00.000Z`, answerKey: "B", status: "correct" }],
    createdAt: `${DAY}T08:00:00.000Z`,
    updatedAt: `${DAY}T11:00:00.000Z`,
  };
}
