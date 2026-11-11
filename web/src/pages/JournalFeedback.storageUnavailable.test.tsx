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
  it("keeps a name-cycle retry blocked until both A→B→A links are durably written", () => {
    clearFixtureCopies();
    const nameA = "Journal R34 Original Owner";
    const nameB = "Journal R34 Temporary Name";
    const aKey = `axom-journal-feedback-draft:${userIdFromName(nameA)}`;
    const bKey = `axom-journal-feedback-draft:${userIdFromName(nameB)}`;
    const original = JSON.stringify({ ...JSON.parse(oldDraft), liked: "R34 original private draft unchanged." });
    useStore.getState().updateProfile({ name: nameA });
    localStorage.setItem(aKey, original);
    const initial = render(<JournalPage />);
    initial.unmount();

    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    const blockedReads = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, storageKey: string) {
      if (this === window.localStorage && storageKey.startsWith("axom-journal-feedback-draft:"))
        throw new Error("Feedback browser storage temporarily unavailable");
      return originalGet.call(this, storageKey);
    });

    try {
      useStore.getState().updateProfile({ name: nameB });
      useStore.getState().updateProfile({ name: nameA });
      blockedReads.mockRestore();
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect(screen.getByRole("button", { name: "Retry reading saved feedback" })).toBeTruthy();

      // Even a fully persisted cycle must not clear an unwritten tail.
      const blockedWrites = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, storageKey: string, value: string) {
        if (this === window.localStorage && storageKey.startsWith(`${bKey}:name-alias:v1:`))
          throw new Error("The second historical pointer is still unwritable");
        return originalSet.call(this, storageKey, value);
      });
      fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
      expect(screen.getByRole("button", { name: "Retry reading saved feedback" })).toBeTruthy();
      blockedWrites.mockRestore();

      // On retry, both same-owner links are now durable. The cycle must
      // terminate without keeping an imaginary missing pointer.
      fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
      expect(screen.queryByRole("button", { name: "Retry reading saved feedback" })).toBeNull();
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
        .toBe("R34 original private draft unchanged.");
      expect(originalGet.call(localStorage, aKey)).toBe(original);
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
      expect(keys.filter((key) => key?.startsWith(`${aKey}:name-alias:v1:`))).toHaveLength(1);
      expect(keys.filter((key) => key?.startsWith(`${bKey}:name-alias:v1:`))).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const item = localStorage.key(index);
        if (item && (item === aKey || item.startsWith(`${aKey}:`) || item === bKey || item.startsWith(`${bKey}:`)))
          localStorage.removeItem(item);
      }
    }
  });

  for (const [caseName, aliasValue] of [
    ["empty pointer", ""],
    ["malformed pointer", "not-a-journal-owner"],
    ["other-account pointer", "axom-journal-feedback-draft:foreign:account:other-account"],
    ["pointer disappears after inventory", null],
  ] as const) {
    it(`keeps history recovery blocked when an enumerated alias has an ${caseName}`, () => {
      clearFixtureCopies();
      const oldName = "Journal R36 Older Saved Owner";
      const currentName = "Journal R36 Current Saved Owner";
      const oldKey = `axom-journal-feedback-draft:${userIdFromName(oldName)}`;
      const currentKey = `axom-journal-feedback-draft:${userIdFromName(currentName)}`;
      const aliasKey = `${currentKey}:name-alias:v1:${"a".repeat(32)}`;
      const original = JSON.stringify({ ...JSON.parse(oldDraft), liked: "Original R36 private feedback remains intact." });
      useStore.getState().updateProfile({ name: currentName });
      localStorage.setItem(oldKey, original);
      localStorage.setItem(aliasKey, aliasValue === null ? oldKey : aliasValue);
      const originalGet = Storage.prototype.getItem;
      if (aliasValue === null) {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, storageKey: string) {
          return this === window.localStorage && storageKey === aliasKey
            ? null : originalGet.call(this, storageKey);
        });
      }
      try {
        render(<JournalPage />);
        fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
        // A present but damaged/dropped alias is not proof that no older copy exists.
        expect(screen.getByRole("button", { name: "Retry reading saved feedback" })).toBeTruthy();
        expect(screen.queryByText("Other saved feedback copies (1)")).toBeNull();
        expect(originalGet.call(localStorage, oldKey)).toBe(original);
        expect(originalGet.call(localStorage, aliasKey)).toBe(aliasValue === null ? oldKey : aliasValue);
        // Repair only the corrupt test pointer. An explicit Retry must expose
        // the unchanged historical draft without overwriting either owner.
        vi.restoreAllMocks();
        localStorage.setItem(aliasKey, oldKey);
        fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
        expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
        fireEvent.click(screen.getByText("Other saved feedback copies (1)"));
        fireEvent.click(screen.getByRole("button", { name: "Open copy 1" }));
        expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
          .toBe("Original R36 private feedback remains intact.");
        expect(localStorage.getItem(oldKey)).toBe(original);
      } finally {
        cleanup();
        vi.restoreAllMocks();
        localStorage.removeItem(oldKey);
        localStorage.removeItem(aliasKey);
      }
    });
  }

  for (const [description, suffix] of [
    ["truncated", "a".repeat(31)],
    ["non-hex", "g".repeat(32)],
  ] as const) {
    it(`does not silently hide older saved feedback when a name-link key has a ${description} suffix`, () => {
      clearFixtureCopies();
      const previousName = "Journal R37 Previous Workspace Name";
      const currentName = "Journal R37 Current Workspace Name";
      const previousKey = `axom-journal-feedback-draft:${userIdFromName(previousName)}`;
      const currentKey = `axom-journal-feedback-draft:${userIdFromName(currentName)}`;
      const invalidKey = `${currentKey}:name-alias:v1:${suffix}`;
      const repairedKey = `${currentKey}:name-alias:v1:${"b".repeat(32)}`;
      const savedBytes = JSON.stringify({ ...JSON.parse(oldDraft), liked: "R37 original words stay intact." });
      useStore.getState().updateProfile({ name: currentName });
      localStorage.setItem(previousKey, savedBytes);
      localStorage.setItem(invalidKey, previousKey);
      try {
        render(<JournalPage />);
        fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
        expect(screen.getByRole("button", { name: "Retry reading saved feedback" })).toBeTruthy();
        expect(screen.queryByText("Other saved feedback copies (1)")).toBeNull();
        expect(localStorage.getItem(previousKey)).toBe(savedBytes);
        expect(localStorage.getItem(invalidKey)).toBe(previousKey);

        // A repair changes only the test pointer, never the saved draft.
        localStorage.removeItem(invalidKey);
        localStorage.setItem(repairedKey, previousKey);
        fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
        expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
        fireEvent.click(screen.getByText("Other saved feedback copies (1)"));
        fireEvent.click(screen.getByRole("button", { name: "Open copy 1" }));
        expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
          .toBe("R37 original words stay intact.");
        expect(localStorage.getItem(previousKey)).toBe(savedBytes);
      } finally {
        cleanup();
        localStorage.removeItem(previousKey);
        localStorage.removeItem(invalidKey);
        localStorage.removeItem(repairedKey);
      }
    });
  }

  for (const [description, suffix] of [
    ["truncated", "a".repeat(31)],
    ["non-hex", "g".repeat(32)],
  ] as const) {
    it(`does not falsely complete saved feedback inventory when a writer key has a ${description} suffix`, () => {
      clearFixtureCopies();
      const currentName = "Journal R38 Current Writer Workspace";
      const currentKey = `axom-journal-feedback-draft:${userIdFromName(currentName)}`;
      const invalidKey = `${currentKey}:writer:${suffix}`;
      const repairedKey = `${currentKey}:writer:${"c".repeat(32)}`;
      const savedBytes = JSON.stringify({ ...JSON.parse(oldDraft), liked: "R38 original writer draft remains unchanged." });
      useStore.getState().updateProfile({ name: currentName });
      localStorage.setItem(currentKey, oldDraft);
      localStorage.setItem(invalidKey, savedBytes);
      try {
        render(<JournalPage />);
        fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
        expect(screen.getByRole("button", { name: "Retry reading saved feedback" })).toBeTruthy();
        expect(screen.queryByText("Other saved feedback copies (1)")).toBeNull();
        expect(localStorage.getItem(invalidKey)).toBe(savedBytes);

        // Repair only the test's corrupt index key. Never rewrite the saved words.
        localStorage.removeItem(invalidKey);
        localStorage.setItem(repairedKey, savedBytes);
        fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
        expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
        fireEvent.click(screen.getByText("Other saved feedback copies (1)"));
        fireEvent.click(screen.getByRole("button", { name: "Open copy 1" }));
        expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
          .toBe("R38 original writer draft remains unchanged.");
        expect(localStorage.getItem(repairedKey)).toBe(savedBytes);
        expect(localStorage.getItem(currentKey)).toBe(oldDraft);
      } finally {
        cleanup();
        localStorage.removeItem(currentKey);
        localStorage.removeItem(invalidKey);
        localStorage.removeItem(repairedKey);
      }
    });
  }

  it("recovers original feedback through 256 durable rename links but blocks a 257th", () => {
    clearFixtureCopies();
    const names = Array.from({ length: 258 }, (_, index) => `Journal R35 Boundary Name ${index}`);
    const ownerKeys = names.map((name) => `axom-journal-feedback-draft:${userIdFromName(name)}`);
    expect(new Set(ownerKeys).size).toBe(ownerKeys.length);
    const original = JSON.stringify({ ...JSON.parse(oldDraft), liked: "R35 original feedback bytes survive." });
    useStore.getState().updateProfile({ name: names[256] });
    localStorage.setItem(ownerKeys[0], original);
    // 256 historical edges require 257 owner nodes including the current name.
    for (let index = 1; index <= 256; index += 1) {
      localStorage.setItem(
        `${ownerKeys[index]}:name-alias:v1:${index.toString(16).padStart(32, "0")}`,
        ownerKeys[index - 1],
      );
    }

    try {
      const valid = render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect(screen.queryByRole("button", { name: "Retry reading saved feedback" })).toBeNull();
      expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
      fireEvent.click(screen.getByText("Other saved feedback copies (1)"));
      fireEvent.click(screen.getByRole("button", { name: "Open copy 1" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
        .toBe("R35 original feedback bytes survive.");
      expect(localStorage.getItem(ownerKeys[0])).toBe(original);
      valid.unmount();

      // The next rename crosses the bounded reader, so the inventory must
      // remain explicitly unavailable instead of silently omitting old text.
      useStore.getState().updateProfile({ name: names[257] });
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect(screen.getByRole("button", { name: "Retry reading saved feedback" })).toBeTruthy();
      expect(localStorage.getItem(ownerKeys[0])).toBe(original);
    } finally {
      cleanup();
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key && ownerKeys.some((owner) => key === owner || key.startsWith(`${owner}:`)))
          localStorage.removeItem(key);
      }
    }
  });

  it("keeps a 20-rename recovery chain during denied storage reads until explicit retry", () => {
    clearFixtureCopies();
    const names = Array.from({ length: 21 }, (_, index) => `Journal R33 Offline Rename ${index}`);
    const ownerKeys = names.map((name) => `axom-journal-feedback-draft:${userIdFromName(name)}`);
    const original = JSON.stringify({ ...JSON.parse(oldDraft), liked: "R33 original private feedback." });
    useStore.getState().updateProfile({ name: names[0] });
    localStorage.setItem(ownerKeys[0], original);
    const visit = render(<JournalPage />);
    visit.unmount();
    const originalGet = Storage.prototype.getItem;
    const denied = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, storageKey: string) {
      if (this === window.localStorage && storageKey.startsWith("axom-journal-feedback-draft:"))
        throw new Error("Transient feedback storage read outage");
      return originalGet.call(this, storageKey);
    });

    try {
      // Storage cannot prove an intermediate owner is empty or persist a
      // rename probe. Pending links must not be silently dropped at link 17.
      for (const name of names.slice(1)) useStore.getState().updateProfile({ name });
      denied.mockRestore();
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
      expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
      fireEvent.click(screen.getByText("Other saved feedback copies (1)"));
      fireEvent.click(screen.getByRole("button", { name: "Open copy 1" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
        .toBe("R33 original private feedback.");
      expect(originalGet.call(localStorage, ownerKeys[0])).toBe(original);
      const durable = ownerKeys.slice(1).map((owner) =>
        Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
          .filter((key) => key?.startsWith(`${owner}:name-alias:v1:`)));
      expect(durable.every((keys) => keys.length === 1)).toBe(true);
    } finally {
      denied.mockRestore();
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key && ownerKeys.some((owner) => key === owner || key.startsWith(`${owner}:`)))
          localStorage.removeItem(key);
      }
    }
  });

  it("recovers one original saved copy after 20 later display-name edits", () => {
    clearFixtureCopies();
    const names = Array.from({ length: 21 }, (_, index) => `Journal R32 Saved Rename ${index}`);
    const ownerKeys = names.map((name) => `axom-journal-feedback-draft:${userIdFromName(name)}`);
    const original = JSON.stringify({ ...JSON.parse(oldDraft), liked: "R32 original saved feedback is unchanged." });
    useStore.getState().updateProfile({ name: names[0] });
    localStorage.setItem(ownerKeys[0], original);
    const initialVisit = render(<JournalPage />);
    initialVisit.unmount();

    try {
      // Only the first display name has feedback. Intermediate aliases must
      // remain traversable without exhausting the reader's small retry limit.
      for (const name of names.slice(1)) useStore.getState().updateProfile({ name });
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect(screen.queryByRole("button", { name: "Retry reading saved feedback" })).toBeNull();
      expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
      fireEvent.click(screen.getByText("Other saved feedback copies (1)"));
      fireEvent.click(screen.getByRole("button", { name: "Open copy 1" }));
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
        .toBe("R32 original saved feedback is unchanged.");
      expect(localStorage.getItem(ownerKeys[0])).toBe(original);
    } finally {
      // Clean up only synthetic test keys, never real learner data.
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key && ownerKeys.some((owner) => key === owner || key.startsWith(`${owner}:`)))
          localStorage.removeItem(key);
      }
    }
  });

  it("does not exhaust historical recovery slots on name-only edits without saved feedback", () => {
    clearFixtureCopies();
    const names = Array.from({ length: 21 }, (_, index) => `Journal R31 Empty Profile ${index}`);
    const ownerKeys = names.map((name) => `axom-journal-feedback-draft:${userIdFromName(name)}`);
    useStore.getState().updateProfile({ name: names[0] });
    // Install the same name-change observer a real Journal visit installs.
    const visit = render(<JournalPage />);
    visit.unmount();

    try {
      for (const name of names.slice(1)) useStore.getState().updateProfile({ name });
      const aliases = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
        .filter((item) => item?.includes(":name-alias:v1:")
          && ownerKeys.some((owner) => item.startsWith(`${owner}:name-alias:v1:`)));
      expect(aliases).toEqual([]);
      render(<JournalPage />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
      expect(screen.queryByRole("button", { name: "Retry reading saved feedback" })).toBeNull();
      expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).readOnly).toBe(false);
    } finally {
      // Synthetic fixture cleanup, never a user/workspace data operation.
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const item = localStorage.key(index);
        if (item && ownerKeys.some((owner) => item === owner || item.startsWith(`${owner}:`)))
          localStorage.removeItem(item);
      }
    }
  });

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
    // Do not let the default legacy fixture appear as an unrelated older name.
    clearFixtureCopies();
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
    // The observer is installed when the Journal route has opened once.
    const firstVisit = render(<JournalPage hasAccountWorkspaceReceipt={() => true} />);
    firstVisit.unmount();
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


  it("restores an older saved draft after a rename during a temporary storage read outage and explicit retry", () => {
    clearFixtureCopies();
    const before = "Journal R27 Saved Before Outage";
    const after = "Journal R27 Renamed During Outage";
    useStore.getState().updateProfile({ name: before });
    const priorKey = `axom-journal-feedback-draft:${userIdFromName(before)}`;
    const nextKey = `axom-journal-feedback-draft:${userIdFromName(after)}`;
    const savedRaw = JSON.stringify({ ...JSON.parse(oldDraft), liked: "Never overwrite this pre-rename feedback." });
    localStorage.setItem(priorKey, savedRaw);
    const first = render(<JournalPage />);
    first.unmount();

    const originalGet = Storage.prototype.getItem;
    const denied = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, storageKey: string) {
      if (this === window.localStorage && storageKey.startsWith(nextKey))
        throw new Error("Transient browser storage read outage during rename");
      return originalGet.call(this, storageKey);
    });
    useStore.getState().updateProfile({ name: after });
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect(screen.getByRole("button", { name: "Retry reading saved feedback" })).toBeTruthy();
    expect(originalGet.call(localStorage, priorKey)).toBe(savedRaw);
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .some((item) => item?.startsWith(`${nextKey}:name-alias:v1:`))).toBe(false);

    denied.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
    fireEvent.click(screen.getByText("Other saved feedback copies (1)"));
    fireEvent.click(screen.getByRole("button", { name: "Open copy 1" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Never overwrite this pre-rename feedback.");
    expect(originalGet.call(localStorage, priorKey)).toBe(savedRaw);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const item = localStorage.key(index);
      if (item?.startsWith(priorKey) || item?.startsWith(nextKey)) localStorage.removeItem(item);
    }
  });

  it("recovers a pending historical link after a second rename succeeds during a partial storage outage", () => {
    clearFixtureCopies();
    const originalName = "Journal R27 Two Step Original";
    const middleName = "Journal R27 Two Step Middle";
    const finalName = "Journal R27 Two Step Final";
    useStore.getState().updateProfile({ name: originalName });
    const originalKey = `axom-journal-feedback-draft:${userIdFromName(originalName)}`;
    const middleKey = `axom-journal-feedback-draft:${userIdFromName(middleName)}`;
    const finalKey = `axom-journal-feedback-draft:${userIdFromName(finalName)}`;
    const savedRaw = JSON.stringify({ ...JSON.parse(oldDraft), liked: "Keep the unchanged first-name draft." });
    localStorage.setItem(originalKey, savedRaw);
    const first = render(<JournalPage />);
    first.unmount();

    const originalGet = Storage.prototype.getItem;
    const denied = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, storageKey: string) {
      // The first rename cannot write its link. The second rename can write
      // its own link, but the earlier link is still unreadable during handoff.
      if (this === window.localStorage && storageKey.startsWith(middleKey))
        throw new Error("First historical-name link still unavailable");
      return originalGet.call(this, storageKey);
    });
    useStore.getState().updateProfile({ name: middleName });
    useStore.getState().updateProfile({ name: finalName });
    const finalAliases = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((item): item is string => Boolean(item?.startsWith(`${finalKey}:name-alias:v1:`)));
    expect(finalAliases).toHaveLength(1);
    expect(originalGet.call(localStorage, originalKey)).toBe(savedRaw);

    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    // A still-blocked intermediate pointer must keep the final destination
    // in an explicit retry state, not silently hide the earlier saved copy.
    expect(screen.getByRole("button", { name: "Retry reading saved feedback" })).toBeTruthy();
    denied.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
    fireEvent.click(screen.getByText("Other saved feedback copies (1)"));
    fireEvent.click(screen.getByRole("button", { name: "Open copy 1" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Keep the unchanged first-name draft.");
    expect(originalGet.call(localStorage, originalKey)).toBe(savedRaw);
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .some((item) => item?.startsWith(`${middleKey}:name-alias:v1:`))).toBe(true);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const item = localStorage.key(index);
      if (item?.startsWith(originalKey) || item?.startsWith(middleKey) || item?.startsWith(finalKey))
        localStorage.removeItem(item);
    }
  });

  it("retains the latest rename retry until an older blocked alias is recovered", () => {
    clearFixtureCopies();
    const firstName = "Journal R28 Earlier Feedback";
    const middleName = "Journal R28 Intermediate Feedback";
    const lastName = "Journal R28 Current Feedback";
    useStore.getState().updateProfile({ name: firstName });
    const firstKey = `axom-journal-feedback-draft:${userIdFromName(firstName)}`;
    const middleKey = `axom-journal-feedback-draft:${userIdFromName(middleName)}`;
    const lastKey = `axom-journal-feedback-draft:${userIdFromName(lastName)}`;
    const saved = JSON.stringify({ ...JSON.parse(oldDraft), liked: "Unchanged R28 historical draft." });
    localStorage.setItem(firstKey, saved);
    const before = render(<JournalPage />);
    before.unmount();

    const originalGet = Storage.prototype.getItem;
    const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, item: string) {
      if (this === window.localStorage && item.startsWith(middleKey))
        throw new Error("Intermediate rename link is still blocked");
      return originalGet.call(this, item);
    });
    useStore.getState().updateProfile({ name: middleName });
    useStore.getState().updateProfile({ name: lastName });
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));

    // Retry first succeeds for C→B, but B→A is still inaccessible.
    fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    expect(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .some((item) => item?.startsWith(`${middleKey}:name-alias:v1:`))).toBe(false);
    expect(screen.getByRole("button", { name: "Retry reading saved feedback" })).toBeTruthy();

    // A second explicit retry from C must continue the whole chain.
    blocked.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
    fireEvent.click(screen.getByText("Other saved feedback copies (1)"));
    fireEvent.click(screen.getByRole("button", { name: "Open copy 1" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Unchanged R28 historical draft.");
    expect(originalGet.call(localStorage, firstKey)).toBe(saved);
    expect(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .some((item) => item?.startsWith(`${middleKey}:name-alias:v1:`))).toBe(true);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const item = localStorage.key(index);
      if (item?.startsWith(firstKey) || item?.startsWith(middleKey) || item?.startsWith(lastKey))
        localStorage.removeItem(item);
    }
  });

  it("never exposes account A's pending rename link to account B during recovery", async () => {
    clearFixtureCopies();
    const before = "Journal R27 Account A Before";
    const after = "Journal R27 Account A After";
    const accountA = { id: "journal-r27-account-a", email: "a@example.test", displayName: "A", emailConfirmed: true };
    const accountB = { ...accountA, id: "journal-r27-account-b", email: "b@example.test" };
    useAccount.setState({ user: accountA, phase: "signed-in", link: "linked" });
    useStore.getState().updateProfile({ name: before });
    const priorKey = `axom-journal-feedback-draft:${userIdFromName(before)}:account:${accountA.id}`;
    const nextAKey = `axom-journal-feedback-draft:${userIdFromName(after)}:account:${accountA.id}`;
    const nextBKey = `axom-journal-feedback-draft:${userIdFromName(after)}:account:${accountB.id}`;
    const savedRaw = JSON.stringify({ ...JSON.parse(oldDraft), liked: "Only A may recover this." });
    localStorage.setItem(priorKey, savedRaw);
    const first = render(<JournalPage hasAccountWorkspaceReceipt={() => true} />);
    first.unmount();

    const originalGet = Storage.prototype.getItem;
    const denied = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, storageKey: string) {
      if (this === window.localStorage && storageKey.startsWith(nextAKey))
        throw new Error("Account A read blocked during rename");
      return originalGet.call(this, storageKey);
    });
    useStore.getState().updateProfile({ name: after });
    denied.mockRestore();
    render(<JournalPage hasAccountWorkspaceReceipt={() => true} />);
    await act(async () => { useAccount.setState({ user: accountB }); });
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText(/Other saved feedback copies/)).toBeNull();
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .some((item) => item?.startsWith(`${nextBKey}:name-alias:v1:`))).toBe(false);

    await act(async () => { useAccount.setState({ user: accountA }); });
    fireEvent.click(screen.getByRole("button", { name: "Retry reading saved feedback" }));
    expect(screen.getByText("Other saved feedback copies (1)")).toBeTruthy();
    fireEvent.click(screen.getByText("Other saved feedback copies (1)"));
    fireEvent.click(screen.getByRole("button", { name: "Open copy 1" }));
    expect((screen.getByLabelText("What do you like?") as HTMLTextAreaElement).value)
      .toBe("Only A may recover this.");
    expect(originalGet.call(localStorage, priorKey)).toBe(savedRaw);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const item = localStorage.key(index);
      if (item?.startsWith(priorKey) || item?.startsWith(nextAKey) || item?.startsWith(nextBKey))
        localStorage.removeItem(item);
    }
  });

});
