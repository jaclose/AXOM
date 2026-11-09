// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { useUi } from "../lib/uiStore";
import { useAccount } from "../lib/account/accountStore";
import { usePomodoro } from "../lib/pomodoro";
import { dayKey } from "../lib/scoring";
import { localDateKey } from "../lib/dailyRollover";
import { DEFAULT_JOURNAL_NOTEBOOK } from "../lib/journalNotebook";
import { JournalPage } from "./JournalPage";

const workspaceId = "journal-feedback-interleaving-r15";
const account = {
  id: "journal-feedback-interleaving-account",
  email: "journal-interleaving@example.test",
  displayName: "Fixture",
  emailConfirmed: true,
};
const draftKey = `axom-journal-feedback-draft:${workspaceId}:account:${account.id}`;

beforeEach(() => {
  useStore.setState({
    ...makeSeed(),
    activeDayKey: dayKey(),
    lastActiveLocalDate: localDateKey(),
    journal: [],
    dayPlans: [],
    tasks: [],
    logs: [],
  });
  useStore.setState((state) => ({
    profile: {
      ...state.profile,
      userId: workspaceId,
      journalNotebook: { ...DEFAULT_JOURNAL_NOTEBOOK, setupCompleted: true },
    },
  }));
  useUi.setState({ journalDay: null, settingsRequest: null });
  useAccount.setState({
    user: account,
    phase: "signed-in",
    link: "linked",
    protection: "protected",
    syncFailure: undefined,
  });
  usePomodoro.setState({ running: false, focusRunStarted: false, secondsLeft: 1500, phase: "focus" });
  window.history.replaceState(null, "", "#journal");
  window.localStorage.removeItem(draftKey);
  window.localStorage.removeItem(`${draftKey}:submitted`);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAccount.setState({ user: null, phase: "signed-out", link: "unlinked", protection: "local-only" });
  window.localStorage.removeItem(draftKey);
  window.localStorage.removeItem(`${draftKey}:submitted`);
  window.history.replaceState(null, "", "#journal");
});

describe("Journal feedback concurrent local draft writes (RED-only acceptance)", () => {
  it("does not replace tab B's newer draft when tab B writes between tab A's check and write", () => {
    const initial = {
      rating: 4,
      liked: "Original saved text.",
      wantMore: "",
      missing: "",
      painPoints: "",
      comment: "",
    };
    const bRevision = "b".repeat(32);
    const bDraft = JSON.stringify({
      ...initial,
      liked: "A newer private revision from another tab.",
      __axomRevision: bRevision,
    });
    window.localStorage.setItem(draftKey, JSON.stringify(initial));

    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    const liked = screen.getByLabelText("What do you like?") as HTMLTextAreaElement;
    expect(liked.value).toBe(initial.liked);

    // Deterministic mounted-component interleaving: tab A's getItem returns
    // the old value even though an independent writer commits B's new value
    // before A proceeds to setItem. This is NOT a true two-tab browser test.
    const nativeGet = Storage.prototype.getItem;
    const nativeSet = Storage.prototype.setItem;
    let bWroteDuringRead = false;
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      const readBeforeBWrite = nativeGet.call(this, key);
      if (this === window.localStorage && key === draftKey && !bWroteDuringRead) {
        bWroteDuringRead = true;
        nativeSet.call(this, key, bDraft);
      }
      return readBeforeBWrite;
    });

    try {
      act(() => {
        fireEvent.change(liked, { target: { value: "An unsaved change from tab A." } });
      });
    } finally {
      spy.mockRestore();
    }

    expect(bWroteDuringRead).toBe(true);
    // A's in-memory words must remain recoverable even if persistence pauses.
    expect(liked.value).toBe("An unsaved change from tab A.");
    // Key invariant. The current non-atomic getItem/setItem pair violates it.
    expect(window.localStorage.getItem(draftKey)).toBe(bDraft);
    expect(screen.getByRole("alert").textContent).toMatch(/another tab changed/i);
    expect(screen.getByRole("button", { name: "Download draft" })).toBeTruthy();
  });
});
