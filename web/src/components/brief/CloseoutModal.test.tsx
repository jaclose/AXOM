// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { STORAGE_KEYS } from "../../lib/brand";
import { makeDailyRequirement } from "../../lib/dailySuccess";
import type { QuestionRecord } from "../../lib/questions";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import type { JournalEntry } from "../../lib/types";
import { useUi } from "../../lib/uiStore";
import * as localVault from "../../lib/localVault";
import { CloseoutModal } from "./CloseoutModal";

const DAY = "2035-04-13";

const storageValues = new Map<string, string>();
const storage = {
  get length() { return storageValues.size; },
  clear: () => storageValues.clear(),
  getItem: (key: string) => storageValues.get(key) ?? null,
  key: (index: number) => [...storageValues.keys()][index] ?? null,
  removeItem: (key: string) => { storageValues.delete(key); },
  setItem: (key: string, value: string) => { storageValues.set(key, String(value)); },
};

const fakeIndexedDb = new IDBFactory();

function deleteTestDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDb.deleteDatabase(localVault.DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Closeout test database deletion failed"));
    request.onblocked = () => reject(new Error("Closeout test database deletion blocked"));
  });
}

async function readPrimary(): Promise<string> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = fakeIndexedDb.open(localVault.DB_NAME);
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Closeout test database open failed"));
    request.onblocked = () => reject(new Error("Closeout test database open blocked"));
  });
  try {
    return await new Promise<string>((resolve, reject) => {
      const tx = db.transaction(localVault.STORE_NAME, "readonly");
      const request = tx.objectStore(localVault.STORE_NAME).get(STORAGE_KEYS.persistedState);
      tx.oncomplete = () => {
        if (typeof request.result === "string") resolve(request.result);
        else reject(new Error("Closeout test primary workspace missing"));
      };
      tx.onerror = () => reject(tx.error ?? new Error("Closeout test primary read failed"));
      tx.onabort = tx.onerror;
    });
  } finally {
    db.close();
  }
}

async function checkedSeed(write: () => unknown): Promise<void> {
  const checkpoint = localVault.getVaultWriteCheckpoint();
  await write();
  await localVault.flushLocalVaultWrites();
  expect(localVault.getVaultWriteCheckpoint()).toBeGreaterThan(checkpoint);
  localVault.assertVaultWritesSince(checkpoint);
  await expectPersistedCloseout();
}

async function expectPersistedCloseout(): Promise<void> {
  const raw = await readPrimary();
  const persisted = JSON.parse(raw).state;
  const { closeouts, journal, tasks, questions, logs, activeDayKey } = useStore.getState();
  // JSON round-trip strips optional undefined fields exactly as the storage adapter does.
  expect(persisted).toMatchObject(JSON.parse(JSON.stringify({ closeouts, journal, tasks, questions, logs, activeDayKey })));
  expect(persisted.closeouts).toEqual(JSON.parse(JSON.stringify(closeouts)));
  expect(persisted.journal).toEqual(JSON.parse(JSON.stringify(journal)));
  expect(await localVault.localVaultStorage.getItem(STORAGE_KEYS.persistedState)).toBe(raw);
}

