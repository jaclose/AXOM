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

function clearFixtureDrafts() {
  const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index));
  keys.filter((key): key is string => Boolean(key?.startsWith(`axom-journal-feedback-draft:${workspaceId}`)))
    .forEach((key) => window.localStorage.removeItem(key));
}

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
  clearFixtureDrafts();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAccount.setState({ user: null, phase: "signed-out", link: "unlinked", protection: "local-only" });
  clearFixtureDrafts();
  window.history.replaceState(null, "", "#journal");
});

describe("Journal feedback concurrent local draft writes", () => {
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

    render(<JournalPage hasAccountWorkspaceReceipt={() => true} />);
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
    // A legacy writer's newer bytes and this editor's separate copy both survive.
    expect(window.localStorage.getItem(draftKey)).toBe(bDraft);
    const writerKeys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(`${draftKey}:writer:`)));
    expect(writerKeys).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(writerKeys[0]) ?? "{}").liked)
      .toBe("An unsaved change from tab A.");
    expect(screen.getByRole("alert").textContent).toMatch(/another tab changed/i);
    expect(screen.getByRole("button", { name: "Download draft" })).toBeTruthy();
    fireEvent.change(liked, { target: { value: "Tab A kept writing after the conflict." } });
    expect(JSON.parse(window.localStorage.getItem(writerKeys[0]) ?? "{}").liked)
      .toBe("Tab A kept writing after the conflict.");
  });

  it("waits for B's workspace before opening B feedback under its owner key", () => {
    const aJournal = useStore.getState().journal;
    let trustedAccount = account.id;
    let trustedJournal = aJournal;
    const hasReceipt = (id: string, journal: typeof aJournal) => id === trustedAccount && journal === trustedJournal;
    render(<JournalPage hasAccountWorkspaceReceipt={hasReceipt} />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    fireEvent.change(screen.getByLabelText("What do you like?"), { target: { value: "A's private feedback" } });

    const bAccount = { ...account, id: "journal-feedback-interleaving-account-B" };
    act(() => { useAccount.setState({ user: bAccount, phase: "signed-in" }); });
    expect(screen.getByRole("heading", { name: "Journal paused" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "How is the journal feeling?" })).toBeNull();
    const wrongBKey = `axom-journal-feedback-draft:${workspaceId}:account:${bAccount.id}`;
    expect(window.localStorage.getItem(wrongBKey)).toBeNull();

    const bJournal: typeof aJournal = [];
    const bWorkspaceId = `${workspaceId}-B`;
    act(() => {
      trustedAccount = bAccount.id;
      trustedJournal = bJournal;
      useStore.setState((state) => ({
        journal: bJournal,
        profile: { ...state.profile, userId: bWorkspaceId },
      }));
    });
    const bDialog = screen.getByRole("dialog", { name: "How is the journal feeling?" });
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("What do you like?"), { target: { value: "B's separate private feedback" } });
    expect(bDialog).toBeTruthy();
    const bWriterPrefix = `axom-journal-feedback-draft:${bWorkspaceId}:account:${bAccount.id}:writer:`;
    const bWriterKey = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .find((key) => key?.startsWith(bWriterPrefix));
    expect(bWriterKey).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(bWriterKey!) ?? "{}").liked)
      .toBe("B's separate private feedback");
  });

  it("recovers A's unsaved feedback in this tab after a failed write and A to B to A handoff", () => {
    const aJournal = useStore.getState().journal;
    let trustedAccount = account.id;
    const hasReceipt = (id: string, journal: typeof aJournal) => id === trustedAccount && journal === aJournal;
    const nativeSet = Storage.prototype.setItem;
    const failedWrite = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (this === window.localStorage && key.startsWith(`${draftKey}:writer:`)) throw new Error("Storage quota unavailable");
      nativeSet.call(this, key, value);
    });

    render(<JournalPage hasAccountWorkspaceReceipt={hasReceipt} />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    fireEvent.change(screen.getByLabelText("What do you like?"), { target: { value: "A's private words during a storage failure" } });
    expect(screen.getByRole("alert").textContent).toMatch(/could not keep a local draft/i);

    const bAccount = { ...account, id: "journal-feedback-interleaving-account-B" };
    act(() => { useAccount.setState({ user: bAccount, phase: "signed-in" }); });
    expect(screen.getByRole("heading", { name: "Journal paused" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "How is the journal feeling?" })).toBeNull();
    act(() => { trustedAccount = account.id; useAccount.setState({ user: account, phase: "signed-in" }); });

    const restored = screen.getByLabelText("What do you like?") as HTMLTextAreaElement;
    expect(restored.value).toBe("A's private words during a storage failure");
    expect(screen.getByRole("button", { name: "Download draft" })).toBeTruthy();
    failedWrite.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry draft save" }));
    const writerKey = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .find((key) => key?.startsWith(`${draftKey}:writer:`));
    expect(writerKey).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(writerKey!) ?? "{}").liked)
      .toBe("A's private words during a storage failure");
  });
});
