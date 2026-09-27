// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateReadiness } from "../../lib/energy";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { useUi } from "../../lib/uiStore";
import { CommandBrief } from "./CommandBrief";

beforeEach(() => {
  const seed = makeSeed();
  useStore.setState({
    ...seed,
    activeDayKey: "2026-07-12",
    tasks: [],
    tracker: [],
    logs: [],
    sessions: [],
    closeouts: [],
    recoveryPlans: [],
    questions: [],
    ankiCards: [],
    dayPlans: [],
    energyFactors: [],
    journal: [{
      id: "today",
      date: "2026-07-12T12:00:00",
      today: "Low energy today.",
      tomorrow: "",
      blockers: "",
      energy: "Low",
      rating: "",
    }],
  });
  useUi.setState({ journalDay: null });
  window.location.hash = "#dashboard";
});

afterEach(cleanup);

describe("CommandBrief recommendation provenance", () => {
  it("updates the resolved plan after preference edits and carries enabled resources into a session", async () => {
    const current = useStore.getState();
    useStore.setState({
      profile: { ...current.profile, studyWorkflow: { configured: true, lecturePasses: 4, methods: [{ id: "anki", enabled: false }, { id: "notes", enabled: true }] } },
      courses: [{ id: "renal", termId: "term", code: "RENAL", name: "Renal block", files: 0, modules: [] }],
      tracker: [{ id: "real", path: "RENAL/Lectures", label: "Renal transport", kind: "Lecture", passes: 3, ankiPasses: 0, yield: "high", updated: "2026-07-12T08:00:00Z" }],
      dayPlans: [{ dayKey: "2026-07-12", intention: "Renal transport", wins: [], createdAt: "2026-07-12T08:00:00Z" }],
    });
    render(<CommandBrief />);
    expect(screen.getByText("Review: Renal transport")).toBeTruthy();
    fireEvent.click(screen.getByText("Why this suggestion?"));
    const plan = screen.getByRole("region", { name: "Study plan used for this suggestion" });
    expect(plan.textContent).toContain("3 of 4 passes complete");
    await act(() => useStore.setState({ courses: [{ ...useStore.getState().courses[0], studyPlanOverride: { lecturePasses: 5, reviewAfterDays: 6 } }] }));
    expect(plan.textContent).toContain("3 of 5 passes complete · Review after 6 days");
    expect(plan.textContent).toContain("course override");
    await act(() => useStore.setState({ profile: { ...useStore.getState().profile, studyWorkflow: { configured: true, lecturePasses: 4, methods: [{ id: "anki", enabled: false }, { id: "noji", enabled: true }] } } }));
    fireEvent.click(screen.getByRole("button", { name: "Begin Session" }));
    expect(useStore.getState().sessions[0]).toMatchObject({ link: { id: "real", kind: "tracker" }, resources: ["Noji"] });
  });

  it("renders a neutral evidence checklist for a seed-only workspace", () => {
    useStore.setState({ ...makeSeed(), activeDayKey: "2026-07-12" });
    render(<CommandBrief />);

    expect(screen.getByRole("heading", { name: "Command Brief" })).toBeTruthy();
    expect(screen.getByText("Add one real piece of work")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Command Brief starter checklist" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /open course tracker/i }).getAttribute("href")).toBe("#tracker");
    expect(screen.getByRole("link", { name: /set today’s focus/i }).getAttribute("href")).toBe("#dashboard");
    expect(screen.getByRole("link", { name: /open productivity/i }).getAttribute("href")).toBe("#productivity");
    expect(screen.getByRole("link", { name: /open question bank/i }).getAttribute("href")).toBe("#questions");
    expect(screen.queryByRole("button", { name: "Use Command Brief now" })).toBeNull();
    expect(screen.queryByText("Next best move")).toBeNull();
    expect(screen.queryByText(/Minimum viable win/i)).toBeNull();
    expect(screen.queryByText(/Since yesterday/i)).toBeNull();
  });

  it("updates the starter checklist immediately and transitions after one action plus today context", async () => {
    render(<CommandBrief />);

    await act(() => useStore.getState().addTask("Review renal physiology", "2026-07-13", "Renal"));
    const workRow = screen.getByText("Add or import one real study item").closest("li");
    expect(workRow).toBeTruthy();
    expect(within(workRow!).getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Command Brief now" })).toBeTruthy();
    expect(screen.queryByText("Next best move")).toBeNull();

    await act(() => useStore.getState().setDayPlan("2026-07-12", "Finish the renal review", []));
    expect(screen.queryByRole("list", { name: "Command Brief starter checklist" })).toBeNull();
    expect(screen.getByText("Current state")).toBeTruthy();
    expect(screen.getByText("Next best move")).toBeTruthy();
    expect(screen.getByText("Review renal physiology")).toBeTruthy();
  });

  it("marks intention and activity independently without converting seed data into evidence", async () => {
    render(<CommandBrief />);

    await act(() => useStore.getState().setDayPlan("2026-07-12", "Protect one focused block", []));
    const intentionRow = screen.getByText("Set today’s intention").closest("li");
    expect(intentionRow).toBeTruthy();
    expect(within(intentionRow!).getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Command Brief now" })).toBeTruthy();

    await act(() => useStore.getState().logActivity({ label: "Renal review", minutes: 20 }));
    const activityRow = screen.getByText("Start a timer or log an activity").closest("li");
    expect(activityRow).toBeTruthy();
    expect(within(activityRow!).getByText("Ready")).toBeTruthy();
    expect(screen.queryByText("Next best move")).toBeNull();
  });

  it("supports an explicit, inspectable limited-confidence activation", async () => {
    render(<CommandBrief />);
    await act(() => useStore.getState().addTask("Submit the anatomy worksheet", "2026-07-12", "Anatomy"));

    fireEvent.click(screen.getByRole("button", { name: "Use Command Brief now" }));

    expect(screen.getByText("Limited confidence")).toBeTruthy();
    expect(screen.getByText("Submit the anatomy worksheet")).toBeTruthy();
    fireEvent.click(screen.getByText("Why this suggestion?"));
    expect(screen.getByRole("list", { name: "Suggestion evidence" })).toBeTruthy();
  });

  it("uses the canonical target selector and Daily Check-In context in the rendered brief", () => {
    const current = useStore.getState();
    useStore.setState({
      profile: {
        ...current.profile,
        dailySuccess: {
          version: 1,
          configuredAt: "2026-07-12",
          requirements: [{
            id: "questions-target",
            label: "Practice questions",
            enabled: true,
            source: { kind: "practice-questions" },
            weight: 1,
            target: 10,
            unit: "questions",
            schedule: { kind: "daily" },
            trackingStartsAt: "2026-07-12",
            createdAt: "2026-07-12T08:00:00.000Z",
            updatedAt: "2026-07-12T08:00:00.000Z",
          }],
        },
      },
      dayPlans: [{
        dayKey: "2026-07-12",
        intention: "Protect one focused block",
        wins: [],
        expectedStudyMinutes: 20,
        createdAt: "2026-07-12T08:00:00.000Z",
      }],
    });

    render(<CommandBrief />);

    expect(screen.getByText("Complete Practice questions")).toBeTruthy();
    expect(screen.getByText("~20 min · Today’s targets")).toBeTruthy();
    fireEvent.click(screen.getByText("Why this suggestion?"));
    expect(screen.getByText(/Scheduled target: 0 of 10 questions/)).toBeTruthy();
    expect(screen.getByText(/Sized to the planned 20-minute block/)).toBeTruthy();
  });

  it("explains the threshold, calculation, unchanged data, and user overrides", () => {
    useStore.setState({
      courses: [{ id: "course-real", termId: "term-real", code: "RENAL", name: "Renal block", files: 0, modules: [] }],
      tracker: [
        { id: "tracker-real-1", path: "Renal/Lectures", label: "Glomerular physiology", kind: "Lecture", passes: 0, ankiPasses: 0, yield: "high", updated: "2026-07-12T08:00:00.000Z" },
        { id: "tracker-real-2", path: "Renal/PQs", label: "Renal practice", kind: "PQ", passes: 1, ankiPasses: 0, yield: "review", updated: "2026-07-12T08:00:00.000Z" },
      ],
      logs: [{ id: "log-real", dayKey: "2026-07-12", ts: "2026-07-12T09:00:00.000Z", type: "Study", minutes: 30, cards: 0, academic: true, productive: true }],
    });
    const state = useStore.getState();
    const readiness = calculateReadiness({
      date: state.activeDayKey,
      factors: state.energyFactors,
      journal: state.journal,
      logs: state.logs,
      tasks: state.tasks,
      dayPlans: state.dayPlans,
      productivityTrackers: state.productivityTrackers,
    });
    render(<CommandBrief readiness={readiness} />);

    expect(screen.getByRole("heading", { name: "Lower-energy option" })).toBeTruthy();
    expect(screen.getByText(/Self-reported energy:/i).textContent).toMatch(/35\/100/);
    expect(screen.getByText(/suggestion threshold:/i).textContent).toMatch(/40\/100/);
    expect(screen.getByText(/Tasks and deadlines/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /show calculation/i }));
    expect(screen.getByText(/Baseline 62\/100/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Update energy" }));
    expect(useUi.getState().journalDay).toBe("2026-07-12");
    expect(window.location.hash).toBe("#journal");

    fireEvent.click(screen.getByRole("button", { name: "Restore original plan" }));
    expect(screen.queryByRole("heading", { name: "Lower-energy option" })).toBeNull();
    expect(useStore.getState().tasks).toEqual([]);
    expect(useStore.getState().dayPlans).toEqual([]);
  });

  it("renders the accepted brief once every evidence criterion is ready", () => {
    useStore.setState({
      courses: [{ id: "course-real", termId: "term-real", code: "RENAL", name: "Renal block", files: 0, modules: [] }],
      tracker: [
        { id: "tracker-real-1", path: "Renal/Lectures", label: "Glomerular physiology", kind: "Lecture", passes: 0, ankiPasses: 0, yield: "high", updated: "2026-07-12T08:00:00.000Z" },
        { id: "tracker-real-2", path: "Renal/PQs", label: "Renal practice", kind: "PQ", passes: 1, ankiPasses: 0, yield: "review", updated: "2026-07-12T08:00:00.000Z" },
      ],
      logs: [{ id: "log-real", dayKey: "2026-07-12", ts: "2026-07-12T09:00:00.000Z", type: "Study", minutes: 30, cards: 0, academic: true, productive: true }],
    });

    render(<CommandBrief />);
    expect(screen.queryByText("AXOM is learning your current workload.")).toBeNull();
    expect(screen.getByText("Current state")).toBeTruthy();
    expect(screen.getByText("Next best move")).toBeTruthy();
    expect(screen.getByText(/Alternate small win/i)).toBeTruthy();
    expect(screen.getByText(/Since yesterday/i)).toBeTruthy();

    const disclosure = screen.getByText("Why this suggestion?");
    const details = disclosure.closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
    fireEvent.click(disclosure);
    expect(details?.hasAttribute("open")).toBe(true);
    expect(screen.getByText(/Evidence score: \d+/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Suggestion evidence" })).toBeTruthy();
    expect(screen.getAllByText("Course Tracker", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Recovery plan" })).toBeNull();
  });
});
