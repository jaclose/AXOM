// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateReadiness } from "../../lib/energy";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { UpNext } from "./UpNext";

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
  window.location.hash = "#dashboard";
});

afterEach(cleanup);

const RENAL_TRACKER = [
  { id: "tracker-real-1", path: "Renal/Lectures", label: "Glomerular physiology", kind: "Lecture" as const, passes: 0, ankiPasses: 0, yield: "high" as const, updated: "2026-07-12T08:00:00.000Z" },
  { id: "tracker-real-2", path: "Renal/PQs", label: "Renal practice", kind: "PQ" as const, passes: 1, ankiPasses: 0, yield: "review" as const, updated: "2026-07-12T08:00:00.000Z" },
];

function readinessNow() {
  const state = useStore.getState();
  return calculateReadiness({
    date: state.activeDayKey,
    factors: state.energyFactors,
    journal: state.journal,
    logs: state.logs,
    tasks: state.tasks,
    dayPlans: state.dayPlans,
    productivityTrackers: state.productivityTrackers,
  });
}

describe("Up next", () => {
  it("stays out of the way in a seed-only workspace", () => {
    useStore.setState({ ...makeSeed(), activeDayKey: "2026-07-12" });
    const { container } = render(<UpNext />);
    expect(container.innerHTML).toBe("");
  });

  it("suggests the first real item right away, with no setup checklist", async () => {
    render(<UpNext />);
    expect(screen.queryByText("Up next")).toBeNull();
    await act(() => useStore.getState().addTask("Submit the anatomy worksheet", "2026-07-12", "Anatomy"));
    expect(screen.getByText("Up next")).toBeTruthy();
    expect(screen.getByText("Submit the anatomy worksheet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.queryByText(/checklist/i)).toBeNull();
  });

  it("shows the study plan behind a suggestion and carries enabled resources into the session", async () => {
    const current = useStore.getState();
    useStore.setState({
      profile: { ...current.profile, studyWorkflow: { configured: true, lecturePasses: 4, methods: [{ id: "anki", enabled: false }, { id: "notes", enabled: true }] } },
      courses: [{ id: "renal", termId: "term", code: "RENAL", name: "Renal block", files: 0, modules: [] }],
      tracker: [{ id: "real", path: "RENAL/Lectures", label: "Renal transport", kind: "Lecture", passes: 3, ankiPasses: 0, yield: "high", updated: "2026-07-12T08:00:00Z" }],
      dayPlans: [{ dayKey: "2026-07-12", intention: "Renal transport", wins: [], createdAt: "2026-07-12T08:00:00Z" }],
    });
    render(<UpNext />);
    expect(screen.getByText("Review: Renal transport")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    const plan = screen.getByRole("region", { name: "Study plan used for this suggestion" });
    expect(plan.textContent).toContain("3 of 4 passes complete");
    await act(() => useStore.setState({ courses: [{ ...useStore.getState().courses[0], studyPlanOverride: { lecturePasses: 5, reviewAfterDays: 6 } }] }));
    expect(plan.textContent).toContain("3 of 5 passes complete · Review after 6 days");
    await act(() => useStore.setState({ profile: { ...useStore.getState().profile, studyWorkflow: { configured: true, lecturePasses: 4, methods: [{ id: "anki", enabled: false }, { id: "noji", enabled: true }] } } }));
    expect(screen.getByText(/Noji/, { selector: ".up-next-resources" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(useStore.getState().sessions[0]).toMatchObject({ link: { id: "real", kind: "tracker" }, resources: ["Noji"], source: "command-brief" });
    // A running session lives in the focus dock, so the strip steps aside.
    expect(screen.queryByText("Up next")).toBeNull();
  });

  it("lists the evidence and uses Daily Check-In targets", () => {
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
      dayPlans: [{ dayKey: "2026-07-12", intention: "Protect one focused block", wins: [], expectedStudyMinutes: 20, createdAt: "2026-07-12T08:00:00.000Z" }],
    });
    render(<UpNext />);
    expect(screen.getByText("Complete Practice questions")).toBeTruthy();
    expect(screen.getByText("~20 min · Today’s targets")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByText(/Scheduled target: 0 of 10 questions/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Suggestion evidence" })).toBeTruthy();
  });

  it("leads with the smaller step when energy is low, without editing anything", () => {
    useStore.setState({
      courses: [{ id: "course-real", termId: "term-real", code: "RENAL", name: "Renal block", files: 0, modules: [] }],
      tracker: RENAL_TRACKER,
      logs: [{ id: "log-real", dayKey: "2026-07-12", ts: "2026-07-12T09:00:00.000Z", type: "Study", minutes: 30, cards: 0, academic: true, productive: true }],
    });
    render(<UpNext readiness={readinessNow()} />);
    expect(screen.getByText("Energy is low today, so this starts small.")).toBeTruthy();
    const fullPlan = screen.getByRole("button", { name: /Full plan:/ });
    fireEvent.click(fullPlan);
    expect(screen.queryByText("Energy is low today, so this starts small.")).toBeNull();
    expect(screen.getByRole("button", { name: /Short on time\?/ })).toBeTruthy();
    expect(useStore.getState().tasks).toEqual([]);
    expect(useStore.getState().dayPlans).toEqual([]);
  });

  it("starts the smaller step as a minimum-viable-win session", () => {
    useStore.setState({ courses: [{ id: "course-real", termId: "term-real", code: "RENAL", name: "Renal block", files: 0, modules: [] }], tracker: RENAL_TRACKER });
    render(<UpNext />);
    fireEvent.click(screen.getByRole("button", { name: /Short on time\?/ }));
    expect(useStore.getState().sessions[0]).toMatchObject({ source: "minimum-viable-win" });
  });

  it("can be hidden", () => {
    useStore.setState({ courses: [{ id: "course-real", termId: "term-real", code: "RENAL", name: "Renal block", files: 0, modules: [] }], tracker: RENAL_TRACKER });
    const onHide = vi.fn();
    render(<UpNext onHide={onHide} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide Up next" }));
    expect(onHide).toHaveBeenCalledOnce();
  });
});