beforeEach(async () => {
  await localVault.flushLocalVaultWrites();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", storage);
  await deleteTestDatabase();
  localVault.resetLocalVaultRuntimeForTests();
  localStorage.clear();
  await useStore.persist.rehydrate();
  await checkedSeed(setCloseoutState);
  useUi.setState({ journalDay: null });
  window.location.hash = "#dashboard";
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  try {
    await localVault.flushLocalVaultWrites();
    await deleteTestDatabase();
    localVault.resetLocalVaultRuntimeForTests();
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("CloseoutModal daily loop", () => {
  it("saves the closeout without creating a journal entry when opt-in stays unchecked", async () => {
    const onClose = vi.fn();
    render(<CloseoutModal onClose={onClose} />);

    const glance = screen.getByRole("region", { name: "Day at a glance" });
    expect(within(glance).getByText("Day at a Glance")).toBeTruthy();
    expect(within(glance).getByText("Intention: Finish the renal review")).toBeTruthy();
    expect(within(glance).getByText("Targets: 1/1 met")).toBeTruthy();
    expect(within(glance).getByText("25 focused min · 1 questions · 12 cards")).toBeTruthy();
    expect(within(glance).getByText(/1 tasks completed · 1 open loop/)).toBeTruthy();

    const prompts = [
      "What went well?",
      "One win",
      "What got in the way?",
      "One unfinished loop",
      "What matters tomorrow?",
      "Energy now (0–100)",
    ];
    for (const prompt of prompts) expect(screen.getByLabelText(prompt)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "Finished the question block" } });
    fireEvent.change(screen.getByLabelText("One win"), { target: { value: "Stayed focused" } });
    fireEvent.change(screen.getByLabelText("What got in the way?"), { target: { value: "A late meeting" } });
    fireEvent.change(screen.getByLabelText("One unfinished loop"), { target: { value: "Finish the summary" } });
    fireEvent.change(screen.getByLabelText("What matters tomorrow?"), { target: { value: "Start cardiology" } });
    const energyInput = screen.getByLabelText("Energy now (0–100)") as HTMLInputElement;
    expect(energyInput.min).toBe("0");
    expect(energyInput.max).toBe("100");
    fireEvent.change(energyInput, { target: { value: "73" } });
    fireEvent.click(screen.getByText("Planning details"));
    fireEvent.click(screen.getByRole("button", { name: "Higher" }));

    const journalOption = screen.getByRole("checkbox", { name: /Create today’s journal page from this closeout/i }) as HTMLInputElement;
    expect(journalOption.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close the day" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    await expectPersistedCloseout();
    expect(useStore.getState().closeouts).toHaveLength(1);
    expect(useStore.getState().closeouts[0]).toMatchObject({
      dayKey: DAY,
      completedSummary: "Finished the question block",
      oneWin: "Stayed focused",
      blocker: "A late meeting",
      remainingSummary: "Finish the summary",
      tomorrowFirstTask: "Start cardiology",
      energyNow: 73,
      energyVsMorning: "higher",
      tomorrowMode: "auto",
    });
    expect(useStore.getState().journal).toHaveLength(0);
  });

  it("leaves an existing journal entry unchanged when opt-in stays unchecked", async () => {
    const existing: JournalEntry = {
      id: "existing-journal",
      date: `${DAY}T09:00:00`,
      today: "Existing reflection",
      tomorrow: "Existing plan",
      blockers: "Existing obstacle",
      energy: "Medium",
      rating: "Useful",
    };
    await checkedSeed(() => useStore.setState({ journal: [existing] }));
    const onClose = vi.fn();
    render(<CloseoutModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "New closeout reflection" } });
    fireEvent.change(screen.getByLabelText("One win"), { target: { value: "Kept going" } });
    fireEvent.click(screen.getByRole("button", { name: "Close the day" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    await expectPersistedCloseout();
    expect(useStore.getState().journal).toEqual([existing]);
    expect(useStore.getState().closeouts[0].completedSummary).toBe("New closeout reflection");
  });

  it("merges an opted-in closeout into an existing entry without overwriting its prose", async () => {
    const existing: JournalEntry = {
      id: "existing-journal",
      date: `${DAY}T09:00:00`,
      today: "Existing reflection",
      tomorrow: "Existing plan",
      blockers: "",
      energy: "Medium",
      rating: "Useful",
    };
    await checkedSeed(() => useStore.setState({ journal: [existing] }));
    const onClose = vi.fn();
    render(<CloseoutModal onClose={onClose} />);

    const journalOption = screen.getByRole("checkbox", { name: /Add this closeout to today’s journal/i });
    expect(journalOption).toHaveProperty("checked", false);
    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "New closeout reflection" } });
    fireEvent.change(screen.getByLabelText("One win"), { target: { value: "Kept going" } });
    fireEvent.change(screen.getByLabelText("What got in the way?"), { target: { value: "Fatigue" } });
    fireEvent.click(journalOption);
    fireEvent.click(screen.getByRole("button", { name: "Close the day" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    await expectPersistedCloseout();
    const [page] = useStore.getState().journal;
    expect(useStore.getState().journal).toHaveLength(1);
    expect(page).toMatchObject({
      id: "existing-journal",
      today: "Existing reflection",
      tomorrow: "Existing plan",
      blockers: "Fatigue",
      energy: "Medium",
      wins: ["Kept going"],
    });
    expect(useStore.getState().closeouts[0].completedSummary).toBe("New closeout reflection");
  });

  it("creates a journal entry from the closeout only after explicit opt-in", async () => {
    const onClose = vi.fn();
    render(<CloseoutModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "Completed the core review" } });
    fireEvent.change(screen.getByLabelText("One win"), { target: { value: "Asked for help early" } });
    fireEvent.change(screen.getByLabelText("What got in the way?"), { target: { value: "Noisy room" } });
    fireEvent.change(screen.getByLabelText("What matters tomorrow?"), { target: { value: "Review weak questions" } });
    fireEvent.change(screen.getByLabelText("Energy now (0–100)"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Create today’s journal page from this closeout/i }));
    let stateChanges = 0;
    const unsubscribe = useStore.subscribe(() => { stateChanges += 1; });
    fireEvent.click(screen.getByRole("button", { name: "Close the day" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    await expectPersistedCloseout();
    unsubscribe();
    expect(stateChanges).toBe(1);
    expect(useStore.getState().journal).toHaveLength(1);
    expect(useStore.getState().journal[0]).toMatchObject({
      date: `${DAY}T20:30:00`,
      today: "Completed the core review",
      wins: ["Asked for help early"],
      tomorrow: "Review weak questions",
      blockers: "Noisy room",
      energy: "Low",
      rating: "Daily closeout",
    });
  });

  it("saves before expanding into the full notebook and routes to the same day", async () => {
    const onClose = vi.fn();
    render(<CloseoutModal onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("What matters tomorrow?"), { target: { value: "Start cardiology" } });

    fireEvent.click(screen.getByRole("button", { name: "Expand into full notebook" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    await expectPersistedCloseout();
    expect(useStore.getState().closeouts).toHaveLength(1);
    expect(useStore.getState().closeouts[0].tomorrowFirstTask).toBe("Start cardiology");
    expect(useStore.getState().journal).toHaveLength(0);
    expect(useUi.getState().journalDay).toBe(DAY);
    expect(window.location.hash).toBe("#journal");
  });

  it("keeps the combined closeout and journal unsaved when both physical stores reject the write", async () => {
    const before = await readPrimary();
    const checkpoint = localVault.getVaultWriteCheckpoint();
    const onClose = vi.fn();
    render(<CloseoutModal onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("One win"), { target: { value: "Keep this unsaved win" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Create today’s journal page from this closeout/i }));
    const denyIdb = vi.spyOn(fakeIndexedDb, "open").mockImplementation(() => { throw new DOMException("Unavailable", "SecurityError"); });
    const denyFallback = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Expand into full notebook" }));
      expect((await screen.findByRole("alert")).textContent).toMatch(/Not saved on this device.*still open/i);
      expect(localVault.getVaultWriteCheckpoint()).toBeGreaterThan(checkpoint);
      expect(() => localVault.assertVaultWritesSince(checkpoint)).toThrow();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByDisplayValue("Keep this unsaved win")).toBeTruthy();
      expect(window.location.hash).toBe("#dashboard");
      expect(useUi.getState().journalDay).toBeNull();
    } finally {
      denyIdb.mockRestore();
      denyFallback.mockRestore();
    }
    expect(await readPrimary()).toBe(before);
  });

  it.each([
    { label: "revoked consent, new page", existing: false, retryOptIn: false },
    { label: "edited consent, new page", existing: false, retryOptIn: true },
    { label: "revoked consent, existing page", existing: true, retryOptIn: false },
    { label: "edited consent, existing page", existing: true, retryOptIn: true },
  ])("persists only the latest journal consent after a real storage refusal: $label", async ({ existing, retryOptIn }) => {
    const authored: JournalEntry = {
      id: "authored-before-closeout",
      date: `${DAY}T09:00:00`,
      today: "Authored reflection",
      tomorrow: "Authored plan",
      blockers: "",
      energy: "Medium",
      rating: "Useful",
    };
    if (existing) await checkedSeed(() => useStore.setState({ journal: [authored] }));
    const before = await readPrimary();
    const initial = JSON.parse(before).state;
    const onClose = vi.fn();
    render(<CloseoutModal onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "Rejected draft reflection" } });
    fireEvent.change(screen.getByLabelText("One win"), { target: { value: "Rejected draft win" } });
    fireEvent.change(screen.getByLabelText("What got in the way?"), { target: { value: "Rejected draft obstacle" } });
    fireEvent.click(screen.getByRole("checkbox"));
    const checkpoint = localVault.getVaultWriteCheckpoint();
    const denyIdb = vi.spyOn(fakeIndexedDb, "open").mockImplementation(() => { throw new DOMException("Unavailable", "SecurityError"); });
    const denyFallback = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Expand into full notebook" }));
      expect((await screen.findByRole("alert")).textContent).toMatch(/Not saved on this device.*still open/i);
      expect(localVault.getVaultWriteCheckpoint()).toBeGreaterThan(checkpoint);
      expect(() => localVault.assertVaultWritesSince(checkpoint)).toThrow();
      expect(onClose).not.toHaveBeenCalled();
      expect(window.location.hash).toBe("#dashboard");
      expect(useUi.getState().journalDay).toBeNull();
    } finally {
      denyIdb.mockRestore();
      denyFallback.mockRestore();
    }
    expect(await readPrimary()).toBe(before);

    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "Final reflection" } });
    fireEvent.change(screen.getByLabelText("One win"), { target: { value: "Final win" } });
    fireEvent.change(screen.getByLabelText("What got in the way?"), { target: { value: "Final obstacle" } });
    if (!retryOptIn) fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toHaveProperty("checked", retryOptIn);
    const retryCheckpoint = localVault.getVaultWriteCheckpoint();
    fireEvent.click(screen.getByRole("button", { name: "Close the day" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(localVault.getVaultWriteCheckpoint()).toBeGreaterThan(retryCheckpoint);
    localVault.assertVaultWritesSince(retryCheckpoint);
    const persisted = JSON.parse(await readPrimary()).state;
    expect(persisted.closeouts).toHaveLength(1);
    expect(persisted.closeouts[0]).toMatchObject({ dayKey: DAY, completedSummary: "Final reflection", oneWin: "Final win", blocker: "Final obstacle" });
    expect(persisted.tasks).toEqual(initial.tasks);
    expect(persisted.questions).toEqual(initial.questions);
    expect(persisted.logs).toEqual(initial.logs);
    if (!retryOptIn) {
      expect(persisted.journal).toEqual(initial.journal);
    } else {
      expect(persisted.journal).toHaveLength(1);
      expect(persisted.journal[0]).toMatchObject({
        today: existing ? authored.today : "Final reflection",
        blockers: "Final obstacle",
        wins: ["Final win"],
        ...(existing ? { id: authored.id, tomorrow: authored.tomorrow } : {}),
      });
      expect(JSON.stringify(persisted.journal)).not.toContain("Rejected draft");
    }
    await expectPersistedCloseout();
  });

  it("keeps an opt-out closeout open with its form data when durability cannot be confirmed", async () => {
    vi.spyOn(localVault, "flushLocalVaultWrites").mockRejectedValueOnce(new Error("Synthetic closeout vault refusal"));
    const onClose = vi.fn();
    render(<CloseoutModal onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("What went well?"), { target: { value: "Keep this reflection visible" } });

    fireEvent.click(screen.getByRole("button", { name: "Close the day" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Not saved on this device.*still open.*Synthetic closeout vault refusal/i);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Keep this reflection visible")).toBeTruthy();
    expect(useStore.getState().journal).toHaveLength(0);
    expect(window.location.hash).toBe("#dashboard");
  });

  it("keeps an opted-in closeout and journal form open when their atomic snapshot is not durable", async () => {
    vi.spyOn(localVault, "flushLocalVaultWrites").mockRejectedValueOnce(new Error("Synthetic combined vault refusal"));
    const onClose = vi.fn();
    render(<CloseoutModal onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("One win"), { target: { value: "Retain this win for retry" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Create today’s journal page from this closeout/i }));
    let stateChanges = 0;
    const unsubscribe = useStore.subscribe(() => { stateChanges += 1; });

    fireEvent.click(screen.getByRole("button", { name: "Close the day" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Not saved on this device.*still open.*Synthetic combined vault refusal/i);
    unsubscribe();
    expect(stateChanges).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Retain this win for retry")).toBeTruthy();
    expect(useStore.getState().closeouts).toHaveLength(1);
    expect(useStore.getState().journal).toHaveLength(1);
    expect(useStore.getState().journal[0]).toMatchObject({ wins: ["Retain this win for retry"] });
    expect(window.location.hash).toBe("#dashboard");
  });
});

function setCloseoutState() {
  const seed = makeSeed();
  const target = makeDailyRequirement({
    id: "focus-target",
    label: "Focused study",
    source: { kind: "study-minutes" },
    target: 25,
    unit: "minutes",
    trackingStartsAt: DAY,
  }, DAY);
  return useStore.setState({
    ...seed,
    activeDayKey: DAY,
    profile: {
      ...seed.profile,
      dailySuccess: { version: 1, configuredAt: DAY, requirements: [target] },
    },
    dayPlans: [{
      dayKey: DAY,
      intention: "Finish the renal review",
      wins: ["Complete the question block"],
      createdAt: `${DAY}T07:00:00.000Z`,
    }],
    logs: [{
      id: "study-log",
      dayKey: DAY,
      ts: `${DAY}T10:00:00.000Z`,
      type: "Focused study",
      minutes: 25,
      cards: 12,
      academic: true,
      productive: true,
    }],
    tasks: [
      {
        id: "completed-task",
        title: "Complete the question block",
        done: true,
        archived: false,
        created: `${DAY}T07:00:00.000Z`,
        completedAt: `${DAY}T12:00:00.000Z`,
      },
      {
        id: "open-task",
        title: "Write the summary",
        done: false,
        archived: false,
        created: `${DAY}T07:00:00.000Z`,
        due: DAY,
      },
    ],
    questions: [questionWithAttempt()],
    sessions: [],
    closeouts: [],
    recoveryPlans: [],
    habits: [],
    habitEntries: [],
    journal: [],
    energyFactors: [],
  });
}

function questionWithAttempt(): QuestionRecord {
  return {
    id: "question-1",
    source: "manual",
    stem: "Which answer is supported?",
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    correctKey: "B",
    status: "correct",
    tags: [],
    attempts: [{ at: `${DAY}T11:00:00.000Z`, answerKey: "B", status: "correct" }],
    createdAt: `${DAY}T08:00:00.000Z`,
    updatedAt: `${DAY}T11:00:00.000Z`,
  };
}
