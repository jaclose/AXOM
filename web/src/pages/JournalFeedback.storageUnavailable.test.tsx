// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

const workspaceId = "journal-feedback-read-blocked-r17";
const key = `axom-journal-feedback-draft:${workspaceId}`;
const oldDraft = JSON.stringify({
  rating: 3, liked: "Older private saved feedback.", wantMore: "",
  missing: "", painPoints: "", comment: "",
});

function clearFixtureCopies() {
  for (const item of Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))) {
    if (item?.startsWith(key)) localStorage.removeItem(item);
  }
}

beforeEach(() => {
  useStore.setState({
    ...makeSeed(), activeDayKey: dayKey(), lastActiveLocalDate: localDateKey(),
    journal: [], dayPlans: [], tasks: [], logs: [],
  });
  useStore.setState((state) => ({
    profile: {
      ...state.profile, userId: workspaceId,
      journalNotebook: { ...DEFAULT_JOURNAL_NOTEBOOK, setupCompleted: true },
    },
  }));
  useUi.setState({ journalDay: null, settingsRequest: null });
  useAccount.setState({ user: null, phase: "signed-out", link: "unlinked", protection: "local-only" });
  usePomodoro.setState({ running: false, focusRunStarted: false, secondsLeft: 1500, phase: "focus" });
  clearFixtureCopies();
  localStorage.setItem(key, oldDraft);
  window.history.replaceState(null, "", "#journal");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearFixtureCopies();
  window.history.replaceState(null, "", "#journal");
});

describe("Journal feedback when browser storage cannot be read", () => {
  it("lets the owner write and recover a volatile draft without overwriting unknown legacy bytes", () => {
    const originalGet = Storage.prototype.getItem;
    const blockedRead = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, storageKey: string) {
      if (this === window.localStorage && storageKey.startsWith(key)) throw new Error("Storage read unavailable");
      return originalGet.call(this, storageKey);
    });
    const writes = vi.spyOn(Storage.prototype, "setItem");

    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    const liked = screen.getByLabelText("What do you like?") as HTMLTextAreaElement;
    expect(liked.readOnly).toBe(false);
    fireEvent.change(liked, { target: { value: "A new in-tab draft while reads are blocked." } });
    expect(screen.getByRole("button", { name: "Download draft" })).toBeTruthy();
    expect(originalGet.call(localStorage, key)).toBe(oldDraft);
    expect(writes.mock.calls.some(([storageKey]) => String(storageKey).startsWith(key))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("A new in-tab draft while reads are blocked.");

    blockedRead.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    expect(originalGet.call(localStorage, key)).toBe(oldDraft);
    const writerKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .filter((value): value is string => Boolean(value?.startsWith(`${key}:writer:`)));
    expect(writerKeys).toHaveLength(1);
    expect(JSON.parse(originalGet.call(localStorage, writerKeys[0]) ?? "{}").liked)
      .toBe("A new in-tab draft while reads are blocked.");

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download copy 1" })).toBeTruthy();
    // No Send action: the simulated feedback remains entirely local.
  });

  it("offers in-dialog retry when only the saved submission marker cannot be read", () => {
    const originalGet = Storage.prototype.getItem;
    const markerRead = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, storageKey: string) {
      if (this === window.localStorage && storageKey === `${key}:submitted`)
        throw new Error("Temporary receipt read failure");
      return originalGet.call(this, storageKey);
    });
    const writes = vi.spyOn(Storage.prototype, "setItem");

    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    const liked = screen.getByLabelText("What do you like?") as HTMLTextAreaElement;
    expect(liked.readOnly).toBe(true);
    expect(liked.value).toBe("");
    expect(originalGet.call(localStorage, key)).toBe(oldDraft);
    expect(writes.mock.calls.some(([storageKey]) => String(storageKey).startsWith(key))).toBe(false);

    markerRead.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    const recovered = screen.getByLabelText("What do you like?") as HTMLTextAreaElement;
    expect(recovered.readOnly).toBe(false);
    expect(recovered.value).toBe("Older private saved feedback.");
    expect(originalGet.call(localStorage, key)).toBe(oldDraft);
    expect(writes.mock.calls.some(([storageKey]) => String(storageKey).startsWith(key))).toBe(false);
  });

  it("keeps unsupported saved bytes locked even when the owner explicitly retries reading", () => {
    const unsupported = JSON.stringify({ ...JSON.parse(oldDraft), futurePrivateField: "Do not silently discard." });
    localStorage.setItem(key, unsupported);
    const writes = vi.spyOn(Storage.prototype, "setItem");

    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.getByRole("button", { name: "Download saved copy" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.getByRole("button", { name: "Download saved copy" })).toBeTruthy();
    expect(localStorage.getItem(key)).toBe(unsupported);
    expect(writes.mock.calls.some(([storageKey]) => String(storageKey).startsWith(key))).toBe(false);
  });
});
