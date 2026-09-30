// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { cardSystemFor } from "./cardSystem";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import {
  applySetup, cardSystemFromTools, dashboardFromChoices, defaultChoices, defaultTargets, focusChoices,
  readSetupDraft, resolveFocus, workflowFromChoices, writeSetupDraft, type SetupChoices,
} from "./setupPlan";

const TODAY = "2026-09-30";
const choices = (patch: Partial<SetupChoices>): SetupChoices => ({ ...defaultChoices(), ...patch });

beforeEach(() => {
  localStorage.clear();
  useStore.setState(makeSeed());
});

describe("path and focus", () => {
  it("offers SGU terms only to SGU, and clinical phases to other medical schools", () => {
    expect(focusChoices("sgu").map((option) => option.label)).toEqual(["Term 1", "Term 2", "Term 3", "Term 4", "Term 5", "CBSE", "Step 1"]);
    expect(focusChoices("usmd").map((option) => option.label)).toEqual(["Pre-clinical", "Clinical", "Boards"]);
    expect(focusChoices("premed").some((option) => option.label.startsWith("Term"))).toBe(false);
    expect(resolveFocus({ path: "premed", focus: "mcat" })).toMatchObject({ track: "mcat", stage: "exam-prep" });
  });
});

describe("what the study tools drive", () => {
  it("builds a workflow Course Tracker and plans can read", () => {
    const workflow = workflowFromChoices(choices({ tools: ["lectures", "uworld", "noji"], lecturePasses: 3 }));
    const enabled = workflow.methods!.filter((method) => method.enabled).map((method) => method.id);
    expect(enabled).toEqual(["lecture-passes", "practice-questions", "noji", "external-resource"]);
    expect(workflow.lecturePasses).toBe(3);
    expect(workflow.methods!.find((method) => method.id === "external-resource")?.label).toBe("UWorld");
  });

  it("shows card rounds under the student's own app, or not at all", () => {
    expect(cardSystemFromTools(["anki", "noji"])?.label).toBe("Anki");
    expect(cardSystemFor(workflowFromChoices(choices({ tools: ["noji", "questions"] })))?.label).toBe("Noji");
    expect(cardSystemFor(workflowFromChoices(choices({ tools: ["lectures", "questions"] })))).toBeNull();
    expect(cardSystemFor(undefined)?.label).toBe("Anki"); // profiles that never did setup keep Anki rounds
  });

  it("starts with sensible targets instead of asking what makes a day count", () => {
    const sgu = defaultTargets(choices({ path: "sgu", focus: "term1", tools: ["lectures", "questions", "anki"] }), TODAY);
    expect(sgu.map((target) => [target.label, target.target])).toEqual([["Study", 210], ["Practice questions", 20], ["Lectures", 2], ["Anki cards", 100]]);
    const noCards = defaultTargets(choices({ tools: ["lectures"] }), TODAY);
    expect(noCards.map((target) => target.label)).toEqual(["Study", "Lectures"]);
    const boards = defaultTargets(choices({ path: "usmd", focus: "boards", tools: ["lectures", "uworld"] }), TODAY);
    expect(boards.map((target) => [target.label, target.target])).toEqual([["Study", 360], ["Practice questions", 40]]);
  });

  it("keeps every dashboard widget relevant", () => {
    const noQuestions = dashboardFromChoices(choices({ tools: ["lectures", "anki"] }));
    expect(noQuestions.hiddenWidgetIds).toContain("questionBank");
    expect(noQuestions.hiddenWidgetIds).not.toContain("dailyWord");
    const premed = dashboardFromChoices(choices({ path: "premed", focus: "coursework" }));
    expect(premed.hiddenWidgetIds).toContain("courseTracker");
    expect(premed.hiddenWidgetIds).not.toContain("premedHours");
  });
});

describe("applySetup", () => {
  it("installs the SGU term and module map with no example rows", () => {
    applySetup(choices({ path: "sgu", focus: "term4", name: "Jafar" }), "first-run");
    const state = useStore.getState();
    expect(state.terms.map((term) => term.name)).toEqual(["Term 1", "Term 2", "Term 3", "Term 4", "Term 5", "Boards"]);
    const term4 = state.courses.find((course) => course.code === "PPM 500")!;
    expect(term4.modules.map((module) => module.name)).toEqual(["FTCM", "NCRS", "RHPS", "DERS", "BSCE 3"]);
    expect(state.tracker.some((row) => /^Example/.test(row.label))).toBe(false);
    expect(state.profile).toMatchObject({ name: "Jafar", onboarded: true, tourDone: true, educationTrack: "sgu", activeFocusId: "term4" });
  });

  it("gives other paths a clean tracker, never SGU courses", () => {
    applySetup(choices({ path: "usmd", focus: "clinical", tools: ["questions"] }), "first-run");
    const state = useStore.getState();
    expect(state.terms).toEqual([]);
    expect(state.courses).toEqual([]);
    expect(state.tracker.some((row) => row.path.startsWith("Term 1"))).toBe(false);
    expect(state.profile.educationTrack).toBe("usmd");
  });

  it("leaves structure and targets alone when setup is run again", () => {
    applySetup(choices({ path: "sgu" }), "first-run");
    const before = useStore.getState();
    applySetup(choices({ path: "usmd", focus: "boards", tools: ["uworld"] }), "rerun");
    const after = useStore.getState();
    expect(after.terms).toEqual(before.terms);
    expect(after.profile.dailySuccess).toEqual(before.profile.dailySuccess);
    expect(after.profile.educationTrack).toBe("usmd");
  });
});

describe("draft", () => {
  it("survives a refresh and drops anything it does not recognize", () => {
    writeSetupDraft(choices({ step: 1, path: "premed", focus: "mcat", tools: ["anki", "nonsense" as never] }));
    const restored = readSetupDraft(defaultChoices());
    expect(restored).toMatchObject({ step: 1, path: "premed", focus: "mcat", tools: ["anki"] });
  });
});
