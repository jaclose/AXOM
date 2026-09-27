// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportStateWithAttachments } from "../../lib/backup";
import { evaluateDailySuccess } from "../../lib/dailySuccess";
import { localDateKey } from "../../lib/dailyRollover";
import { ONBOARDING_DRAFT_KEY } from "../../lib/onboardingProgress";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { OnboardingWizard } from "./OnboardingWizard";

vi.mock("../../lib/backup", () => ({ exportStateWithAttachments: vi.fn(() => Promise.resolve({ attachmentCount: 0, missingBlobKeys: [] })) }));

const sessionValues = new Map<string, string>();
const memorySession = {
  get length() { return sessionValues.size; },
  clear: () => sessionValues.clear(),
  getItem: (key: string) => sessionValues.get(key) ?? null,
  key: (index: number) => [...sessionValues.keys()][index] ?? null,
  removeItem: (key: string) => { sessionValues.delete(key); },
  setItem: (key: string, value: string) => { sessionValues.set(key, String(value)); },
};

beforeEach(() => {
  vi.stubGlobal("sessionStorage", memorySession);
  sessionStorage.clear();
  useStore.setState(makeSeed());
  useStore.getState().updateProfile({ onboarded: false, tourDone: undefined });
  vi.mocked(exportStateWithAttachments).mockClear();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

function continueSetup(count = 1) {
  for (let index = 0; index < count; index += 1) {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  }
}

describe("OnboardingWizard", () => {
  it("presents exactly four accessible, optional setup steps", () => {
    render(<OnboardingWizard mode="first-run" />);

    expect(screen.getByRole("dialog", { name: "Identity" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("list", { name: "Setup progress" }).querySelector('[aria-current="step"]')?.textContent).toContain("Identity");
    expect(screen.getByRole("heading", { name: "Build your study workspace" })).toBeTruthy();
    expect(screen.getByLabelText("Display name (optional)")).toBeTruthy();
    expect(screen.getByLabelText("Study path")).toBeTruthy();
    expect(screen.getByLabelText("Current stage")).toBeTruthy();
    expect(screen.getByLabelText("Current focus")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Display name (optional)"));
    expect(screen.getByText(/will prepare:/i)).toBeTruthy();
    expect(document.querySelector(".onboarding-body [tabindex='-1']")).toBeNull();

    continueSetup();
    expect(screen.getByRole("dialog", { name: "Core setup" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Choose where to begin" })).toBeTruthy();
    expect(screen.queryByLabelText("First course (optional)")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Build my courses/));
    expect(screen.getByLabelText("First course (optional)")).toBeTruthy();
    expect(screen.getByLabelText(/Import practice questions/)).toBeTruthy();
    expect(screen.getByText("What should make today count?")).toBeTruthy();
    expect(screen.getByLabelText(/Focused study/)).toBeTruthy();
    expect(screen.getByLabelText(/Practice questions/)).toBeTruthy();
    expect(screen.getByLabelText(/Daily closeout/)).toBeTruthy();

    continueSetup();
    expect(screen.getByRole("dialog", { name: "Workspace" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Dashboard widgets" })).toBeTruthy();
    expect(screen.getByText("No AI provider is required.", { exact: false })).toBeTruthy();

    continueSetup();
    expect(screen.getByRole("dialog", { name: "Data safety" })).toBeTruthy();
    expect(screen.getByText("Current workspace")).toBeTruthy();
    expect(screen.getByText("Recovery saves")).toBeTruthy();
    expect(screen.getByText("Portable save file")).toBeTruthy();
    expect(screen.getByText("How saving works")).toBeTruthy();
    expect(screen.getByText("Technical details")).toBeTruthy();
    expect(screen.queryByText(/cloud account/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Finish and create save file/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Finish setup/ })).toBeTruthy();
  });

  it("offers inclusive medical stages and optional non-Anki requirements without duplication", () => {
    render(<OnboardingWizard mode="first-run" />);
    const path = screen.getByLabelText("Study path") as HTMLSelectElement;
    fireEvent.change(path, { target: { value: "usmd" } });
    const stage = screen.getByLabelText("Current stage") as HTMLSelectElement;
    expect([...stage.options].map((option) => option.text)).toEqual([
      "Pre-clinical",
      "Clinical rotations",
      "Dedicated board preparation",
      "Residency application",
      "Other / Custom",
    ]);
    fireEvent.change(path, { target: { value: "do" } });
    expect([...stage.options].map((option) => option.text)).toContain("Pre-clinical");
    fireEvent.change(stage, { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Your stage (optional)"), { target: { value: "Research year" } });

    continueSetup();
    expect(screen.queryByText(/Anki/, { selector: "label" })).toBeNull();
    fireEvent.click(screen.getByLabelText(/Focused study/));
    fireEvent.click(screen.getByLabelText(/Daily closeout/));
    continueSetup(2);
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    const profile = useStore.getState().profile;
    expect(profile).toMatchObject({
      educationTrack: "do",
      academicStageId: "other",
      customAcademicStage: "Research year",
    });
    expect(profile.dailySuccess?.requirements.map((item) => item.id)).toEqual([
      "onboarding-study-minutes-v1",
      "onboarding-closeout-v1",
    ]);

    cleanup();
    render(<OnboardingWizard mode="rerun" />);
    continueSetup(3);
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(useStore.getState().profile.dailySuccess?.requirements).toHaveLength(2);
  });

  it("records an explicit empty configuration when a first run selects no requirements", () => {
    render(<OnboardingWizard mode="first-run" />);
    continueSetup(3);
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    const profile = useStore.getState().profile;
    // A new profile is explicitly configured as "nothing selected" — it must not
    // fall back to the legacy minutes+cards defaults (no Anki by default).
    expect(profile.dailySuccess).toBeDefined();
    expect(profile.dailySuccess?.requirements).toEqual([]);
    expect(profile.name).toBe("");
    const evaluated = evaluateDailySuccess({ ...useStore.getState(), activeDayKey: localDateKey() });
    expect(evaluated.status).toBe("neutral");
    expect(evaluated.statusLabel).toBe("No requirements selected");
    expect(evaluated.requirements.some((item) => item.requirement.source.kind === "cards-reviewed")).toBe(false);
  });

  it("can start with practice questions without forcing any other target", () => {
    render(<OnboardingWizard mode="first-run" />);
    continueSetup();
    fireEvent.click(screen.getByLabelText(/Practice questions/));
    continueSetup(2);
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    expect(useStore.getState().profile.dailySuccess?.requirements).toEqual([
      expect.objectContaining({
        id: "onboarding-practice-questions-v1",
        label: "Practice questions",
        source: { kind: "practice-questions" },
        target: 20,
      }),
    ]);
  });

  it("sanely resumes the current step and draft after reload", async () => {
    const first = render(<OnboardingWizard mode="first-run" />);
    fireEvent.change(screen.getByLabelText("Display name (optional)"), { target: { value: "Ada" } });
    continueSetup();
    fireEvent.click(screen.getByLabelText(/Build my courses/));
    fireEvent.change(screen.getByLabelText("First course (optional)"), { target: { value: "Cardiology" } });

    await waitFor(() => expect(sessionStorage.getItem(ONBOARDING_DRAFT_KEY)).toContain("Cardiology"));
    first.unmount();
    render(<OnboardingWizard mode="first-run" />);

    expect(screen.getByRole("dialog", { name: "Core setup" })).toBeTruthy();
    expect((screen.getByLabelText("First course (optional)") as HTMLInputElement).value).toBe("Cardiology");
  });

  it("applies existing track defaults, adds an optional course, and routes explicitly", () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard mode="first-run" onComplete={onComplete} />);
    fireEvent.change(screen.getByLabelText("Display name (optional)"), { target: { value: "Ada" } });
    continueSetup();
    fireEvent.click(screen.getByLabelText(/Build my courses/));
    fireEvent.change(screen.getByLabelText("First course (optional)"), { target: { value: "Cardiology" } });
    fireEvent.click(screen.getByLabelText(/Import practice questions/));
    continueSetup();
    fireEvent.click(screen.getByLabelText(/Expanded/));
    continueSetup();
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    const state = useStore.getState();
    expect(state.profile).toMatchObject({
      name: "Ada",
      onboarded: true,
      tourDone: true,
      hiddenDashboardWidgets: [],
      educationTrack: "sgu",
      activeFocusId: "term1",
    });
    expect(state.courses.some((course) => course.code === "Cardiology")).toBe(true);
    expect(onComplete).toHaveBeenCalledWith("questions");
    expect(sessionStorage.getItem(ONBOARDING_DRAFT_KEY)).toBeNull();
    expect(exportStateWithAttachments).not.toHaveBeenCalled();
  });

  it("never seeds or replaces course structure during a rerun", () => {
    const state = useStore.getState();
    state.updateProfile({
      onboarded: true,
      name: "Existing user",
      tagline: "Keep my goal",
      dailyMinuteTarget: 137,
      hiddenDashboardWidgets: ["schedule"],
    });
    useStore.setState({
      terms: [{ id: "custom-term", name: "My term" }],
      courses: [{ id: "custom-course", termId: "custom-term", code: "KEEP 101", name: "Keep me", files: 0, modules: [] }],
      tracker: [],
    });
    const onComplete = vi.fn();
    render(<OnboardingWizard mode="rerun" onComplete={onComplete} />);
    continueSetup(3);
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    expect(useStore.getState().courses).toEqual([
      expect.objectContaining({ id: "custom-course", code: "KEEP 101", name: "Keep me" }),
    ]);
    expect(useStore.getState().terms).toEqual([{ id: "custom-term", name: "My term" }]);
    expect(useStore.getState().profile).toMatchObject({
      tagline: "Keep my goal",
      dailyMinuteTarget: 137,
      hiddenDashboardWidgets: ["schedule"],
    });
    expect(onComplete).toHaveBeenCalledWith("dashboard");
  });

  it("resumes all study methods and exact original text, and preserves overrides on finish", async () => {
    const original = "  My original approach.\n".repeat(40);
    useStore.getState().updateProfile({ studyWorkflow: { configured: true,
      methods: [{ id: "noji", enabled: true, timing: "after-first-pass", usage: original }, { id: "quizlet", enabled: true, label: "Own sets" }],
      lecturePasses: 4, reviewAfterDays: 6, customContext: original,
      itemKindDefaults: { Lab: { lecturePasses: 3 } },
    } });
    const first = render(<OnboardingWizard mode="rerun" />);
    continueSetup();
    fireEvent.click(screen.getByText("How do you usually study? (optional)"));
    expect((screen.getByLabelText("Noji", { exact: true }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Anki", { exact: true }));
    fireEvent.click(screen.getByText("How do you use Anki?"));
    fireEvent.change(screen.getByLabelText("When do you use Anki?"), { target: { value: "ongoing" } });
    fireEvent.change(screen.getByLabelText("Your Anki approach (optional)"), { target: { value: "  My own cards\nNot a premade deck.  " } });
    await waitFor(() => expect(sessionStorage.getItem(ONBOARDING_DRAFT_KEY)).toContain("Not a premade deck."));
    first.unmount();
    render(<OnboardingWizard mode="rerun" />);
    expect(screen.getByRole("dialog", { name: "Core setup" })).toBeTruthy();
    continueSetup(2);
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(useStore.getState().profile.studyWorkflow).toMatchObject({ lecturePasses: 4, reviewAfterDays: 6, customContext: original, itemKindDefaults: { Lab: { lecturePasses: 3 } } });
    expect(useStore.getState().profile.studyWorkflow?.methods).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "noji", enabled: true, timing: "after-first-pass", usage: original }),
      expect.objectContaining({ id: "quizlet", enabled: true, label: "Own sets" }),
      expect.objectContaining({ id: "anki", timing: "ongoing", usage: "  My own cards\nNot a premade deck.  " }),
    ]));
  });

  it("clearly confirms removing all study methods without deleting their original descriptions", () => {
    useStore.getState().updateProfile({ studyWorkflow: { configured: true, methods: [{ id: "anki", enabled: true, usage: "My own cards" }] } });
    render(<OnboardingWizard mode="rerun" />);
    continueSetup();
    fireEvent.click(screen.getByText("How do you usually study? (optional)"));
    fireEvent.click(screen.getByLabelText("Anki", { exact: true }));
    continueSetup(2);
    expect(screen.getByText("No methods selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(useStore.getState().profile.studyWorkflow?.methods).toContainEqual(expect.objectContaining({ id: "anki", enabled: false, usage: "My own cards" }));
  });

  it("previews deterministic suggestions from the learner's words and applies only the confirmed one", () => {
    useStore.getState().updateProfile({ studyWorkflow: { configured: true, lecturePasses: 2, reviewAfterDays: 3,
      methods: [{ id: "noji", enabled: true, timing: "after-first-pass", usage: "My Noji words" }, { id: "anki", enabled: false, label: "Own deck", usage: "Old Anki cards" }],
    } });
    const before = structuredClone(useStore.getState().profile.studyWorkflow);
    render(<OnboardingWizard mode="rerun" />);
    continueSetup();
    fireEvent.click(screen.getByText("How do you usually study? (optional)"));
    expect(screen.queryByText("Suggestions from your words")).toBeNull();
    expect(screen.getByText(/fixed word rules \(not AI\).*never applied automatically/)).toBeTruthy();

    const original = "  I use Anki every day.\nI watch lectures three times.  ";
    fireEvent.change(screen.getByLabelText("Other — tell AXOM how you study"), { target: { value: original } });
    const suggestions = screen.getByRole("region", { name: "Suggestions from your words" });
    expect(suggestions.textContent).toContain("You wrote “Anki”");
    expect(screen.getByRole("button", { name: "Apply: Turn on Anki" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply: Use Anki throughout the course" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply: Set usual lecture passes to 3" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply all" })).toBeTruthy();
    // Showing suggestions changes nothing.
    expect((screen.getByLabelText("Anki", { exact: true }) as HTMLInputElement).checked).toBe(false);
    expect(useStore.getState().profile.studyWorkflow).toEqual(before);

    fireEvent.click(screen.getByRole("button", { name: "Apply: Turn on Anki" }));
    expect((screen.getByLabelText("Anki", { exact: true }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("button", { name: "Apply: Turn on Anki" })).toBeNull();
    expect(screen.getByRole("button", { name: "Apply: Use Anki throughout the course" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply: Use Anki throughout the course" }));
    expect(screen.getByRole("status").textContent).toBe("Applied: Turn on Anki.");
    expect((screen.getByLabelText("Other — tell AXOM how you study") as HTMLTextAreaElement).value).toBe(original);
    expect(screen.getByRole("button", { name: "Apply: Set usual lecture passes to 3" })).toBeTruthy();
    expect((screen.getByLabelText("Lecture passes", { exact: true }) as HTMLInputElement).checked).toBe(false);

    continueSetup(2);
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    const saved = useStore.getState().profile.studyWorkflow!;
    expect(saved).toMatchObject({ customContext: original, lecturePasses: 2, reviewAfterDays: 3 });
    expect(saved.methods).toContainEqual({ id: "anki", enabled: true, label: "Own deck", usage: "Old Anki cards" });
    expect(saved.methods).toContainEqual(expect.objectContaining({ id: "noji", enabled: true, timing: "after-first-pass", usage: "My Noji words" }));
  });

  it("skips first-run setup without applying track changes and cancels reruns without changing profile data", () => {
    const firstComplete = vi.fn();
    render(<OnboardingWizard mode="first-run" onComplete={firstComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));
    expect(useStore.getState().profile).toMatchObject({ onboarded: true, tourDone: true });
    expect(firstComplete).toHaveBeenCalledWith("dashboard");

    cleanup();
    const originalName = useStore.getState().profile.name;
    const onCancel = vi.fn();
    render(<OnboardingWizard mode="rerun" onCancel={onCancel} />);
    fireEvent.change(screen.getByLabelText("Display name (optional)"), { target: { value: "Not saved" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(useStore.getState().profile.name).toBe(originalName);
  });

  it("exports a real post-setup snapshot only when explicitly requested", () => {
    render(<OnboardingWizard mode="first-run" />);
    continueSetup(3);
    fireEvent.click(screen.getByRole("button", { name: /Finish and create save file/ }));

    expect(exportStateWithAttachments).toHaveBeenCalledOnce();
    expect(vi.mocked(exportStateWithAttachments).mock.calls[0][0].profile.onboarded).toBe(true);
  });
});
