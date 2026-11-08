// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { useUi } from "../lib/uiStore";
import { dayKey } from "../lib/scoring";
import { localDateKey } from "../lib/dailyRollover";
import type { JournalImageAttachment } from "../lib/journalNotebook";
import * as journalNotebook from "../lib/journalNotebook";
import { normalizeStudyStreaks, studyCreditsBalance } from "../lib/studyStreaks";
import * as localVault from "../lib/localVault";
import * as journalFeedback from "../lib/journalFeedback";
import { useAccount } from "../lib/account/accountStore";
import { JournalPage } from "./JournalPage";
import { useSoundscape } from "../lib/soundscapes/store";
import { usePomodoro } from "../lib/pomodoro";

// Derive dates exactly the way the app does — hard-coded calendar dates made
// this suite expire two days after it was written (found 2026-07-15).
const TODAY_KEY = dayKey();
const LOCAL_TODAY = localDateKey();
function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
const YESTERDAY_KEY = shiftKey(TODAY_KEY, -1);

const localImage: JournalImageAttachment = {
  id: "local-image",
  name: "study-desk.png",
  type: "image/png",
  size: 4,
  createdAt: "2026-07-13T12:00:00.000Z",
  dataUrl: "data:image/png;base64,YXhvbQ==",
};

beforeEach(() => {
  useStore.setState({
    ...makeSeed(),
    activeDayKey: TODAY_KEY,
    lastActiveLocalDate: LOCAL_TODAY,
    dayPlans: [],
    logs: [],
    tasks: [],
    journal: [{
      id: "yesterday",
      date: `${YESTERDAY_KEY}T12:00:00`,
      today: "Yesterday was grounded.",
      tomorrow: "Continue.",
      blockers: "",
      energy: "Medium",
      rating: "Useful",
    }],
  });
  useStore.setState((state) => ({ profile: { ...state.profile, journalNotebook: { ...journalNotebook.DEFAULT_JOURNAL_NOTEBOOK, setupCompleted: true } } }));
  useUi.setState({ journalDay: null, settingsRequest: null });
  useAccount.setState({ link: "unlinked", protection: "local-only", syncFailure: undefined });
  usePomodoro.setState({ running: false, focusRunStarted: false, secondsLeft: 1500, phase: "focus" });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#journal");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openTodayInFullPage() {
  fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
  fireEvent.click(screen.getByRole("button", { name: "Write full page" }));
}

describe("Journal notebook foundation", () => {
  it("opens the MacBook for a real timer or recorded progress and closes it with no evidence", () => {
    useStore.setState({ tracker: [], questions: [], tasks: [], sessions: [] });
    render(<JournalPage />);
    expect(screen.getByLabelText("Closed MacBook")).toBeTruthy();

    act(() => { usePomodoro.setState({ running: true, secondsLeft: 1460, phase: "focus", targetLabel: "Renal physiology" }); });
    expect(screen.getByLabelText("MacBook showing focus timer 24:20")).toBeTruthy();
    expect(screen.getByText("24:20")).toBeTruthy();

    act(() => { usePomodoro.setState({ running: false, focusRunStarted: false }); });
    expect(screen.getByLabelText("Closed MacBook")).toBeTruthy();
    const trackerItem = makeSeed().tracker[0];
    act(() => { useStore.setState({ tracker: [{ ...trackerItem, id: "desk-progress", label: "Cardiology lecture", passEvents: [{ id: "pass-1", method: "study", at: new Date().toISOString() }] }] }); });
    expect(screen.getByLabelText("MacBook showing recent progress: Cardiology lecture marked.")).toBeTruthy();
    expect(screen.getByText("Cardiology lecture marked.")).toBeTruthy();
  });

  it("learns first-open writing and lighting choices", () => {
    const profile = useStore.getState().profile;
    useStore.setState({ journal: [], profile: { ...profile, journalNotebook: undefined } as typeof profile });
    render(<JournalPage />);
    expect(screen.getByRole("dialog", { name: "Make this notebook yours" })).toBeTruthy();
    expect(within(screen.getByRole("dialog", { name: "Make this notebook yours" })).getByRole("button", { name: /Open pageStart in your own words/i }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Find focus" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Make this notebook yours" })).getByRole("button", { name: /Open pageStart in your own words/i }));
    fireEvent.click(screen.getByRole("button", { name: "Rain" }));
    fireEvent.change(screen.getByLabelText("What should we call your notebook?"), { target: { value: "Rounds & Margins" } });
    fireEvent.change(screen.getByLabelText("Offer it around"), { target: { value: "21:15" } });
    fireEvent.click(screen.getByRole("button", { name: "Begin at my desk" }));
    expect((useStore.getState().profile as typeof profile & { journalNotebook?: { purpose: string; writingMode: string; weather: string; setupCompleted: boolean } }).journalNotebook)
      .toMatchObject({ title: "Rounds & Margins", purpose: "focus", writingMode: "free", weather: "rain", setupCompleted: true });
    expect(useStore.getState().profile.dailyLoopReminders).toMatchObject({ closeoutEnabled: true, closeoutTime: "21:15" });
  });

  it("writes on the desk page and carries the same draft into full zoom", () => {
    vi.useFakeTimers();
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    fireEvent.change(screen.getByLabelText("Write freely at your desk"), { target: { value: "A quiet start" } });
    fireEvent.click(screen.getByRole("button", { name: "Write full page" }));
    expect(screen.getByRole("button", { name: "Put down on desk" })).toBeTruthy();
    expect((screen.getByLabelText("Free writing") as HTMLTextAreaElement).value).toBe("A quiet start");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Today’s page" }));
    fireEvent.click(screen.getByRole("button", { name: "Put down on desk" }));
    expect(screen.queryByRole("dialog", { name: "Full journal" })).toBeNull();
    expect(screen.getByLabelText("Journal notebook").className).toContain("is-settling");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your open page" }));
    fireEvent.click(screen.getByRole("button", { name: "Write full page" }));
    expect(screen.getByRole("dialog", { name: "Full journal" }).className).not.toContain("is-settling");
    act(() => { vi.advanceTimersByTime(760); });
    expect(screen.getByRole("dialog", { name: "Full journal" })).toBeTruthy();
  });

  it("does not close the desk with a late unsaved edit after storage rejects the write", async () => {
    vi.useFakeTimers();
    const saveCheck = vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => {
      throw new Error("Simulated storage write failure");
    });
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    fireEvent.click(screen.getByRole("button", { name: "Put book down" }));
    expect(screen.getByRole("region", { name: "Write at your desk" }).className).toContain("is-closing");

    // The delayed 900ms animation must not bypass durability when a late
    // input/composition event updates the page after the initial save gate.
    const text = "This late line must not disappear when storage fails.";
    fireEvent.change(screen.getByLabelText("Write freely at your desk"), { target: { value: text } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    const desk = screen.getByRole("region", { name: "Write at your desk" });
    expect(desk.className).not.toContain("is-closing");
    expect((within(desk).getByLabelText("Write freely at your desk") as HTMLTextAreaElement).value).toBe(text);
    expect(within(desk).getByText("Your changes need saving")).toBeTruthy();
    expect(within(desk).getByRole("button", { name: "Retry save" })).toBeTruthy();

    saveCheck.mockImplementation(() => undefined);
    fireEvent.click(within(desk).getByRole("button", { name: "Retry save" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(within(desk).getByText("Page saved locally")).toBeTruthy();
    const entry = useStore.getState().journal.find((item) => dayKey(new Date(item.date)) === TODAY_KEY);
    expect(entry?.freeWriting).toBe(text);
  });

  it("keeps the writing page open when keyboard focus reopens it during desk close", async () => {
    vi.useFakeTimers();
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    fireEvent.click(screen.getByRole("button", { name: "Put book down" }));
    expect(screen.getByRole("region", { name: "Write at your desk" }).className).toContain("is-closing");

    // Pointer events on the closing book are disabled in CSS, but a focused
    // button remains keyboard-activatable during the 900ms animation.
    const reopen = screen.getByRole("button", { name: "Write full page" });
    reopen.focus();
    fireEvent.click(reopen);
    expect(screen.getByRole("dialog", { name: "Full journal" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Continue writing after reopening." } });

    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(screen.getByRole("dialog", { name: "Full journal" })).toBeTruthy();
    expect((screen.getByLabelText("Free writing") as HTMLTextAreaElement).value)
      .toBe("Continue writing after reopening.");
  });

  it("does not close a reopened full page after the final desk save finishes", async () => {
    vi.useFakeTimers();
    let releaseFlush: (() => void) | undefined;
    const flushWrite = vi.spyOn(localVault, "flushLocalVaultWrites").mockImplementation(
      () => new Promise<void>((resolve) => { releaseFlush = resolve; }),
    );
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    fireEvent.click(screen.getByRole("button", { name: "Put book down" }));

    // First gate was clean; a late edit needs a second vault check.
    await act(async () => { await vi.advanceTimersByTimeAsync(850); });
    const writing = "Keep this line even when a late save finishes after reopening.";
    fireEvent.change(screen.getByLabelText("Write freely at your desk"), { target: { value: writing } });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(flushWrite).toHaveBeenCalledTimes(1);
    expect(releaseFlush).toBeTypeOf("function");

    // The timer already fired. Its pending Promise can still call onClose.
    const reopen = screen.getByRole("button", { name: "Write full page" });
    reopen.focus();
    fireEvent.click(reopen);
    expect(screen.getByRole("dialog", { name: "Full journal" })).toBeTruthy();

    await act(async () => { releaseFlush?.(); await Promise.resolve(); });
    expect(screen.getByRole("dialog", { name: "Full journal" })).toBeTruthy();
    expect((screen.getByLabelText("Free writing") as HTMLTextAreaElement).value).toBe(writing);
    fireEvent.click(screen.getByRole("button", { name: "Put down on desk" }));
    expect(screen.getByRole("region", { name: "Write at your desk" }).className).not.toContain("is-closing");
  });

  it("keeps support options and writing open when a safety signal interrupts desk close", async () => {
    vi.useFakeTimers();
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    fireEvent.click(screen.getByRole("button", { name: "Put book down" }));
    expect(screen.getByRole("region", { name: "Write at your desk" }).className).toContain("is-closing");

    // A local first-person support signal opens the full page automatically.
    // The previously started close must not dismiss the support options or draft.
    const writing = "I can't keep living";
    fireEvent.change(screen.getByLabelText("Write freely at your desk"), { target: { value: writing } });
    expect(screen.getByRole("dialog", { name: "Full journal" })).toBeTruthy();
    expect(screen.getByText("Support options")).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(screen.getByRole("dialog", { name: "Full journal" })).toBeTruthy();
    expect(screen.getByText("Support options")).toBeTruthy();
    expect((screen.getByLabelText("Free writing") as HTMLTextAreaElement).value).toBe(writing);
  });

  it("offers an explicit put-down and closes when the surrounding desk is clicked", async () => {
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    const desk = screen.getByRole("region", { name: "Write at your desk" });
    expect(within(desk).getByRole("button", { name: "Put book down" })).toBeTruthy();
    fireEvent.change(within(desk).getByLabelText("Write freely at your desk"), { target: { value: "A useful moment." } });
    fireEvent.click(within(desk).getByLabelText("Write freely at your desk"));
    expect(screen.getByRole("region", { name: "Write at your desk" })).toBeTruthy();
    fireEvent.click(desk);
    await waitFor(() => expect(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i })).toBeTruthy(), { timeout: 2500 });
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    expect((screen.getByLabelText("Write freely at your desk") as HTMLTextAreaElement).value).toBe("A useful moment.");
    fireEvent.click(screen.getByRole("button", { name: "Put book down" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i })).toBeTruthy(), { timeout: 2500 });
  });

  it("folds the idle desk book away after 4.4 seconds but stays open when writing begins", async () => {
    vi.useFakeTimers();
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    act(() => { vi.advanceTimersByTime(4400); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("region", { name: "Write at your desk" }).className).toContain("is-closing");
    act(() => { vi.advanceTimersByTime(900); });
    expect(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    fireEvent.focus(screen.getByLabelText("Write freely at your desk"));
    act(() => { vi.advanceTimersByTime(5400); });
    expect(screen.getByRole("region", { name: "Write at your desk" })).toBeTruthy();
  });

  it("shows visual keepsakes and cycles the ambient desk scene", () => {
    render(<JournalPage />);
    expect(screen.getByLabelText(/AXOM Credits available/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next desk scene" }));
    expect(screen.getByText("Cloud cover")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause changing desk scene" }));
    expect(screen.getByRole("button", { name: "Resume changing desk scene" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Personalize" }));
    const menu = screen.getByRole("dialog", { name: "Personalize your journal" });
    fireEvent.change(within(menu).getByLabelText("Listening setup"), { target: { value: "beats" } });
    expect(menu.querySelector(".journal-preview-scene.headphones-beats")).toBeTruthy();
    fireEvent.click(within(menu).getByRole("button", { name: "Keepsakes" }));
    expect(within(menu).getByRole("img", { name: "Copper cover preview" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("button", { name: "Preview Copper cover" }));
    expect(within(menu).getByText("Previewing Copper cover")).toBeTruthy();
  });

  it("stages a keepsake purchase until save, then keeps ownership and deducts credits", () => {
    useStore.setState((state) => {
      const ledger = normalizeStudyStreaks(undefined, TODAY_KEY);
      ledger.productivity.creditedDays = [YESTERDAY_KEY, TODAY_KEY];
      return { sessions: [], profile: { ...state.profile, studyStreaks: ledger } };
    });
    render(<JournalPage />);
    expect(studyCreditsBalance(useStore.getState())).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Personalize" }));
    let menu = screen.getByRole("dialog", { name: "Personalize your journal" });
    fireEvent.click(within(menu).getByRole("button", { name: "Keepsakes" }));
    fireEvent.click(within(menu).getByRole("button", { name: "Preview Copper cover" }));
    fireEvent.click(within(menu).getAllByRole("button", { name: "Unlock · 2 AC" })[0]);
    expect(within(menu).getByText("0 AXOM Credits")).toBeTruthy();
    expect(useStore.getState().profile.journalNotebook?.unlockedStyles).not.toContain("copper");
    fireEvent.click(within(menu).getByRole("button", { name: "Cancel" }));
    expect(studyCreditsBalance(useStore.getState())).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Personalize" }));
    menu = screen.getByRole("dialog", { name: "Personalize your journal" });
    fireEvent.click(within(menu).getByRole("button", { name: "Keepsakes" }));
    fireEvent.click(within(menu).getAllByRole("button", { name: "Unlock · 2 AC" })[0]);
    fireEvent.click(within(menu).getByRole("button", { name: "Save changes" }));
    expect(useStore.getState().profile.journalNotebook?.unlockedStyles).toContain("copper");
    expect(studyCreditsBalance(useStore.getState())).toBe(0);
    cleanup();
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Personalize" }));
    menu = screen.getByRole("dialog", { name: "Personalize your journal" });
    fireEvent.click(within(menu).getByRole("button", { name: "Keepsakes" }));
    expect(within(menu).getByRole("button", { name: "Owned" })).toBeTruthy();
    expect(within(menu).getByText("0 AXOM Credits")).toBeTruthy();
  });

  it("keeps the Open page choice when returning from zoom to a guided desk", () => {
    vi.useFakeTimers();
    const profile = useStore.getState().profile;
    useStore.setState({ profile: { ...profile, journalNotebook: {
      ...journalNotebook.DEFAULT_JOURNAL_NOTEBOOK, writingMode: "guided", setupCompleted: true,
    } } as typeof profile });
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    const desk = screen.getByRole("region", { name: "Write at your desk" });
    expect(within(desk).getByText("Keep what mattered. Let the rest be unfinished.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Write full page" }));
    fireEvent.click(screen.getByText("Writing lens: Reflect"));
    fireEvent.click(screen.getByRole("button", { name: "Open page" }));
    fireEvent.click(screen.getByRole("button", { name: "Put down on desk" }));
    expect(screen.queryByRole("dialog", { name: "Full journal" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Your open page" })).toBeTruthy();
    const reopenedDesk = screen.getByRole("region", { name: "Write at your desk" });
    expect(within(reopenedDesk).queryByText("Keep what mattered. Let the rest be unfinished.")).toBeNull();
    expect(within(reopenedDesk).getByLabelText("Write freely at your desk")).toBeTruthy();
  });

  it("keeps free writing first while prompts and the day summary stay optional", () => {
    vi.useFakeTimers();
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    fireEvent.click(screen.getByRole("button", { name: "Write full page" }));

    const fullJournal = screen.getByRole("dialog", { name: "Full journal" });
    expect(within(fullJournal).getByLabelText("Free writing")).toBeTruthy();
    expect(within(fullJournal).queryByRole("heading", { name: "Day at a glance" })).toBeNull();
    fireEvent.click(within(fullJournal).getByText("Need a starting point?"));
    fireEvent.click(within(fullJournal).getByRole("button", { name: "Open page" }));
    expect(within(fullJournal).queryByLabelText("Which moment will you remember?")).toBeNull();
    fireEvent.click(within(fullJournal).getByRole("button", { name: "Focus" }));
    fireEvent.change(within(fullJournal).getByLabelText("What held your attention today?"), { target: { value: "A clear hour" } });
    fireEvent.click(within(fullJournal).getByRole("button", { name: "Reflect" }));
    expect((within(fullJournal).getByLabelText("Which moment will you remember?") as HTMLTextAreaElement).value).toBe("A clear hour");
    fireEvent.click(within(fullJournal).getByRole("button", { name: "Show day summary" }));
    expect(within(fullJournal).getByRole("heading", { name: "Day at a glance" })).toBeTruthy();
    fireEvent.keyDown(fullJournal, { key: "Escape" });
    act(() => { vi.advanceTimersByTime(860); });
    expect(screen.queryByRole("dialog", { name: "Full journal" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your open page" }));
  });

  it("settles an untouched full page after a quiet moment, while an active writer keeps it open", () => {
    vi.useFakeTimers();
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    fireEvent.click(screen.getByRole("button", { name: "Write full page" }));
    expect(screen.getByRole("dialog", { name: "Full journal" })).toBeTruthy();

    act(() => { vi.advanceTimersByTime(4400); });
    expect(screen.queryByRole("dialog", { name: "Full journal" })).toBeNull();
    expect(screen.getByLabelText("Journal notebook").className).toContain("is-settling");
    act(() => { vi.advanceTimersByTime(760); });
    expect(screen.getByRole("heading", { name: "Your open page" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Write full page" }));
    fireEvent.focus(screen.getByLabelText("Free writing"));
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByRole("dialog", { name: "Full journal" })).toBeTruthy();
  });

  it("keeps a dated page opened from a reminder in full view", async () => {
    vi.useFakeTimers();
    useUi.setState({ journalDay: YESTERDAY_KEY });
    await act(async () => { render(<JournalPage />); await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "Yesterday’s page" })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByRole("dialog", { name: "Full journal" })).toBeTruthy();
  });

  it("returns focus and the same draft to the desk when the writer puts the page down", () => {
    vi.useFakeTimers();
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    fireEvent.click(screen.getByRole("button", { name: "Write full page" }));
    const writing = screen.getByLabelText("Free writing") as HTMLTextAreaElement;
    act(() => { writing.focus(); });
    fireEvent.change(writing, { target: { value: "The line stays with me." } });
    fireEvent.click(screen.getByRole("button", { name: "Put down on desk" }));
    expect(screen.queryByRole("dialog", { name: "Full journal" })).toBeNull();
    const deskWriting = screen.getByLabelText("Write freely at your desk") as HTMLTextAreaElement;
    expect(deskWriting.value).toBe("The line stays with me.");
    expect(document.activeElement).toBe(deskWriting);
  });

  it("isolates an open feedback draft when the local workspace owner changes", () => {
    const originalProfile = useStore.getState().profile;
    const ownerA = "journal-feedback-local-a";
    const ownerB = "journal-feedback-local-b";
    const keyA = `axom-journal-feedback-draft:${ownerA}`;
    const keyB = `axom-journal-feedback-draft:${ownerB}`;
    window.localStorage.removeItem(keyA);
    window.localStorage.removeItem(keyB);
    useStore.setState({ profile: { ...originalProfile, userId: ownerA } });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      const liked = () => screen.getByLabelText("What do you like?") as HTMLTextAreaElement;
      fireEvent.change(liked(), { target: { value: "Only A should read this private feedback." } });
      expect(JSON.parse(window.localStorage.getItem(keyA) ?? "{}").liked).toBe("Only A should read this private feedback.");

      act(() => { useStore.setState({ profile: { ...originalProfile, userId: ownerB } }); });
      expect(liked().value).toBe("");
      expect(window.localStorage.getItem(keyB)).toBeNull();
      fireEvent.change(liked(), { target: { value: "B owns a different feedback draft." } });
      expect(JSON.parse(window.localStorage.getItem(keyB) ?? "{}").liked).toBe("B owns a different feedback draft.");

      act(() => { useStore.setState({ profile: { ...originalProfile, userId: ownerA } }); });
      expect(liked().value).toBe("Only A should read this private feedback.");
      expect(window.localStorage.getItem(keyA)).not.toContain("B owns a different");
    } finally {
      cleanup();
      useStore.setState({ profile: originalProfile });
      window.localStorage.removeItem(keyA);
      window.localStorage.removeItem(keyB);
    }
  });

  it("partitions feedback drafts for two signed-in accounts on the same workspace", () => {
    const previous = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const workspaceId = "journal-feedback-shared-workspace";
    const previousProfile = useStore.getState().profile;
    const accountA = { id: "feedback-account-a", email: "a@example.test", displayName: "A", emailConfirmed: true };
    const accountB = { id: "feedback-account-b", email: "b@example.test", displayName: "B", emailConfirmed: true };
    const keyA = `axom-journal-feedback-draft:${workspaceId}:account:${accountA.id}`;
    const keyB = `axom-journal-feedback-draft:${workspaceId}:account:${accountB.id}`;
    window.localStorage.removeItem(keyA);
    window.localStorage.removeItem(keyB);
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: accountA, phase: "signed-in" });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      const liked = () => screen.getByLabelText("What do you like?") as HTMLTextAreaElement;
      fireEvent.change(liked(), { target: { value: "A's private feedback." } });
      expect(JSON.parse(window.localStorage.getItem(keyA) ?? "{}").liked).toBe("A's private feedback.");

      act(() => { useAccount.setState({ user: accountB }); });
      expect(liked().value).toBe("");
      expect(window.localStorage.getItem(keyB)).toBeNull();
      fireEvent.change(liked(), { target: { value: "B's private feedback." } });
      expect(JSON.parse(window.localStorage.getItem(keyB) ?? "{}").liked).toBe("B's private feedback.");

      act(() => { useAccount.setState({ user: accountA }); });
      expect(liked().value).toBe("A's private feedback.");
      expect(window.localStorage.getItem(keyA)).not.toContain("B's private feedback.");
    } finally {
      cleanup();
      useAccount.setState(previous);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(keyA);
      window.localStorage.removeItem(keyB);
    }
  });

  it("keeps feedback drafts editable after a failed send but locks fields while sending", async () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-pending-send";
    const account = { id: "journal-feedback-pending-account", email: "pending@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    let rejectRequest!: (reason: Error) => void;
    const submit = vi.spyOn(journalFeedback, "submitJournalFeedback").mockImplementation(() => (
      new Promise<string>((_resolve, reject) => { rejectRequest = reject; })
    ));
    window.localStorage.removeItem(draftKey);
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      fireEvent.click(screen.getByRole("button", { name: "4 out of 5" }));
      const liked = () => screen.getByLabelText("What do you like?") as HTMLTextAreaElement;
      fireEvent.change(liked(), { target: { value: "A note that must not disappear." } });
      fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

      expect(submit).toHaveBeenCalledWith(account.id, expect.objectContaining({
        rating: 4, liked: "A note that must not disappear.",
      }));
      expect(liked().readOnly).toBe(true);
      expect((screen.getByRole("button", { name: "5 out of 5" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement).disabled).toBe(true);
      expect(JSON.parse(window.localStorage.getItem(draftKey) ?? "{}").liked)
        .toBe("A note that must not disappear.");

      await act(async () => { rejectRequest(new Error("Submission interrupted")); await Promise.resolve(); });
      await waitFor(() => expect(liked().readOnly).toBe(false));
      expect((screen.getByRole("button", { name: "5 out of 5" }) as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByRole("alert").textContent).toContain("Submission interrupted");
      expect(JSON.parse(window.localStorage.getItem(draftKey) ?? "{}").liked)
        .toBe("A note that must not disappear.");
      fireEvent.change(liked(), { target: { value: "New changes after the failed request." } });
      expect(JSON.parse(window.localStorage.getItem(draftKey) ?? "{}").liked)
        .toBe("New changes after the failed request.");
    } finally {
      cleanup();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
    }
  });

  it("allows only one in-flight feedback request per dialog and retries after failure", async () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-inflight-once";
    const account = { id: "journal-feedback-inflight-account", email: "inflight@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const failures: Array<(error: Error) => void> = [];
    const submit = vi.spyOn(journalFeedback, "submitJournalFeedback").mockImplementation(
      () => new Promise<string>((_resolve, reject) => { failures.push(reject); }),
    );
    window.localStorage.removeItem(draftKey);
    window.localStorage.removeItem(`${draftKey}:submitted`);
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      const dialog = screen.getByRole("dialog", { name: "How is the journal feeling?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "4 out of 5" }));
      fireEvent.change(within(dialog).getByLabelText("What do you like?"), { target: { value: "Send this once." } });

      // Two same-turn activations happen before React can commit disabled=true.
      const sendButton = within(dialog).getByRole("button", { name: "Send feedback" });
      act(() => {
        sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(submit).toHaveBeenCalledTimes(1);
      expect(failures).toHaveLength(1);
      expect(JSON.parse(window.localStorage.getItem(draftKey) ?? "{}").liked).toBe("Send this once.");

      await act(async () => { failures[0](new Error("Temporary failure")); await Promise.resolve(); });
      expect(within(dialog).getByRole("alert").textContent).toContain("Temporary failure");
      fireEvent.click(within(dialog).getByRole("button", { name: "Send feedback" }));
      expect(submit).toHaveBeenCalledTimes(2);
      expect(failures).toHaveLength(2);
      await act(async () => { failures[1](new Error("Retry refused")); await Promise.resolve(); });
      expect((within(dialog).getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("Send this once.");
      expect(window.localStorage.getItem(draftKey)).toContain("Send this once.");
    } finally {
      cleanup();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
      window.localStorage.removeItem(`${draftKey}:submitted`);
    }
  });

  it("coalesces a pending feedback send across closing and reopening the modal", async () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-remount-pending";
    const account = { id: "journal-feedback-remount-account", email: "remount@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    let resolveRequest!: (receipt: string) => void;
    const response = new Promise<string>((resolve) => { resolveRequest = resolve; });
    const submit = vi.spyOn(journalFeedback, "submitJournalFeedback").mockImplementation(() => response);
    window.localStorage.removeItem(draftKey);
    window.localStorage.removeItem(`${draftKey}:submitted`);
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      fireEvent.click(screen.getByRole("button", { name: "4 out of 5" }));
      fireEvent.change(screen.getByLabelText("What do you like?"), { target: { value: "Keep one pending request after remount." } });
      fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
      expect(submit).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();

      // The parent unmounts the first dialog while the server request is still pending.
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      expect(screen.queryByRole("dialog", { name: "How is the journal feeling?" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
        .toBe("Keep one pending request after remount.");
      fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
      expect(submit).toHaveBeenCalledTimes(1);

      await act(async () => { resolveRequest("550e8400-e29b-41d4-a716-446655440000"); await response; });
      expect(await screen.findByText("Feedback received.")).toBeTruthy();
      expect(submit).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(`${draftKey}:submitted`)).toBeTruthy();
    } finally {
      cleanup();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
      window.localStorage.removeItem(`${draftKey}:submitted`);
    }
  });

  it("stops a stale feedback editor from sending another tab's superseded draft", () => {
    const originalAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const originalProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-stale-send";
    const account = { id: "journal-feedback-stale-account", email: "stale@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const submit = vi.spyOn(journalFeedback, "submitJournalFeedback").mockResolvedValue("should-not-send");
    window.localStorage.removeItem(draftKey);
    useStore.setState({ profile: { ...originalProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      fireEvent.click(screen.getByRole("button", { name: "4 out of 5" }));
      fireEvent.change(screen.getByLabelText("What do you like?"), { target: { value: "Older unsent note." } });
      const newer = JSON.stringify({ ...JSON.parse(window.localStorage.getItem(draftKey) ?? "{}"), liked: "A second tab saved newer feedback." });
      window.localStorage.setItem(draftKey, newer);

      fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
      expect(submit).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toContain("Another tab changed this feedback draft");
      expect((screen.getByRole("button", { name: "Send feedback" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("Older unsent note.");
      expect(screen.getByRole("button", { name: "Download draft" })).toBeTruthy();
      expect(window.localStorage.getItem(draftKey)).toBe(newer);

      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
        .toBe("A second tab saved newer feedback.");
    } finally {
      cleanup();
      useAccount.setState(originalAccount);
      useStore.setState({ profile: originalProfile });
      window.localStorage.removeItem(draftKey);
    }
  });

  it("blocks feedback submission when stored-draft verification becomes unreadable", () => {
    const originalAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const originalProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-stale-read";
    const account = { id: "journal-feedback-read-account", email: "read@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const submit = vi.spyOn(journalFeedback, "submitJournalFeedback").mockResolvedValue("should-not-send");
    window.localStorage.removeItem(draftKey);
    useStore.setState({ profile: { ...originalProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      fireEvent.click(screen.getByRole("button", { name: "4 out of 5" }));
      fireEvent.change(screen.getByLabelText("What do you like?"), { target: { value: "Keep my in-memory answers." } });
      const nativeGet = Storage.prototype.getItem;
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
        if (this === window.localStorage && key === draftKey) throw new Error("Browser storage unavailable");
        return nativeGet.call(this, key);
      });

      fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
      expect(submit).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toContain("could not check the saved feedback draft");
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("Keep my in-memory answers.");
      expect(screen.getByRole("button", { name: "Download draft" })).toBeTruthy();
      expect(screen.queryByText("Feedback received.")).toBeNull();
    } finally {
      cleanup();
      vi.restoreAllMocks();
      useAccount.setState(originalAccount);
      useStore.setState({ profile: originalProfile });
      window.localStorage.removeItem(draftKey);
    }
  });

  it("retains newer feedback and acknowledges only the submitted revision", async () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-concurrent-draft";
    const account = { id: "journal-feedback-concurrent-account", email: "concurrent@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const resolveRequests: Array<(receipt: string) => void> = [];
    const submit = vi.spyOn(journalFeedback, "submitJournalFeedback").mockImplementation(
      () => new Promise<string>((resolve) => { resolveRequests.push(resolve); }),
    );
    window.localStorage.removeItem(draftKey);
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      fireEvent.click(screen.getByRole("button", { name: "4 out of 5" }));
      fireEvent.change(screen.getByLabelText("What do you like?"), {
        target: { value: "The original submitted note." },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
      expect(resolveRequests).toHaveLength(1);
      expect(submit).toHaveBeenNthCalledWith(1, account.id, expect.objectContaining({
        rating: 4, liked: "The original submitted note.",
      }));

      // A second tab writes a newer, unsent local draft while the RPC is pending.
      const newerDraft = JSON.stringify({
        ...JSON.parse(window.localStorage.getItem(draftKey) ?? "{}"),
        liked: "Another tab wrote this after the first submission.",
      });
      window.localStorage.setItem(draftKey, newerDraft);
      await act(async () => { resolveRequests[0]("first-receipt"); await Promise.resolve(); });
      expect(screen.getByRole("status").textContent).toContain("Feedback received.");
      expect(window.localStorage.getItem(draftKey)).toBe(newerDraft);

      fireEvent.click(within(screen.getByRole("dialog", { name: "How is the journal feeling?" })).getByText("Close", { selector: "button" }));
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
        .toBe("Another tab wrote this after the first submission.");
      fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
      expect(resolveRequests).toHaveLength(2);
      expect(submit).toHaveBeenNthCalledWith(2, account.id, expect.objectContaining({
        liked: "Another tab wrote this after the first submission.",
      }));
      await act(async () => { resolveRequests[1]("second-receipt"); await Promise.resolve(); });
      expect(screen.getByRole("status").textContent).toContain("Feedback received.");
      expect(window.localStorage.getItem(draftKey)).toBe(newerDraft);
      expect(window.localStorage.getItem(`${draftKey}:submitted`)).toBeTruthy();
      fireEvent.click(within(screen.getByRole("dialog", { name: "How is the journal feeling?" })).getByText("Close", { selector: "button" }));
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("");
    } finally {
      cleanup();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
    }
  });

  it("never deletes another tab's draft written during successful receipt", async () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-receipt-race";
    const account = { id: "receipt-race-account", email: "race@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const receiptKey = `${draftKey}:submitted`;
    let resolveRequest!: (receipt: string) => void;
    vi.spyOn(journalFeedback, "submitJournalFeedback").mockImplementation(
      () => new Promise<string>((resolve) => { resolveRequest = resolve; }),
    );
    window.localStorage.removeItem(draftKey);
    window.localStorage.removeItem(receiptKey);
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    const nativeSet = Storage.prototype.setItem;
    let injected = false;
    let competingDraft = "";
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      fireEvent.click(screen.getByRole("button", { name: "4 out of 5" }));
      fireEvent.change(screen.getByLabelText("What do you like?"), { target: { value: "Sent first tab draft." } });
      fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
      const removed = vi.spyOn(Storage.prototype, "removeItem");
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
        if (this === window.localStorage && key === receiptKey && !injected) {
          injected = true;
          competingDraft = JSON.stringify({
            ...JSON.parse(window.localStorage.getItem(draftKey) ?? "{}"),
            liked: "Second tab wrote during receipt.",
          });
          nativeSet.call(this, draftKey, competingDraft);
        }
        nativeSet.call(this, key, value);
      });
      await act(async () => { resolveRequest("race-receipt"); await Promise.resolve(); });
      expect(injected).toBe(true);
      expect(removed).not.toHaveBeenCalledWith(draftKey);
      expect(window.localStorage.getItem(draftKey)).toBe(competingDraft);
      fireEvent.click(within(screen.getByRole("dialog", { name: "How is the journal feeling?" })).getByText("Close", { selector: "button" }));
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
        .toBe("Second tab wrote during receipt.");
    } finally {
      cleanup();
      vi.restoreAllMocks();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
      window.localStorage.removeItem(receiptKey);
    }
  });

  it("preserves unsupported valid-JSON feedback during editing attempts and reopening", () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-unsupported-schema";
    const account = { id: "journal-feedback-unsupported-account", email: "unsupported@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const examples = [
      { rating: "4", liked: { private: "Keep nested writing" }, comment: "Keep me", futureVersion: 9 },
      { rating: 4, liked: "Current draft", futureVersion: 2 },
      { rating: 4, liked: "x".repeat(1001), comment: "Oversized content must survive" },
      { rating: 4, liked: "Keep revision metadata", __axomRevision: "invalid-revision" },
      { rating: 4, liked: null, comment: "Wrong-typed field" },
    ];
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    try {
      for (const example of examples) {
        const raw = JSON.stringify(example);
        window.localStorage.setItem(draftKey, raw);
        render(<JournalPage />);
        fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
        const dialog = screen.getByRole("dialog", { name: "How is the journal feeling?" });
        expect(within(dialog).getByRole("alert").textContent).toMatch(/could not read this saved feedback draft/i);
        expect(within(dialog).getByRole("button", { name: "Download saved copy" })).toBeTruthy();
        expect((within(dialog).getByRole("button", { name: "Send feedback" }) as HTMLButtonElement).disabled).toBe(true);
        const liked = within(dialog).getByLabelText("What do you like?") as HTMLTextAreaElement;
        expect(liked.readOnly).toBe(true);
        fireEvent.change(liked, { target: { value: "Attempted edit must not erase original bytes" } });
        expect(window.localStorage.getItem(draftKey)).toBe(raw);
        fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
        fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
        expect(screen.getByRole("button", { name: "Download saved copy" })).toBeTruthy();
        expect(window.localStorage.getItem(draftKey)).toBe(raw);
        cleanup();
      }
    } finally {
      cleanup();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
      window.localStorage.removeItem(`${draftKey}:submitted`);
    }
  });

  it("acknowledges an unchanged legacy feedback draft without deleting later tab edits", async () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-legacy-ack";
    const account = { id: "journal-legacy-receipt-account", email: "legacy-ack@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const receiptKey = `${draftKey}:submitted`;
    const original = JSON.stringify({ rating: 4, liked: "Already sent legacy text" });
    const newer = JSON.stringify({ rating: 4, liked: "A newer unsent legacy draft" });
    window.localStorage.setItem(draftKey, original);
    window.localStorage.removeItem(receiptKey);
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    const submit = vi.spyOn(journalFeedback, "submitJournalFeedback").mockResolvedValue("legacy-receipt");
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("Already sent legacy text");
      expect(window.localStorage.getItem(draftKey)).toBe(original);
      fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Feedback received."));
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledWith(account.id, expect.objectContaining({ rating: 4, liked: "Already sent legacy text" }));
      expect(window.localStorage.getItem(draftKey)).toBe(original);
      expect(window.localStorage.getItem(receiptKey)).toBeTruthy();
      fireEvent.click(within(screen.getByRole("dialog", { name: "How is the journal feeling?" })).getByText("Close", { selector: "button" }));
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("");
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      // A newer, independently written legacy draft is never hidden by an old receipt.
      window.localStorage.setItem(draftKey, newer);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("A newer unsent legacy draft");
      expect(window.localStorage.getItem(draftKey)).toBe(newer);
    } finally {
      cleanup();
      vi.restoreAllMocks();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
      window.localStorage.removeItem(receiptKey);
    }
  });

  it("retries an unchanged feedback draft after local storage becomes writable", () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-storage-retry";
    const account = { id: "journal-feedback-retry-account", email: "retry@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    window.localStorage.removeItem(draftKey);
    window.localStorage.removeItem(`${draftKey}:submitted`);
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    const nativeSet = Storage.prototype.setItem;
    let blocked = true;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (this === window.localStorage && key === draftKey && blocked) throw new Error("Storage quota exceeded");
      nativeSet.call(this, key, value);
    });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      fireEvent.change(screen.getByLabelText("What do you like?"), {
        target: { value: "Retain this text when storage becomes available." },
      });
      expect(window.localStorage.getItem(draftKey)).toBeNull();
      expect(screen.getByRole("alert").textContent).toMatch(/could not keep a local draft/i);

      blocked = false;
      fireEvent.click(screen.getByRole("button", { name: "Retry draft save" }));
      expect(JSON.parse(window.localStorage.getItem(draftKey) ?? "{}").liked)
        .toBe("Retain this text when storage becomes available.");
      expect(screen.queryByRole("button", { name: "Retry draft save" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
        .toBe("Retain this text when storage becomes available.");
    } finally {
      cleanup();
      setItem.mockRestore();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
      window.localStorage.removeItem(`${draftKey}:submitted`);
    }
  });

  it("warns and offers a download if sent feedback was not saved locally", async () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-unsaved-submit";
    const account = { id: "unsaved-submit-account", email: "unsaved@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const receiptKey = `${draftKey}:submitted`;
    const original = JSON.stringify({ rating: 4, liked: "Older locally saved text", __axomRevision: "a".repeat(32) });
    const latest = "New answers not saved due to quota";
    window.localStorage.setItem(draftKey, original);
    window.localStorage.removeItem(receiptKey);
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    const submit = vi.spyOn(journalFeedback, "submitJournalFeedback").mockResolvedValue("unsaved-receipt");
    const nativeSet = Storage.prototype.setItem;
    try {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
        if (this === window.localStorage && key === draftKey) throw new Error("Storage quota exceeded");
        nativeSet.call(this, key, value);
      });
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      fireEvent.change(screen.getByLabelText("What do you like?"), { target: { value: latest } });
      expect(screen.getByRole("alert").textContent).toMatch(/could not keep a local draft/i);
      expect(window.localStorage.getItem(draftKey)).toBe(original);

      fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Feedback received."));
      expect(submit).toHaveBeenCalledWith(account.id, expect.objectContaining({ liked: latest }));
      expect(screen.getByRole("alert").textContent).toMatch(/not saved in this browser/i);
      expect(screen.getByRole("button", { name: "Download submitted copy" })).toBeTruthy();
      expect(window.localStorage.getItem(draftKey)).toBe(original);
      expect(window.localStorage.getItem(receiptKey)).toBeNull();

      fireEvent.click(within(screen.getByRole("dialog", { name: "How is the journal feeling?" })).getByText("Close", { selector: "button" }));
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("Older locally saved text");
    } finally {
      cleanup();
      vi.restoreAllMocks();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
      window.localStorage.removeItem(receiptKey);
    }
  });

  it("keeps legacy saved bytes visible if edited feedback was sent after a storage failure", async () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-legacy-ack-storage-failure";
    const account = { id: "legacy-ack-storage-account", email: "storage-ack@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const receiptKey = `${draftKey}:submitted`;
    const saved = JSON.stringify({ rating: 4, liked: "Recoverable old legacy text" });
    const changed = "New text submitted only from memory";
    window.localStorage.setItem(draftKey, saved);
    window.localStorage.removeItem(receiptKey);
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    const submit = vi.spyOn(journalFeedback, "submitJournalFeedback").mockResolvedValue("storage-error-receipt");
    const nativeSet = Storage.prototype.setItem;
    try {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
        if (this === window.localStorage && key === draftKey) throw new Error("Storage quota exceeded");
        nativeSet.call(this, key, value);
      });
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      fireEvent.change(screen.getByLabelText("What do you like?"), { target: { value: changed } });
      expect(screen.getByRole("alert").textContent).toMatch(/could not keep a local draft/i);
      expect(window.localStorage.getItem(draftKey)).toBe(saved);
      fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Feedback received."));
      expect(submit).toHaveBeenCalledWith(account.id, expect.objectContaining({ liked: changed }));
      expect(window.localStorage.getItem(draftKey)).toBe(saved);
      expect(window.localStorage.getItem(receiptKey)).toBeNull();
      fireEvent.click(within(screen.getByRole("dialog", { name: "How is the journal feeling?" })).getByText("Close", { selector: "button" }));
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("Recoverable old legacy text");
    } finally {
      cleanup();
      vi.restoreAllMocks();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
      window.localStorage.removeItem(receiptKey);
    }
  });

  it("keeps known-field legacy partial feedback editable without a schema migration", () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-valid-legacy-partial";
    const account = { id: "journal-feedback-legacy-account", email: "legacy@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const legacyDraft = JSON.stringify({ rating: 4, liked: "Original legacy text" });
    window.localStorage.setItem(draftKey, legacyDraft);
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      const dialog = screen.getByRole("dialog", { name: "How is the journal feeling?" });
      expect(within(dialog).queryByRole("alert")).toBeNull();
      expect((within(dialog).getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("Original legacy text");
      expect(window.localStorage.getItem(draftKey)).toBe(legacyDraft);
      fireEvent.change(within(dialog).getByLabelText("What do you like?"), { target: { value: "Original legacy text, continued" } });
      expect(JSON.parse(window.localStorage.getItem(draftKey) ?? "{}")).toMatchObject({
        rating: 4, liked: "Original legacy text, continued",
      });
    } finally {
      cleanup();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
      window.localStorage.removeItem(`${draftKey}:submitted`);
    }
  });

  it("keeps unreadable feedback bytes recoverable rather than replacing them with an empty draft", () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-unreadable-draft";
    const account = { id: "journal-feedback-unreadable-account", email: "unreadable@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const unreadableBytes = '{"rating":4,"liked":"A private draft to recover",';
    window.localStorage.setItem(draftKey, unreadableBytes);
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      const dialog = screen.getByRole("dialog", { name: "How is the journal feeling?" });
      expect(within(dialog).getByRole("alert").textContent).toMatch(/could not read this saved feedback draft/i);
      expect(within(dialog).getByRole("button", { name: "Download saved copy" })).toBeTruthy();
      expect((within(dialog).getByRole("button", { name: "Send feedback" }) as HTMLButtonElement).disabled).toBe(true);
      const liked = within(dialog).getByLabelText("What do you like?") as HTMLTextAreaElement;
      expect(liked.readOnly).toBe(true);
      expect(window.localStorage.getItem(draftKey)).toBe(unreadableBytes);

      fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect(screen.getByRole("alert").textContent).toMatch(/could not read this saved feedback draft/i);
      expect(window.localStorage.getItem(draftKey)).toBe(unreadableBytes);
    } finally {
      cleanup();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
      window.localStorage.removeItem(`${draftKey}:submitted`);
    }
  });

  it("does not overwrite a newer feedback draft from another tab after an old editor types", () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-stale-edit";
    const account = { id: "journal-feedback-stale-edit-account", email: "stale-edit@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const oldDraft = { rating: 3, liked: "Original private feedback.", wantMore: "", missing: "", painPoints: "", comment: "" };
    const newerDraft = JSON.stringify({ ...oldDraft, liked: "Newer changes from a second tab.", __axomRevision: "a".repeat(32) });
    window.localStorage.setItem(draftKey, JSON.stringify(oldDraft));
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      const liked = () => screen.getByLabelText("What do you like?") as HTMLTextAreaElement;
      expect(liked().value).toBe(oldDraft.liked);

      // A different tab updates the shared key after this editor has read it.
      window.localStorage.setItem(draftKey, newerDraft);
      fireEvent.change(liked(), { target: { value: "My unsaved continuation." } });
      expect(window.localStorage.getItem(draftKey)).toBe(newerDraft);
      expect(liked().value).toBe("My unsaved continuation.");
      expect(screen.getByRole("alert").textContent).toMatch(/another tab changed this feedback draft/i);
      expect(screen.getByRole("button", { name: "Download draft" })).toBeTruthy();
      expect((screen.getByRole("button", { name: "Send feedback" }) as HTMLButtonElement).disabled).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect(liked().value).toBe("Newer changes from a second tab.");
    } finally {
      cleanup();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
      window.localStorage.removeItem(`${draftKey}:submitted`);
    }
  });

  it("does not clobber a newer local feedback draft merely by opening or reopening the dialog", () => {
    const previousAccount = { user: useAccount.getState().user, phase: useAccount.getState().phase };
    const previousProfile = useStore.getState().profile;
    const workspaceId = "journal-feedback-stale-mount";
    const account = { id: "journal-feedback-stale-account", email: "stale@example.test", displayName: "Test", emailConfirmed: true };
    const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;
    const originalDraft = { rating: 3, liked: "Older saved feedback.", wantMore: "", missing: "", painPoints: "", comment: "" };
    const newerDraft = JSON.stringify({ ...originalDraft, liked: "Newer feedback saved in another tab." });
    window.localStorage.setItem(draftKey, JSON.stringify(originalDraft));
    useStore.setState({ profile: { ...previousProfile, userId: workspaceId } });
    useAccount.setState({ user: account, phase: "signed-in" });

    // Model the independent tab writing after the initial storage read, before
    // React commits the initial persistence effect (which previously clobbered it).
    const nativeGetItem = window.Storage.prototype.getItem;
    const nativeSetItem = window.Storage.prototype.setItem;
    let interleaved = false;
    const readSpy = vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      const before = nativeGetItem.call(this, key);
      if (!interleaved && this === window.localStorage && key === draftKey) {
        interleaved = true;
        nativeSetItem.call(this, key, newerDraft);
      }
      return before;
    });
    try {
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      const liked = () => screen.getByLabelText("What do you like?") as HTMLTextAreaElement;
      expect(interleaved).toBe(true);
      expect(liked().value).toBe(originalDraft.liked);
      expect(window.localStorage.getItem(draftKey)).toBe(newerDraft);

      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect(liked().value).toBe("Newer feedback saved in another tab.");
      expect(window.localStorage.getItem(draftKey)).toBe(newerDraft);

      fireEvent.change(liked(), { target: { value: "A deliberate new edit." } });
      expect(JSON.parse(window.localStorage.getItem(draftKey) ?? "{}").liked).toBe("A deliberate new edit.");
    } finally {
      readSpy.mockRestore();
      cleanup();
      useAccount.setState(previousAccount);
      useStore.setState({ profile: previousProfile });
      window.localStorage.removeItem(draftKey);
    }
  });

  it("opens feedback from the notification route without sending private content", () => {
    window.history.replaceState(null, "", "#journal?feedback=1");
    render(<JournalPage />);
    expect(screen.getByRole("dialog", { name: "How is the journal feeling?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send feedback" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(window.location.hash).toBe("#journal");
  });

  it("unlocks Again only after three complete iPad on/off cycles", async () => {
    const play = vi.spyOn(useSoundscape.getState(), "play").mockResolvedValue(undefined);
    render(<JournalPage />);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Turn on desk iPad" }));
      expect(screen.getByRole("button", { name: "Turn off desk iPad" }).getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Turn off desk iPad" }));
    }
    expect(useStore.getState().profile.unlocks ?? []).not.toContain("again");
    expect(play).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Turn on desk iPad" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off desk iPad" }));
    await waitFor(() => expect(useStore.getState().profile.unlocks).toContain("again"));
    expect(play).toHaveBeenCalledWith("again", { version: "original" });
    expect(screen.getByText("Again unlocked. It is now in Your sounds.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Turn on desk iPad" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off desk iPad" }));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("opens the premium notebook and turns pages with buttons without losing text", async () => {
    // This component test has no hydrated IndexedDB subscriber. Persistence
    // semantics are exercised below and in localVault.test; here the durable
    // boundary is acknowledged so the page-turn behavior can be isolated.
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    openTodayInFullPage();
    expect(await screen.findByRole("heading", { name: "Today’s page" })).toBeTruthy();

    fireEvent.click(screen.getByText("Need a starting point?"));
    fireEvent.click(screen.getByRole("button", { name: "Reflect" }));
    const reflection = screen.getByLabelText("Which moment will you remember?");
    fireEvent.change(reflection, { target: { value: "A sentence that must survive the turn." } });
    fireEvent.click(screen.getByRole("button", { name: "Previous journal page" }));
    expect(await screen.findByDisplayValue("Yesterday was grounded.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next journal page" }));
    expect(await screen.findByDisplayValue("A sentence that must survive the turn.")).toBeTruthy();

    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY))?.today)
      .toBe("A sentence that must survive the turn.");
  });

  it("keeps the current page and draft open when a page-turn write cannot be confirmed", async () => {
    vi.spyOn(localVault, "flushLocalVaultWrites").mockRejectedValue(new Error("Forced durable write failure"));
    render(<JournalPage />);
    openTodayInFullPage();
    const writing = screen.getByLabelText("Free writing");
    fireEvent.change(writing, { target: { value: "Do not turn away from this draft" } });

    fireEvent.click(screen.getByRole("button", { name: "Previous journal page" }));

    expect(await screen.findByText("Not saved on this device")).toBeTruthy();
    expect(useUi.getState().journalDay).toBeNull();
    expect(screen.getByRole("heading", { name: "Today’s page" })).toBeTruthy();
    expect(screen.getAllByDisplayValue("Do not turn away from this draft")[0]).toBeTruthy();
    expect(screen.queryByDisplayValue("Yesterday was grounded.")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/still open.*export.*retry Save/i);
  });

  it("retries a failed inline desk autosave without abandoning the private draft", async () => {
    vi.useFakeTimers();
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites")
      .mockRejectedValueOnce(new Error("Interrupted local write"))
      .mockResolvedValue(undefined);
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: /Open My AXOM Journal to today’s page/i }));
    const writing = screen.getByLabelText("Write freely at your desk") as HTMLTextAreaElement;
    fireEvent.change(writing, { target: { value: "Keep this private entry through the retry." } });

    await act(async () => { vi.advanceTimersByTime(450); await Promise.resolve(); });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Your changes need saving")).toBeTruthy();
    expect(writing.value).toBe("Keep this private entry through the retry.");
    const retry = screen.getByRole("button", { name: "Retry save" });
    vi.useRealTimers();
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText("Page saved locally")).toBeTruthy());
    expect(flush).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Retry save" })).toBeNull();
    expect((screen.getByLabelText("Write freely at your desk") as HTMLTextAreaElement).value)
      .toBe("Keep this private entry through the retry.");
    expect(useStore.getState().journal.find((item) => item.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "Keep this private entry through the retry." });
    const unload = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("does not close to the Library until the current draft is durable", async () => {
    vi.spyOn(localVault, "flushLocalVaultWrites").mockRejectedValue(new Error("Forced durable write failure"));
    render(<JournalPage />);
    openTodayInFullPage();
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Keep the notebook open" } });
    fireEvent.click(screen.getByRole("button", { name: "Put down on desk" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Write full page" })).toBeTruthy(), { timeout: 1800 });
    fireEvent.click(screen.getByRole("button", { name: "Library" }));

    expect(await screen.findByText("Not saved on this device")).toBeTruthy();
    expect(screen.getByLabelText("Journal notebook")).toBeTruthy();
    expect(screen.getAllByDisplayValue("Keep the notebook open")[0]).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open today’s page/i })).toBeNull();
  });

  it("waits for an in-flight image before navigating and persists it with the page", async () => {
    let finishImage!: (attachment: JournalImageAttachment) => void;
    vi.spyOn(journalNotebook, "readJournalImage").mockReturnValue(new Promise((resolve) => { finishImage = resolve; }));
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    openTodayInFullPage();

    const input = screen.getByLabelText("Choose a journal image");
    fireEvent.change(input, { target: { files: [new File(["axom"], "study-desk.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Previous journal page" }));

    expect(screen.getByRole("heading", { name: "Today’s page" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Adding…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finishImage(localImage); await Promise.resolve(); });

    expect(await screen.findByDisplayValue("Yesterday was grounded.")).toBeTruthy();
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY))?.attachments)
      .toEqual([localImage]);
  });

  it("waits for both overlapping image reads before saving a turned page", async () => {
    let finishFirst!: (attachment: JournalImageAttachment) => void;
    let finishSecond!: (attachment: JournalImageAttachment) => void;
    const first = new Promise<JournalImageAttachment>((resolve) => { finishFirst = resolve; });
    const second = new Promise<JournalImageAttachment>((resolve) => { finishSecond = resolve; });
    const readImage = vi.spyOn(journalNotebook, "readJournalImage")
      .mockReturnValueOnce(first).mockReturnValueOnce(second);
    vi.spyOn(localVault, "flushLocalVaultWrites").mockResolvedValue(undefined);
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    openTodayInFullPage();

    const input = screen.getByLabelText("Choose a journal image");
    fireEvent.change(input, { target: { files: [new File(["a"], "first.png", { type: "image/png" })] } });
    fireEvent.change(input, { target: { files: [new File(["b"], "second.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Previous journal page" }));

    const laterImage = { ...localImage, id: "second-image", name: "second.png" };
    await act(async () => {
      finishSecond(laterImage);
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    });
    // Finishing the later read first must not allow navigation to discard the first.
    expect(screen.getByRole("heading", { name: "Today’s page" })).toBeTruthy();

    const firstImage = { ...localImage, id: "first-image", name: "first.png" };
    await act(async () => { finishFirst(firstImage); await Promise.resolve(); });
    expect(await screen.findByDisplayValue("Yesterday was grounded.")).toBeTruthy();
    expect(readImage).toHaveBeenCalledTimes(2);
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY))?.attachments)
      .toEqual([firstImage, laterImage]);
  });

  it("keeps the writing page and image-read alert open when a queued page turn follows a failed image", async () => {
    let failImage!: (reason: Error) => void;
    vi.spyOn(journalNotebook, "readJournalImage").mockReturnValue(
      new Promise((_resolve, reject) => { failImage = reject; }),
    );
    vi.spyOn(localVault, "flushLocalVaultWrites").mockResolvedValue(undefined);
    render(<JournalPage />);
    openTodayInFullPage();
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Do not lose this draft." } });

    fireEvent.change(screen.getByLabelText("Choose a journal image"), {
      target: { files: [new File(["broken"], "broken.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Previous journal page" }));
    await act(async () => {
      failImage(new Error("Image read failed"));
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    });

    expect(screen.getByRole("heading", { name: "Today’s page" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Image read failed");
    expect((screen.getByLabelText("Free writing") as HTMLTextAreaElement).value).toBe("Do not lose this draft.");
    expect(screen.getByRole("button", { name: "Dismiss image warning" })).toBeTruthy();
    expect(screen.queryByText("Saved to this workspace")).toBeNull();
  });

  it("holds the page after image A succeeds and queued B fails, until the failure is acknowledged", async () => {
    const original = { ...useStore.getState().journal[0], id: "journal-stable-today-id",
      date: `${TODAY_KEY}T12:00:00`, today: "Preserve my original ID.", attachments: [] };
    useStore.setState((s) => ({ journal: [...s.journal, original] }));
    let finishFirst!: (attachment: JournalImageAttachment) => void;
    let failSecond!: (reason: Error) => void;
    const first = new Promise<JournalImageAttachment>((resolve) => { finishFirst = resolve; });
    const second = new Promise<JournalImageAttachment>((_resolve, reject) => { failSecond = reject; });
    vi.spyOn(journalNotebook, "readJournalImage")
      .mockReturnValueOnce(first).mockReturnValueOnce(second);
    vi.spyOn(localVault, "flushLocalVaultWrites").mockResolvedValue(undefined);
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    openTodayInFullPage();
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Keep A. B failed." } });

    const input = screen.getByLabelText("Choose a journal image");
    fireEvent.change(input, { target: { files: [new File(["a"], "first.png", { type: "image/png" })] } });
    fireEvent.change(input, { target: { files: [new File(["b"], "second.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Previous journal page" }));

    const firstImage = { ...localImage, id: "first-success", name: "first.png" };
    await act(async () => { finishFirst(firstImage); await Promise.resolve(); });
    await act(async () => {
      failSecond(new Error("Second image rejected"));
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    });
    expect(screen.getByRole("heading", { name: "Today’s page" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Second image rejected");
    expect(screen.getByRole("button", { name: "Dismiss image warning" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss image warning" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous journal page" }));
    expect(await screen.findByDisplayValue("Yesterday was grounded.")).toBeTruthy();
    expect(useStore.getState().journal.find((entry) => entry.id === "journal-stable-today-id"))
      .toMatchObject({ freeWriting: "Keep A. B failed.", attachments: [firstImage] });
  });

  it("does not rewrite an unchanged historical page during navigation", async () => {
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites");
    render(<JournalPage />);
    fireEvent.click(screen.getByText("Yesterday was grounded.").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Write full page" }));

    fireEvent.click(screen.getByRole("button", { name: "Next journal page" }));

    expect(await screen.findByRole("heading", { name: "Today’s page" })).toBeTruthy();
    expect(flush).not.toHaveBeenCalled();
    expect(useStore.getState().journal.find((entry) => entry.id === "yesterday")?.updatedAt).toBeUndefined();
  });

  it("gates requested-day and editor-close transitions on the same exact write check", async () => {
    let confirmDurability!: () => void;
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites")
      .mockImplementationOnce(() => new Promise<void>((resolve) => { confirmDurability = resolve; }))
      .mockRejectedValue(new Error("Forced durable write failure"));
    const assertExactWrite = vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    const assertWritesSince = vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    fireEvent.click(screen.getByText("Yesterday was grounded.").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Write full page" }));
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Yesterday remains visible until durable" } });

    act(() => { useUi.getState().remediateStandup(TODAY_KEY); });
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    expect(useUi.getState().journalDay).toBe(TODAY_KEY);
    expect(screen.getAllByDisplayValue("Yesterday remains visible until durable")[0]).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Today’s page" })).toBeNull();

    await act(async () => { confirmDurability(); await Promise.resolve(); });
    expect(await screen.findByRole("dialog", { name: "Full journal" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Today’s page" })).toBeTruthy();
    expect(useUi.getState().journalDay).toBeNull();
    expect(assertExactWrite).toHaveBeenCalledTimes(1);
    expect(assertWritesSince).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Cancel must not discard this" } });
    fireEvent.click(screen.getByRole("button", { name: "Support" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave journal" }));

    expect(await screen.findByText("Not saved on this device")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Full journal" })).toBeTruthy();
    expect(screen.getAllByDisplayValue("Cancel must not discard this")[0]).toBeTruthy();
  });

  it("keeps a failed requested-day intent and its current draft intact", async () => {
    vi.spyOn(localVault, "flushLocalVaultWrites").mockRejectedValue(new Error("Forced requested-day failure"));
    render(<JournalPage />);
    fireEvent.click(screen.getByText("Yesterday was grounded.").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Write full page" }));
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Keep this page and the requested day" } });

    act(() => { useUi.getState().remediateStandup(TODAY_KEY); });

    expect(await screen.findByText("Not saved on this device")).toBeTruthy();
    expect(useUi.getState().journalDay).toBe(TODAY_KEY);
    expect(screen.getAllByDisplayValue("Keep this page and the requested day")[0]).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Today’s page" })).toBeNull();
  });

  it("supports keyboard page turns away from form controls", async () => {
    render(<JournalPage />);
    openTodayInFullPage();
    const notebook = await screen.findByRole("dialog", { name: "Full journal" });
    fireEvent.keyDown(notebook, { key: "ArrowLeft" });
    expect(await screen.findByDisplayValue("Yesterday was grounded.")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Full journal" }), { key: "ArrowRight" });
    expect(await screen.findByRole("heading", { name: "Today’s page" })).toBeTruthy();
  });

  it("marks the notebook reduced-motion and keeps all writing controls semantic", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    render(<JournalPage />);
    openTodayInFullPage();
    const notebook = await screen.findByRole("dialog", { name: "Full journal" });
    expect(notebook.getAttribute("data-motion")).toBe("reduced");
    expect(screen.getByLabelText("Free writing")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Include in journal" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Day at a glance" })).toBeNull();
  });

  it("keeps a manual support preview available without blocking the journal", async () => {
    render(<JournalPage />);
    openTodayInFullPage();
    fireEvent.click(screen.getByRole("button", { name: "Support" }));

    const preview = screen.getByRole("region", { name: "You do not have to carry this alone." });
    expect(within(preview).getByText(/runs in your browser.*does not send a support alert/i)).toBeTruthy();
    expect(within(preview).getByRole("link", { name: "Find support near me" }).getAttribute("href"))
      .toBe("https://findahelpline.com/");
    expect(within(preview).getByRole("link", { name: "988 in the U.S. and territories" }).getAttribute("href"))
      .toBe("https://988lifeline.org/get-help/");
    expect(screen.getByLabelText("Free writing")).toBeTruthy();

    fireEvent.click(within(preview).getByRole("button", { name: "Keep writing" }));
    expect(screen.queryByRole("region", { name: "You do not have to carry this alone." })).toBeNull();
    expect(screen.getByRole("button", { name: "Support" }).getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Support" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave journal" }));
    expect(await screen.findByRole("button", { name: "Open today’s page" })).toBeTruthy();
  });

  it("puts the book down immediately with support open and keeps its writing", async () => {
    vi.useFakeTimers();
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    openTodayInFullPage();
    const fullJournal = screen.getByRole("dialog", { name: "Full journal" });
    fireEvent.change(within(fullJournal).getByLabelText("Free writing"), { target: { value: "A page I can return to." } });
    fireEvent.click(within(fullJournal).getByRole("button", { name: "Support" }));
    expect(within(fullJournal).getByRole("region", { name: "You do not have to carry this alone." })).toBeTruthy();
    expect(within(fullJournal).getByRole("complementary", { name: "Desk margin" })).toBeTruthy();

    fireEvent.click(within(fullJournal).getByRole("button", { name: "Put down on desk" }));
    expect(screen.queryByRole("dialog", { name: "Full journal" })).toBeNull();
    expect((screen.getByLabelText("Write freely at your desk") as HTMLTextAreaElement).value).toBe("A page I can return to.");
    fireEvent.pointerDown(screen.getByLabelText("Journal notebook"));
    expect(screen.getByLabelText("Journal notebook").className).toContain("is-settling");
    act(() => { vi.advanceTimersByTime(760); });
    expect(screen.getByLabelText("Journal notebook").className).not.toContain("is-settling");
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "Put book down" }));
    expect(await screen.findByRole("button", { name: /Open My AXOM Journal to today’s page/i }, { timeout: 2500 })).toBeTruthy();
  });

  it("opens the support preview for direct first-person safety language but not study notes", async () => {
    render(<JournalPage />);
    openTodayInFullPage();
    const writing = screen.getByLabelText("Free writing");

    fireEvent.change(writing, { target: { value: "I reviewed the suicide risk assessment lecture." } });
    expect(screen.queryByRole("region", { name: "You do not have to carry this alone." })).toBeNull();

    fireEvent.change(writing, { target: { value: "I do not want to be alive." } });
    const preview = await screen.findByRole("region", { name: "You do not have to carry this alone." });
    expect(within(preview).getByText(/noticed first-person wording.*not a diagnosis.*does not send a support alert/i)).toBeTruthy();
    expect((screen.getByLabelText("Free writing") as HTMLTextAreaElement).value).toBe("I do not want to be alive.");
  });

  it("reports an autosave only after the local vault confirms durability", async () => {
    vi.useFakeTimers();
    let confirmDurability!: () => void;
    vi.spyOn(localVault, "flushLocalVaultWrites").mockReturnValue(new Promise<void>((resolve) => { confirmDurability = resolve; }));
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    openTodayInFullPage();
    const writing = screen.getByLabelText("Free writing");
    fireEvent.change(writing, { target: { value: "Local autosave text" } });
    expect(screen.getByText("Saving to this workspace…")).toBeTruthy();

    await act(async () => { vi.advanceTimersByTime(450); });
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "Local autosave text", notebookStatus: "draft" });
    expect(screen.getByText("Saving to this workspace…")).toBeTruthy();

    await act(async () => { confirmDurability(); await Promise.resolve(); });
    expect(screen.getByText("Saved to this workspace")).toBeTruthy();
  });

  it("warns on unload only while the visible draft is still dirty", async () => {
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    openTodayInFullPage();
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Warn until this draft is durable" } });

    const dirtyUnload = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved to this workspace")).toBeTruthy());
    const savedUnload = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(savedUnload);
    expect(savedUnload.defaultPrevented).toBe(false);
  });

  it("starts an immediate best-effort save on page hide or hidden visibility and removes lifecycle listeners", async () => {
    vi.useFakeTimers();
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites").mockResolvedValue(undefined);
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const view = render(<JournalPage />);
    openTodayInFullPage();
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Persist on page hide without waiting 420 ms" } });

    window.dispatchEvent(new Event("pagehide"));

    expect(flush).toHaveBeenCalledTimes(1);
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "Persist on page hide without waiting 420 ms" });
    await act(async () => { await Promise.resolve(); });

    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Persist when the page becomes hidden" } });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(flush).toHaveBeenCalledTimes(2);
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "Persist when the page becomes hidden" });
    await act(async () => { await Promise.resolve(); });

    view.unmount();
    expect(removeWindowListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("finishes Done only after a late edit has also been durably saved", async () => {
    let finishFirst!: () => void;
    let finishLatest!: () => void;
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites")
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishLatest = resolve; }));
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    openTodayInFullPage();

    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Before Done" } });
    fireEvent.click(screen.getByRole("button", { name: "Done for today" }));
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Day kept.")).toBeNull();

    // Simulate typing while the initial durable flush is still pending.
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Before Done, plus a late private line" } });
    await act(async () => { finishFirst(); await Promise.resolve(); });

    // A superseded flush must not strand Done or mark the older draft complete.
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Day kept.")).toBeNull();
    expect((screen.getByLabelText("Free writing") as HTMLTextAreaElement).value)
      .toBe("Before Done, plus a late private line");
    const latest = useStore.getState().journal.find((item) => item.date.startsWith(TODAY_KEY));
    expect(latest?.freeWriting).toBe("Before Done, plus a late private line");
    const originalId = latest?.id;

    await act(async () => { finishLatest(); await Promise.resolve(); });
    expect(await screen.findByText("Day kept.")).toBeTruthy();
    expect(useStore.getState().journal.find((item) => item.date.startsWith(TODAY_KEY)))
      .toMatchObject({ id: originalId, freeWriting: "Before Done, plus a late private line", notebookStatus: "complete" });
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed Done attempt as a draft through an ordinary save retry", async () => {
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites")
      .mockRejectedValueOnce(new Error("Storage temporarily unavailable"))
      .mockResolvedValue(undefined);
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    openTodayInFullPage();

    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "A private draft before Done" } });
    fireEvent.click(screen.getByRole("button", { name: "Done for today" }));
    await waitFor(() => expect(screen.getByText("Not saved on this device")).toBeTruthy());
    expect(screen.queryByText("Day kept.")).toBeNull();

    // Recovery by ordinary Save is not permission to silently complete the page.
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "A private draft updated after failure" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved to this workspace")).toBeTruthy());
    expect(useStore.getState().journal.find((item) => item.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "A private draft updated after failure", notebookStatus: "draft" });
    expect(screen.queryByText("Day kept.")).toBeNull();

    // A fresh explicit Done, after storage recovers, must still complete once.
    fireEvent.click(screen.getByRole("button", { name: "Done for today" }));
    expect(await screen.findByText("Day kept.")).toBeTruthy();
    expect(useStore.getState().journal.find((item) => item.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "A private draft updated after failure", notebookStatus: "complete" });
    expect(flush).toHaveBeenCalledTimes(3);
  });

  it("reports Done as saved only after the completed entry is durable", async () => {
    let confirmDurability!: () => void;
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites")
      .mockReturnValue(new Promise<void>((resolve) => { confirmDurability = resolve; }));
    const assertExactWrite = vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => undefined);
    const assertWritesSince = vi.spyOn(localVault, "assertVaultWritesSince").mockImplementation(() => undefined);
    render(<JournalPage />);
    openTodayInFullPage();
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "A completed durable page" } });

    fireEvent.click(screen.getByRole("button", { name: "Done for today" }));

    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Saving to this workspace…")).toBeTruthy();
    expect(screen.queryByText("Saved to this workspace")).toBeNull();
    expect(screen.queryByText("Day kept.")).toBeNull();
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "A completed durable page", notebookStatus: "complete" });

    await act(async () => { confirmDurability(); await Promise.resolve(); });
    expect(screen.getByText("Day kept.")).toBeTruthy();
    expect(assertExactWrite).toHaveBeenCalledTimes(1);
    expect(assertWritesSince).toHaveBeenCalledTimes(1);
  });

  it("does not claim or attempt completion for a blank new page", async () => {
    const flush = vi.spyOn(localVault, "flushLocalVaultWrites");
    render(<JournalPage />);
    openTodayInFullPage();

    fireEvent.click(screen.getByRole("button", { name: "Done for today" }));

    expect(screen.getByRole("alert").textContent).toMatch(/write one line.*nothing has been saved yet/i);
    expect(screen.getByText("Ready to write")).toBeTruthy();
    expect(screen.queryByText("Saved to this workspace")).toBeNull();
    expect(flush).not.toHaveBeenCalled();
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY))).toBeUndefined();
  });

  it("keeps failed saves open in memory and never labels them durable", async () => {
    vi.useFakeTimers();
    vi.spyOn(localVault, "flushLocalVaultWrites").mockRejectedValue(new Error("Forced durable write failure"));
    render(<JournalPage />);
    openTodayInFullPage();
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Still open in memory" } });

    await act(async () => { vi.advanceTimersByTime(450); await Promise.resolve(); });
    expect(useStore.getState().journal.find((entry) => entry.date.startsWith(TODAY_KEY)))
      .toMatchObject({ freeWriting: "Still open in memory" });
    expect(screen.queryByText("Saved to this workspace")).toBeNull();
    expect(screen.getByText("Not saved on this device")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/still open.*could not confirm.*local storage/i);
  });

  it("explains a stale-tab conflict without claiming the open draft was saved", async () => {
    vi.spyOn(localVault, "assertVaultWrite").mockImplementation(() => {
      const conflict = new Error(localVault.VAULT_CONFLICT_MESSAGE);
      conflict.name = "VaultConflictError";
      throw conflict;
    });
    render(<JournalPage />);
    openTodayInFullPage();
    fireEvent.change(screen.getByLabelText("Free writing"), { target: { value: "Keep this tab's draft visible" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Not saved on this device")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(localVault.VAULT_CONFLICT_MESSAGE);
    expect(screen.getAllByDisplayValue("Keep this tab's draft visible")[0]).toBeTruthy();
    expect(screen.queryByText("Saved to this workspace")).toBeNull();
  });

  it("shows the exact account size refusal beside Journal images with recovery actions", async () => {
    useAccount.setState({
      link: "linked",
      protection: "blocked",
      syncFailure: { kind: "rejected", rejection: "too-large", status: 0, at: "2026-10-15T10:00:00.000Z" },
    });
    render(<JournalPage />);
    openTodayInFullPage();

    const warning = screen.getByRole("alert");
    expect(warning.textContent).toMatch(/Account protection blocked/);
    expect(warning.textContent).toMatch(/locally confirmed Journal copy remains on this device.*not protected in your account/);
    expect(warning.textContent).toMatch(/prepared workspace exceeds the 14 MB account limit/);
    fireEvent.click(within(warning).getByRole("button", { name: "Emergency recovery" }));
    expect(useUi.getState().settingsRequest).toBe("backup");
    fireEvent.click(within(warning).getByRole("button", { name: "Open Account" }));
    expect(useUi.getState().settingsRequest).toBe("account");
  });

  it("rejects unsafe files, removes a local image, and exports without a network call", async () => {
    useStore.setState({
      journal: [{
        id: "today",
        date: `${TODAY_KEY}T12:00:00`,
        today: "Saved page",
        tomorrow: "",
        blockers: "",
        energy: "",
        rating: "Daily review",
        attachments: [localImage],
      }],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const createObjectURL = vi.fn(() => "blob:journal-export");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<JournalPage />);
    openTodayInFullPage();
    fireEvent.click(screen.getByText("How images are stored"));
    expect(screen.getByText(/images are saved locally first and included in portable exports/i)).toBeTruthy();
    expect(screen.getByText(/Linked account backups may include them when the workspace fits account limits/i)).toBeTruthy();
    expect(screen.queryByText(/Nothing is uploaded/i)).toBeNull();
    const input = screen.getByLabelText("Choose a journal image");
    fireEvent.change(input, { target: { files: [new File(["not an image"], "notes.txt", { type: "text/plain" })] } });
    expect((await screen.findByRole("alert")).textContent).toContain("Use a JPG, PNG, WebP, or GIF image.");

    fireEvent.click(screen.getByRole("button", { name: "Export study-desk.png" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove study-desk.png" }));
    await waitFor(() => expect(screen.queryByAltText("study-desk.png")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(useStore.getState().journal[0].attachments).toEqual([]));
  });

  it("never renders malformed attachment metadata injected by an imported workspace", async () => {
    useStore.setState({
      journal: [{
        id: "unsafe-import",
        date: `${TODAY_KEY}T12:00:00`,
        today: "Imported text remains intact.",
        tomorrow: "",
        blockers: "",
        energy: "",
        rating: "Daily review",
        attachments: [{
          id: "unsafe-svg",
          name: "unsafe.svg",
          type: "image/svg+xml",
          size: 100,
          createdAt: "not-a-date",
          dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        } as unknown as JournalImageAttachment, {
          id: "mismatched-prefix",
          name: "claimed.png",
          type: "image/png",
          size: 4,
          createdAt: "2026-07-13T12:00:00.000Z",
          dataUrl: "data:image/jpeg;base64,YXhvbQ==",
        }],
      }],
    });

    render(<JournalPage />);
    openTodayInFullPage();
    expect(await screen.findByDisplayValue("Imported text remains intact.")).toBeTruthy();
    expect(screen.queryByAltText("unsafe.svg")).toBeNull();
    expect(screen.queryByAltText("claimed.png")).toBeNull();
    expect(screen.queryByRole("button", { name: /Export unsafe|Export claimed/ })).toBeNull();
  });

  it("includes the day's summary automatically, with the user's corrections and omissions", async () => {
    render(<JournalPage />);
    openTodayInFullPage();
    fireEvent.click(screen.getByRole("button", { name: "Show day summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Correct Focused time" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Correct Focused time" }), { target: { value: "45 min after correcting a late log" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide Energy and readiness" }));
    const summary = screen.getByRole("complementary", { name: "Day at a glance" });
    expect(within(summary).getByText("45 min after correcting a late log")).toBeTruthy();
    expect(within(summary).getByRole("button", { name: "Show Energy and readiness" })).toBeTruthy();
    expect(screen.getByText(/Every visible line is included in your page automatically/)).toBeTruthy();
  });
});
