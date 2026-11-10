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
import { userIdFromName } from "../lib/userIdentity";
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

    // Repeated failure must retain keyboard focus and the unsaved text.
    fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry reading saved feedback" }));
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

  it("retains volatile feedback across a same-tab Journal route unmount without modifying older saved bytes", () => {
    const originalGet = Storage.prototype.getItem;
    const blockedRead = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, storageKey: string) {
      if (this === window.localStorage && storageKey.startsWith(key)) throw new Error("Storage read denied");
      return originalGet.call(this, storageKey);
    });
    const writes = vi.spyOn(Storage.prototype, "setItem");

    const first = render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    fireEvent.change(screen.getByLabelText("What do you like?"), {
      target: { value: "Do not lose this when the Journal route unmounts." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    first.unmount(); // Same-tab SPA route exit, not a browser reload.
    useStore.setState((state) => ({ profile: { ...state.profile, userId: "other-private-workspace" } }));
    const other = render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("");
    other.unmount(); // Never expose workspace A's in-memory text in workspace B.
    useStore.setState((state) => ({ profile: { ...state.profile, userId: workspaceId } }));
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));

    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Do not lose this when the Journal route unmounts.");
    expect(screen.getByRole("button", { name: "Download draft" })).toBeTruthy();
    expect(originalGet.call(localStorage, key)).toBe(oldDraft);
    expect(writes.mock.calls.some(([storageKey]) => String(storageKey).startsWith(key))).toBe(false);

    blockedRead.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    const copies = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .filter((item) => item?.startsWith(`${key}:writer:`));
    expect(copies).toHaveLength(1);
    expect(JSON.parse(originalGet.call(localStorage, copies[0]!) ?? "{}").liked)
      .toBe("Do not lose this when the Journal route unmounts.");
    expect(originalGet.call(localStorage, key)).toBe(oldDraft);
  });

  it("keeps unreadable feedback through a name-only rename on the same signed-in account, not account B", async () => {
    const firstName = "Private Writer Original";
    const nextName = "Private Writer Renamed";
    const owner = {
      id: "journal-rename-account-A", email: "journal-a@example.test",
      displayName: "Writer A", emailConfirmed: true,
    };
    const other = { ...owner, id: "journal-rename-account-B", email: "journal-b@example.test" };
    useAccount.setState({ user: owner, phase: "signed-in", link: "linked" });
    useStore.getState().updateProfile({ name: firstName });
    const originalKey = `axom-journal-feedback-draft:${userIdFromName(firstName)}:account:${owner.id}`;
    const renamedKey = `axom-journal-feedback-draft:${userIdFromName(nextName)}:account:${owner.id}`;
    const originalGet = Storage.prototype.getItem;
    localStorage.setItem(originalKey, oldDraft);
    const denied = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, storageKey: string) {
      if (this === window.localStorage && storageKey.startsWith("axom-journal-feedback-draft:"))
        throw new Error("Feedback read unavailable");
      return originalGet.call(this, storageKey);
    });
    const writes = vi.spyOn(Storage.prototype, "setItem");

    const first = render(<JournalPage hasAccountWorkspaceReceipt={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    fireEvent.change(screen.getByLabelText("What do you like?"), {
      target: { value: "Do not discard my private feedback after changing my display name." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    first.unmount();

    useStore.getState().updateProfile({ name: nextName });
    const second = render(<JournalPage hasAccountWorkspaceReceipt={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Do not discard my private feedback after changing my display name.");

    await act(async () => { useAccount.setState({ user: other }); });
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("");
    await act(async () => { useAccount.setState({ user: owner }); });
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Do not discard my private feedback after changing my display name.");
    const firstJournal = useStore.getState().journal;
    await act(async () => { useStore.setState((state) => ({
      profile: { ...state.profile, userId: "journal-renamed-separate-workspace" },
      journal: [...state.journal],
    })); });
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("");
    await act(async () => { useStore.setState((state) => ({
      profile: { ...state.profile, userId: userIdFromName(nextName) },
      journal: firstJournal,
    })); });
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Do not discard my private feedback after changing my display name.");
    expect(originalGet.call(localStorage, originalKey)).toBe(oldDraft);
    expect(writes.mock.calls.some(([storageKey]) => String(storageKey).startsWith("axom-journal-feedback-draft:")))
      .toBe(false);

    denied.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    const saved = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .filter((value) => value?.startsWith(`${renamedKey}:writer:`));
    expect(saved).toHaveLength(1);
    expect(JSON.parse(originalGet.call(localStorage, saved[0]!) ?? "{}").liked)
      .toBe("Do not discard my private feedback after changing my display name.");
    expect(originalGet.call(localStorage, originalKey)).toBe(oldDraft);
    // Reverting the display name must show the original saved draft, not a
    // stale volatile alias after the renamed copy was safely saved.
    await act(async () => { useStore.getState().updateProfile({ name: firstName }); });
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Older private saved feedback.");
    second.unmount();
    localStorage.removeItem(originalKey);
    for (const item of saved) localStorage.removeItem(item!);
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
    expect(document.activeElement).toBe(recovered);
    expect(screen.getByText("Saved feedback is readable again.").getAttribute("role")).toBe("status");
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
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.getByRole("button", { name: "Download saved copy" })).toBeTruthy();
    expect(localStorage.getItem(key)).toBe(unsupported);
    expect(writes.mock.calls.some(([storageKey]) => String(storageKey).startsWith(key))).toBe(false);
  });
  it("never carries an account A retry announcement into account B's feedback dialog", async () => {
    const ownerA = { id: "journal-retry-account-A", email: "a@example.test", displayName: "A", emailConfirmed: true };
    const ownerB = { ...ownerA, id: "journal-retry-account-B", email: "b@example.test" };
    useAccount.setState({ user: ownerA, phase: "signed-in", link: "linked" });
    const oldGet = Storage.prototype.getItem;
    const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, storageKey: string) {
      if (this === window.localStorage && storageKey.startsWith(`${key}:account:${ownerA.id}`))
        throw new Error("Account A feedback reads unavailable");
      return oldGet.call(this, storageKey);
    });

    render(<JournalPage hasAccountWorkspaceReceipt={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    blocked.mockRestore();
    await act(async () => { useAccount.setState({ user: ownerB }); });
    expect(screen.queryByText("Saved feedback is readable again.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry reading saved feedback" })).toBeNull();
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("");
    // Returning to A is a new visit: it must not reuse the old retry focus or status.
    await act(async () => { useAccount.setState({ user: ownerA }); });
    expect(screen.queryByText("Saved feedback is readable again.")).toBeNull();
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("");
    expect(document.activeElement).not.toBe(screen.getByLabelText("What do you like?"));
    // No storage mutation or feedback submission in this synthetic identity handoff.
  });

  it("does not show account-scoped feedback or enable Send while password recovery is in progress", async () => {
    // The account store can keep a user object during PASSWORD_RECOVERY, but
    // only a confirmed signed-in phase may open that account's saved feedback.
    const isolatedWorkspace = "journal-feedback-recovery-phase-r23";
    const localKey = `axom-journal-feedback-draft:${isolatedWorkspace}`;
    const owner = {
      id: "journal-recovery-account-A", email: "journal-recovery@example.test",
      displayName: "Recovery A", emailConfirmed: true,
    };
    const accountKey = `${localKey}:account:${owner.id}`;
    const localRaw = JSON.stringify({ ...JSON.parse(oldDraft), liked: "Workspace-only feedback." });
    const accountRaw = JSON.stringify({ ...JSON.parse(oldDraft), liked: "Private account A feedback." });
    useStore.setState((state) => ({ profile: { ...state.profile, userId: isolatedWorkspace } }));
    localStorage.setItem(localKey, localRaw);
    localStorage.setItem(accountKey, accountRaw);
    useAccount.setState({ user: owner, phase: "recovering-password", link: "linked" });
    const writes = vi.spyOn(Storage.prototype, "setItem");

    render(<JournalPage hasAccountWorkspaceReceipt={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Workspace-only feedback.");
    expect((screen.getByRole("button", { name: "Send feedback" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { useAccount.setState({ phase: "signed-in" }); });
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Private account A feedback.");
    expect((screen.getByRole("button", { name: "Send feedback" }) as HTMLButtonElement).disabled).toBe(false);

    await act(async () => { useAccount.setState({ phase: "recovering-password" }); });
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Workspace-only feedback.");
    expect((screen.getByRole("button", { name: "Send feedback" }) as HTMLButtonElement).disabled).toBe(true);
    expect(localStorage.getItem(accountKey)).toBe(accountRaw);
    expect(localStorage.getItem(localKey)).toBe(localRaw);
    expect(writes.mock.calls.some(([storageKey]) =>
      String(storageKey).startsWith(localKey))).toBe(false);

    localStorage.removeItem(localKey);
    localStorage.removeItem(accountKey);
    // No user feedback, account record, or notebook content was submitted.
  });

  it("recovers previously saved feedback after a name-only rename and remount without editing its bytes", () => {
    const before = "Journal R24 Previous Display Name";
    const after = "Journal R24 Updated Display Name";
    useStore.getState().updateProfile({ name: before });
    const priorKey = `axom-journal-feedback-draft:${userIdFromName(before)}`;
    const nextKey = `axom-journal-feedback-draft:${userIdFromName(after)}`;
    const previous = JSON.stringify({ ...JSON.parse(oldDraft), liked: "Saved before a name change." });
    localStorage.setItem(priorKey, previous);

    const first = render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Saved before a name change.");
    first.unmount();

    // A real browser reload clears component state but keeps localStorage.
    // There is no volatile in-tab edit to carry across this remount.
    useStore.getState().updateProfile({ name: after });
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
    fireEvent.click(screen.getByText("Other saved feedback copies (1)"));
    fireEvent.click(screen.getByRole("button", { name: "Open copy 1" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Saved before a name change.");
    expect(localStorage.getItem(priorKey)).toBe(previous);
    expect(localStorage.getItem(nextKey)).toBeNull();
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const storageKey = localStorage.key(i);
      if (storageKey?.startsWith(priorKey) || storageKey?.startsWith(nextKey)) localStorage.removeItem(storageKey);
    }
  });

  it("keeps historical rename pointers private to their signed-in account", async () => {
    const before = "Journal R24 Signed In A Before";
    const after = "Journal R24 Signed In A After";
    const ownerA = { id: "journal-r24-account-a", email: "a@example.test", displayName: "A", emailConfirmed: true };
    const ownerB = { ...ownerA, id: "journal-r24-account-b", email: "b@example.test" };
    useAccount.setState({ user: ownerA, phase: "signed-in", link: "linked" });
    useStore.getState().updateProfile({ name: before });
    const ownerAKey = `axom-journal-feedback-draft:${userIdFromName(before)}:account:${ownerA.id}`;
    const renamedAKey = `axom-journal-feedback-draft:${userIdFromName(after)}:account:${ownerA.id}`;
    const renamedBKey = `axom-journal-feedback-draft:${userIdFromName(after)}:account:${ownerB.id}`;
    const original = JSON.stringify({ ...JSON.parse(oldDraft), liked: "Account A historic private feedback." });
    localStorage.setItem(ownerAKey, original);
    useStore.getState().updateProfile({ name: after });
    render(<JournalPage hasAccountWorkspaceReceipt={() => true} />);

    await act(async () => { useAccount.setState({ user: ownerB }); });
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText(/Other saved feedback copies/)).toBeNull();

    await act(async () => { useAccount.setState({ user: ownerA }); });
    expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
    fireEvent.click(screen.getByText("Other saved feedback copies (1)"));
    fireEvent.click(screen.getByRole("button", { name: "Open copy 1" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Account A historic private feedback.");
    expect(localStorage.getItem(ownerAKey)).toBe(original);
    expect(localStorage.getItem(renamedBKey)).toBeNull();
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const storageKey = localStorage.key(i);
      if (storageKey?.startsWith(ownerAKey) || storageKey?.startsWith(renamedAKey)) localStorage.removeItem(storageKey);
    }
  });


});
