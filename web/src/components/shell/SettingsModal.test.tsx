// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed, SCHEMA_VERSION } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { SettingsModal } from "./SettingsModal";

const storageValues = new Map<string, string>();
const storage = {
  get length() { return storageValues.size; },
  clear: () => storageValues.clear(),
  getItem: (key: string) => storageValues.get(key) ?? null,
  key: (index: number) => [...storageValues.keys()][index] ?? null,
  removeItem: (key: string) => { storageValues.delete(key); },
  setItem: (key: string, value: string) => { storageValues.set(key, String(value)); },
};

beforeEach(() => {
  vi.stubGlobal("localStorage", storage);
  localStorage.clear();
  useStore.setState(makeSeed());
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Settings information architecture", () => {
  it("edits method follow-ups without erasing other methods or kind defaults", () => {
    useStore.getState().updateProfile({ studyWorkflow: { configured: true, methods: [{ id: "noji", enabled: true, timing: "ongoing", usage: "My own recall cards" }], itemKindDefaults: { Lab: { lecturePasses: 3 } } } });
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Personalization" }));
    fireEvent.click(screen.getByRole("button", { name: "Anki" }));
    fireEvent.click(screen.getByRole("button", { name: "Noji" }));
    fireEvent.click(screen.getByRole("button", { name: "Noji" }));
    fireEvent.click(screen.getByText("How do you use Noji?"));
    fireEvent.change(screen.getByLabelText("Your Noji approach (optional)"), { target: { value: "  Exact revised words  " } });
    expect(useStore.getState().profile.studyWorkflow?.methods).toEqual(expect.arrayContaining([expect.objectContaining({ id: "noji", enabled: true, timing: "ongoing", usage: "  Exact revised words  " })]));
    expect(useStore.getState().profile.studyWorkflow?.itemKindDefaults?.Lab?.lecturePasses).toBe(3);
  });
  it("shows study-text suggestions without applying them and applies exactly one on confirmation", () => {
    const methods = [
      { id: "noji" as const, enabled: true, timing: "after-first-pass" as const, usage: "My recall cards", label: "Own deck" },
      { id: "quizlet" as const, enabled: false, usage: "Old sets" },
    ];
    useStore.getState().updateProfile({ studyWorkflow: { configured: true, methods, lecturePasses: 2, reviewAfterDays: 3, itemKindDefaults: { Lab: { lecturePasses: 3 } } } });
    render(<SettingsModal onClose={() => {}} initialTab="personalization" />);
    expect(screen.queryByText("Suggestions from your words")).toBeNull();
    expect(screen.getByText(/keeps this text exactly as written.*fixed word rules \(not AI\).*never applied automatically/)).toBeTruthy();

    const original = "Noji every day. I review a week later — I don't use Quizlet.";
    fireEvent.change(screen.getByLabelText("Other: tell AXOM how you study"), { target: { value: original } });
    const region = screen.getByRole("region", { name: "Suggestions from your words" });
    expect(region.textContent).toContain("You wrote “Noji every day”");
    expect(region.textContent).toContain("You wrote “review a week later”");
    expect(region.textContent).not.toContain("Quizlet");
    // Typing only saves the words; no setting changes until Apply.
    expect(useStore.getState().profile.studyWorkflow).toMatchObject({ methods, reviewAfterDays: 3, customContext: original });

    fireEvent.click(screen.getByRole("button", { name: "Apply: Use Noji throughout the course" }));
    const workflow = useStore.getState().profile.studyWorkflow!;
    expect(workflow.methods).toEqual([{ ...methods[0], timing: "ongoing" }, methods[1]]);
    expect(workflow).toMatchObject({ reviewAfterDays: 3, lecturePasses: 2, customContext: original, itemKindDefaults: { Lab: { lecturePasses: 3 } } });
    expect(screen.queryByRole("button", { name: "Apply: Use Noji throughout the course" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply all" })).toBeNull();
    expect(screen.getByRole("button", { name: "Apply: Review again after 7 days" })).toBeTruthy();
  });

  it("applies all suggestions at once, keeps the original text, and removes the list", () => {
    useStore.getState().updateProfile({ studyWorkflow: { configured: true, methods: [{ id: "anki", enabled: false, usage: "Own cards" }], lecturePasses: 2, reviewAfterDays: 3 } });
    render(<SettingsModal onClose={() => {}} initialTab="personalization" />);
    const original = "  Anki before exams, UWorld after lectures, and I rewatch lectures 3 times.  ";
    fireEvent.change(screen.getByLabelText("Other: tell AXOM how you study"), { target: { value: original } });
    fireEvent.click(screen.getByRole("button", { name: "Apply all" }));

    const workflow = useStore.getState().profile.studyWorkflow!;
    expect(workflow.customContext).toBe(original);
    expect(workflow.lecturePasses).toBe(3);
    expect(workflow.methods).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "anki", enabled: true, usage: "Own cards", timing: "near-exam" }),
      expect.objectContaining({ id: "practice-questions", enabled: true, timing: "after-first-pass" }),
      expect.objectContaining({ id: "lecture-passes", enabled: true }),
    ]));
    expect(screen.queryByText("Suggestions from your words")).toBeNull();
    expect(screen.getByRole("button", { name: "Anki" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Applied 6 suggestions.");
  });

  it("uses seven accessible sections with only the active tab owning its mounted panel", async () => {
    const user = userEvent.setup();
    render(<SettingsModal onClose={() => {}} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "Profile", "Account", "Appearance", "Personalization", "Data", "Emergency recovery", "Advanced",
    ]);
    for (const tab of tabs) {
      const controls = tab.getAttribute("aria-controls");
      if (controls) expect(document.getElementById(controls)).toBeTruthy();
    }
    expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Data" }).hasAttribute("aria-controls")).toBe(false);

    await user.click(screen.getByRole("tab", { name: "Data" }));
    const dataTab = screen.getByRole("tab", { name: "Data" });
    expect(document.getElementById(dataTab.getAttribute("aria-controls")!)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Profile" }).hasAttribute("aria-controls")).toBe(false);

    fireEvent.keyDown(dataTab, { key: "End" });
    expect(screen.getByRole("tab", { name: "Advanced" }).getAttribute("aria-selected")).toBe("true");
  });

  it("states accurate local-first semantics without promising a cloud account", async () => {
    const user = userEvent.setup();
    render(<SettingsModal onClose={() => {}} initialTab="data" />);
    expect(screen.getByText(/workspace lives on this device and saves as you work/i)).toBeTruthy();
    expect(screen.getByText(/If you sign in, protected copies/i)).toBeTruthy();
    expect(screen.queryByText(/your account is synced/i)).toBeNull();
    expect(screen.queryByText(/workspace follows you across devices/i)).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Appearance" }));
    expect(screen.getByText("Accent palette")).toBeTruthy();
  });

  it("presents portable backup actions once and keeps technical details in Advanced", async () => {
    const user = userEvent.setup();
    render(<SettingsModal onClose={() => {}} initialTab="backup" />);
    expect(screen.getAllByRole("button", { name: /export backup/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /import \/ restore/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /merge backup/i })).toHaveLength(1);
    expect(screen.getAllByText(/automatic local recovery snapshots/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(screen.getByDisplayValue(`v${SCHEMA_VERSION}`)).toBeTruthy();
    expect(screen.getByText(/AI and provider settings \(optional\)/i)).toBeTruthy();
    expect(screen.queryByText(/Cloud copy/i)).toBeNull();
  });

  it("keeps destructive reset confirmation-gated", async () => {
    const user = userEvent.setup();
    const reset = vi.spyOn(useStore.getState(), "resetToSeed");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SettingsModal onClose={() => {}} initialTab="advanced" />);
    await user.click(screen.getByRole("button", { name: /reset to starter data/i }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
  });

  it("keeps Daily Games persistent and retains its explicit history reset", () => {
    useStore.setState({
      dailyWordPuzzles: [{
        puzzleId: "daily-word:general-1:2026-07-12",
        puzzleDate: "2026-07-12",
        timezone: "America/Grenada",
        wordListVersion: "general-1",
        guesses: ["APPLE"],
        completed: false,
        won: false,
        startedAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:01:00.000Z",
      }],
    });
    render(<SettingsModal onClose={() => {}} initialTab="rhythm" />);

    expect(screen.queryByRole("checkbox", { name: "Enable Daily Games" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reset Daily Word" })).toBeTruthy();
    expect(useStore.getState().dailyWordPuzzles).toHaveLength(1);
  });

  it("persists clock controls and rejects an invalid custom timezone without replacing the last valid value", async () => {
    const user = userEvent.setup();
    useStore.setState((state) => ({
      profile: {
        ...state.profile,
        timeZonePreference: { mode: "custom", customTimezone: "America/Grenada" },
      },
    }));
    render(<SettingsModal onClose={() => {}} initialTab="rhythm" />);

    await user.click(screen.getByRole("checkbox", { name: "Digital seconds" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Hour cycle" }), "24");
    await user.click(screen.getByRole("checkbox", { name: "Show clock" }));
    expect(useStore.getState().profile.clockPreferences).toMatchObject({
      enabled: false,
      showDigitalSeconds: true,
      hourCycle: "24",
    });

    const input = screen.getByRole("textbox", { name: "Custom timezone" });
    await user.clear(input);
    await user.type(input, "Mars/Olympus");
    await user.click(screen.getByRole("button", { name: "Apply timezone" }));
    expect(screen.getByRole("alert").textContent).toMatch(/valid IANA timezone/i);
    expect(useStore.getState().profile.timeZonePreference).toEqual({
      mode: "custom",
      customTimezone: "America/Grenada",
    });

    await user.clear(input);
    await user.type(input, "America/New_York");
    await user.click(screen.getByRole("button", { name: "Apply timezone" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(useStore.getState().profile.timeZonePreference).toEqual({
      mode: "custom",
      customTimezone: "America/New_York",
    });
  });

  it("shows canonical daily-loop reminder defaults and persists personalized times and enablement", async () => {
    const user = userEvent.setup();
    useStore.setState((state) => ({
      profile: { ...state.profile, dailyLoopReminders: undefined },
    }));
    render(<SettingsModal onClose={() => {}} initialTab="rhythm" />);

    const checkInToggle = screen.getByRole("checkbox", { name: "Enable Daily Check-In" });
    const closeoutToggle = screen.getByRole("checkbox", { name: "Enable evening closeout" });
    const checkInTime = screen.getByLabelText("Daily Check-In time") as HTMLInputElement;
    const closeoutTime = screen.getByLabelText("Evening closeout time") as HTMLInputElement;
    const quietHoursToggle = screen.getByRole("checkbox", { name: "Enable quiet hours" });
    const quietHoursStart = screen.getByLabelText("Quiet hours start") as HTMLInputElement;
    const quietHoursEnd = screen.getByLabelText("Quiet hours end") as HTMLInputElement;

    expect((checkInToggle as HTMLInputElement).checked).toBe(true);
    expect((closeoutToggle as HTMLInputElement).checked).toBe(true);
    expect(checkInTime.value).toBe("08:00");
    expect(closeoutTime.value).toBe("20:30");
    expect((quietHoursToggle as HTMLInputElement).checked).toBe(false);
    expect(quietHoursStart.value).toBe("22:00");
    expect(quietHoursEnd.value).toBe("07:00");
    expect(quietHoursStart.disabled).toBe(true);
    expect(quietHoursEnd.disabled).toBe(true);
    expect(screen.getByText(/optional in-app prompts use this device's local time.*at most once per day/i)).toBeTruthy();

    fireEvent.change(checkInTime, { target: { value: "07:15" } });
    fireEvent.change(closeoutTime, { target: { value: "21:45" } });
    await user.click(quietHoursToggle);
    fireEvent.change(quietHoursStart, { target: { value: "23:15" } });
    fireEvent.change(quietHoursEnd, { target: { value: "06:30" } });
    await user.click(checkInToggle);
    await user.click(closeoutToggle);

    expect(useStore.getState().profile.dailyLoopReminders).toEqual({
      checkInEnabled: false,
      checkInTime: "07:15",
      closeoutEnabled: false,
      closeoutTime: "21:45",
      quietHoursEnabled: true,
      quietHoursStart: "23:15",
      quietHoursEnd: "06:30",
    });
    expect(checkInTime.disabled).toBe(true);
    expect(closeoutTime.disabled).toBe(true);
  });

  it("normalizes malformed persisted reminder preferences before editing", () => {
    useStore.setState((state) => ({
      profile: {
        ...state.profile,
        dailyLoopReminders: {
          checkInEnabled: false,
          checkInTime: "99:99",
          closeoutTime: "not-a-time",
          quietHoursEnabled: true,
          quietHoursStart: "25:00",
          quietHoursEnd: "sunrise",
        },
      },
    }));
    render(<SettingsModal onClose={() => {}} initialTab="rhythm" />);

    expect((screen.getByRole("checkbox", { name: "Enable Daily Check-In" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Enable evening closeout" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Daily Check-In time") as HTMLInputElement).value).toBe("08:00");
    expect((screen.getByLabelText("Evening closeout time") as HTMLInputElement).value).toBe("20:30");
    expect((screen.getByRole("checkbox", { name: "Enable quiet hours" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Quiet hours start") as HTMLInputElement).value).toBe("22:00");
    expect((screen.getByLabelText("Quiet hours end") as HTMLInputElement).value).toBe("07:00");
  });

  it("confirmation-gates the scoped Daily Word reset without changing enablement or unrelated data", async () => {
    const user = userEvent.setup();
    useStore.setState((state) => ({
      profile: {
        ...state.profile,
        experimentalFlags: { ...state.profile.experimentalFlags, dailyGames: true },
      },
      dailyWordPuzzles: [{
        puzzleId: "daily-word:general-1:2026-07-12",
        puzzleDate: "2026-07-12",
        timezone: "America/Grenada",
        wordListVersion: "general-1",
        guesses: ["APPLE"],
        completed: false,
        won: false,
        startedAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:01:00.000Z",
      }],
    }));
    const tasks = structuredClone(useStore.getState().tasks);
    const confirm = vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<SettingsModal onClose={() => {}} initialTab="rhythm" />);

    const reset = screen.getByRole("button", { name: "Reset Daily Word" });
    await user.click(reset);
    expect(useStore.getState().dailyWordPuzzles).toHaveLength(1);

    await user.click(reset);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(useStore.getState().dailyWordPuzzles).toEqual([]);
    expect(useStore.getState().profile.experimentalFlags?.dailyGames).toBe(true);
    expect(useStore.getState().tasks).toEqual(tasks);
  });

  it("opens Personalization on Study style and switches sub-sections without losing the tab", async () => {
    const user = userEvent.setup();
    render(<SettingsModal onClose={() => {}} initialTab="personalization" />);
    expect(screen.getByText("Passes & review timing")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Daily rhythm/ }));
    expect(screen.getByRole("checkbox", { name: "Enable lock-in check-ins" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Program & lanes/ }));
    expect(screen.getByText("Focus lanes")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Personalization" }).getAttribute("aria-selected")).toBe("true");
  });

  it("enables lock-in check-ins with a chosen interval, scope, and voice", async () => {
    const user = userEvent.setup();
    render(<SettingsModal onClose={() => {}} initialTab="rhythm" />);
    await user.click(screen.getByRole("checkbox", { name: "Enable lock-in check-ins" }));
    await user.click(screen.getByRole("button", { name: "45 min" }));
    await user.click(screen.getByRole("radio", { name: /Whenever AXOM is open/ }));
    await user.click(screen.getByRole("radio", { name: /Intense/ }));
    expect(useStore.getState().profile.focusCheckIn).toMatchObject({ enabled: true, intervalMinutes: 45, scope: "anytime", tone: "intense" });
  });

  it("applies an accent palette from Appearance and keeps it device-only", async () => {
    const user = userEvent.setup();
    render(<SettingsModal onClose={() => {}} initialTab="appearance" />);
    await user.click(screen.getByRole("radio", { name: /Amethyst/ }));
    expect(document.documentElement.dataset.palette).toBe("amethyst");
    expect(JSON.parse(localStorage.getItem("axom.palette.v1")!).id).toBe("amethyst");
    expect(JSON.stringify(useStore.getState().profile)).not.toContain("amethyst");
    await user.click(screen.getByRole("radio", { name: /AXOM Classic/ }));
    expect(document.documentElement.dataset.palette).toBeUndefined();
  });

  it("shows the profile header with program facts and an account entry point", () => {
    useStore.getState().updateProfile({ name: "Jafar", tagline: "One honest block." });
    render(<SettingsModal onClose={() => {}} />);
    expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("Jafar");
    expect(screen.getByText("Where you are")).toBeTruthy();
    expect(screen.getByText("Local profile on this device")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About accounts" }));
    expect(screen.getByRole("tab", { name: "Account" }).getAttribute("aria-selected")).toBe("true");
  });

  it("records restores in a device-only restore history", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsModal onClose={() => {}} initialTab="advanced" />);
    await user.click(screen.getByRole("button", { name: /reset to starter data/i }));
    await user.click(screen.getByRole("tab", { name: "Emergency recovery" }));
    expect(screen.getByText("Reset to starter data", { selector: "b" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Backup status" })).toBeTruthy();
  });
});
