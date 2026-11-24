// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { STORAGE_KEYS } from "../lib/brand";
import * as localVault from "../lib/localVault";
import { readVaultWriteFailure } from "../lib/vaultActivity";
import { makeSeed } from "../lib/seed";
import { makeDailyRequirement } from "../lib/dailySuccess";
import { useStore } from "../lib/store";
import { ProductivityPage } from "./ProductivityPage";
import { getQuestionAttachmentScope, setQuestionAttachmentAccount } from "../lib/questionAttachmentScope";

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
    request.onerror = () => reject(request.error ?? new Error("Productivity test database deletion failed"));
    request.onblocked = () => reject(new Error("Productivity test database deletion blocked"));
  });
}

async function readPrimary(): Promise<string> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = fakeIndexedDb.open(localVault.DB_NAME);
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Productivity test database open failed"));
    request.onblocked = () => reject(new Error("Productivity test database open blocked"));
  });
  try {
    return await new Promise<string>((resolve, reject) => {
      const tx = db.transaction(localVault.STORE_NAME, "readonly");
      const request = tx.objectStore(localVault.STORE_NAME).get(STORAGE_KEYS.persistedState);
      tx.oncomplete = () => {
        if (typeof request.result === "string") resolve(request.result);
        else reject(new Error("Productivity test primary workspace missing"));
      };
      tx.onerror = () => reject(tx.error ?? new Error("Productivity test primary read failed"));
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
  expect(readVaultWriteFailure()).toBeNull();
  const raw = await readPrimary();
  expect(JSON.parse(raw).state.logs).toEqual(JSON.parse(JSON.stringify(useStore.getState().logs)));
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
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  await checkedSeed(() => useStore.setState(makeSeed()));
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

describe("ProductivityPage daily console", () => {
  it("starts neutral and logs a practice-question quantity through the fast path", () => {
    render(<ProductivityPage />);
    expect(screen.getByText("No targets selected")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Log an activity" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What did you do?"), { target: { value: "Practice questions" } });
    fireEvent.change(screen.getByLabelText("How long in minutes?"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Quantity type"), { target: { value: "questions" } });
    fireEvent.change(screen.getByLabelText("Questions"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));

    expect(useStore.getState().logs[0]).toMatchObject({
      type: "Practice questions",
      minutes: 25,
      cards: 0,
      quantity: 30,
      quantityKind: "questions",
    });
  });

  it("accepts a named completion without inventing minutes or cards", () => {
    render(<ProductivityPage />);
    fireEvent.change(screen.getByLabelText("What did you do?"), { target: { value: "Prayer" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(useStore.getState().logs[0]).toMatchObject({
      type: "Prayer",
      minutes: 0,
      cards: 0,
      unitType: "yesno",
      quantity: 1,
    });
  });

  it("keeps historical views read-only", () => {
    render(<ProductivityPage />);
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(screen.queryByLabelText("What did you do?")).toBeNull();
    expect(screen.getByText("History is read-only.")).toBeTruthy();
    expect(useStore.getState().logs).toHaveLength(0);
  });

  it("stores pages and repetitions as labeled general quantities", () => {
    render(<ProductivityPage />);
    fireEvent.change(screen.getByLabelText("What did you do?"), { target: { value: "Read a chapter" } });
    fireEvent.change(screen.getByLabelText("Quantity type"), { target: { value: "pages" } });
    const pages = screen.getByLabelText("Pages") as HTMLInputElement;
    expect(pages.placeholder).toBe("12 pages");
    fireEvent.change(pages, { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(useStore.getState().logs[0]).toMatchObject({ quantity: 18, quantityKind: "count", quantityLabel: "pages" });
    expect(screen.getByText("What makes today successful")).toBeTruthy();
    expect(screen.getByText("Choose targets")).toBeTruthy();
  });

  it("shows the saved page label instead of the internal count kind in shortcuts", () => {
    const state = makeSeed();
    state.logs = [{
      id: "pages-log",
      dayKey: state.activeDayKey,
      ts: "2026-07-12T12:00:00.000Z",
      type: "Read a chapter",
      minutes: 0,
      cards: 0,
      quantity: 18,
      quantityKind: "count",
      quantityLabel: "pages",
    }];
    useStore.setState(state);
    render(<ProductivityPage />);
    expect(screen.getByText("18 pages")).toBeTruthy();
    expect(screen.queryByText("18 count")).toBeNull();
  });

  it("opens a same-route tour and keeps low-data trends missing-target safe", () => {
    render(<ProductivityPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open Productivity help tour" }));
    expect(screen.getByRole("dialog", { name: "Log activity" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Choose targets" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Use the focus timer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Read trends" }).classList.contains("centered")).toBe(true);
  });

  it("keeps future records out of elapsed monthly totals and disables their dates", () => {
    const state = makeSeed();
    state.activeDayKey = "2026-07-13";
    state.logs = ["2026-07-10", "2026-07-11", "2026-07-13", "2026-07-14"].map((dayKey, index) => ({ id: `day-${index}`, dayKey, ts: `${dayKey}T12:00:00`, type: "Study", minutes: index === 3 ? 999 : 10, cards: 0 }));
    useStore.setState(state);
    render(<ProductivityPage />);
    const month = screen.getByText("Monthly activity calendar").closest(".glass-card") as HTMLElement;
    expect(within(month).getByText("0h 30m")).toBeTruthy();
    expect(within(month).getByText("3/4 active")).toBeTruthy();
    const future = month.querySelector('button[title*="future date"]') as HTMLButtonElement;
    expect(future.disabled).toBe(true);
  });

  it("selects a recorded day when activity has no study minutes or cards", () => {
    const state = makeSeed();
    state.activeDayKey = "2026-07-13";
    state.logs = ["2026-07-10", "2026-07-11", "2026-07-12"].map((dayKey, index) => ({
      id: dayKey, dayKey, ts: `${dayKey}T12:00:00`, type: index ? "Prayer" : "Read a chapter",
      minutes: 0, cards: 0, quantity: index ? 1 : 18, quantityKind: "count" as const, quantityLabel: index ? "completions" : "pages",
    }));
    useStore.setState(state);
    render(<ProductivityPage />);

    const month = screen.getByText("Monthly activity calendar").closest(".glass-card") as HTMLElement;
    const bestDay = within(month).getByText("Best day").closest(".metric-tile") as HTMLElement;
    expect(within(month).getByText("3/4 active")).toBeTruthy();
    expect(within(bestDay).getByText("Jul 10, 2026")).toBeTruthy();
    expect(within(bestDay).getByText("0m · 0 cards")).toBeTruthy();
  });

  it("uses canonical activity for period boundaries and shortcuts without deleting duplicate records", async () => {
    const state = makeSeed();
    state.activeDayKey = "2026-07-13";
    const old = { id: "moved", dayKey: "2026-07-01", ts: "2026-07-13T11:00:00", type: "Obsolete study label", minutes: 999, cards: 0 };
    const latest = { ...old, dayKey: state.activeDayKey, ts: "2026-07-13T12:00:00", type: "Corrected study label", minutes: 10 };
    state.logs = [old, latest, ...["2026-07-11", "2026-07-12"].map((dayKey) => ({ id: dayKey, dayKey, ts: `${dayKey}T12:00:00`, type: `Study ${dayKey}`, minutes: 10, cards: 0 }))];
    const original = structuredClone(state.logs);
    await checkedSeed(() => useStore.setState(state));
    expect(JSON.parse(await readPrimary()).state.logs).toEqual(original);
    render(<ProductivityPage />);

    const month = screen.getByText("Monthly activity calendar").closest(".glass-card") as HTMLElement;
    const week = screen.getByText("Weekly activity").closest(".glass-card") as HTMLElement;
    expect(within(month).getByText("3/3 active")).toBeTruthy();
    expect(within(week).getByText("3/3 active")).toBeTruthy();
    expect(within(month).getByText("0h 30m")).toBeTruthy();
    expect(screen.queryByText("Obsolete study label")).toBeNull();
    expect(screen.getByRole("heading", { name: "Review activity records" })).toBeTruthy();
    expect(useStore.getState().logs).toEqual(original);
  });

  it("prioritizes a real failed save over duplicate review and restores review after an acknowledged retry", async () => {
    const state = makeSeed();
    state.activeDayKey = "2026-07-13";
    const old = { id: "moved", dayKey: "2026-07-01", ts: "2026-07-13T11:00:00", type: "Obsolete study label", minutes: 999, cards: 0 };
    const latest = { ...old, dayKey: state.activeDayKey, ts: "2026-07-13T12:00:00", type: "Corrected study label", minutes: 10 };
    state.logs = [old, latest, ...["2026-07-11", "2026-07-12"].map((dayKey) => ({ id: dayKey, dayKey, ts: `${dayKey}T12:00:00`, type: `Study ${dayKey}`, minutes: 10, cards: 0 }))];
    const original = structuredClone(state.logs);
    await checkedSeed(() => useStore.setState(state));
    const before = await readPrimary();
    render(<ProductivityPage />);
    expect(screen.getByRole("heading", { name: "Review activity records" })).toBeTruthy();

    const attempted = [...original, { id: "new-activity", dayKey: state.activeDayKey, ts: "2026-07-13T13:00:00", type: "New study", minutes: 5, cards: 0 }];
    const checkpoint = localVault.getVaultWriteCheckpoint();
    const denyIdb = vi.spyOn(fakeIndexedDb, "open").mockImplementation(() => { throw new DOMException("Unavailable", "SecurityError"); });
    const denyFallback = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    try {
      await act(async () => {
        await useStore.setState({ logs: attempted });
        await localVault.flushLocalVaultWrites();
      });
      expect(localVault.getVaultWriteCheckpoint()).toBeGreaterThan(checkpoint);
      expect(() => localVault.assertVaultWritesSince(checkpoint)).toThrow();
      expect(readVaultWriteFailure()).not.toBeNull();
      expect(screen.getByRole("heading", { name: "Check your save" })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "Review activity records" })).toBeNull();
      expect(useStore.getState().logs).toEqual(attempted);
    } finally {
      denyIdb.mockRestore();
      denyFallback.mockRestore();
    }
    expect(await readPrimary()).toBe(before);
    await act(async () => { await checkedSeed(() => useStore.setState({ logs: attempted })); });
    expect(screen.queryByRole("heading", { name: "Check your save" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Review activity records" })).toBeTruthy();
    expect(JSON.parse(await readPrimary()).state.logs).toEqual(attempted);
    expect(useStore.getState().logs).toEqual(attempted);
  });

  it("retries a refused manual activity through its real control without allocating another ID", async () => {
    const before = await readPrimary();
    render(<ProductivityPage />);
    const fill = () => {
      fireEvent.change(screen.getByLabelText("What did you do?"), { target: { value: "Practice questions" } });
      fireEvent.change(screen.getByLabelText("How long in minutes?"), { target: { value: "5" } });
    };
    const denyIdb = vi.spyOn(fakeIndexedDb, "open").mockImplementation(() => { throw new DOMException("Unavailable", "SecurityError"); });
    const denyFallback = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    let attempted: ReturnType<typeof useStore.getState>["logs"];
    try {
      fill();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Log" }));
        await localVault.flushLocalVaultWrites();
      });
      await screen.findByRole("button", { name: "Retry activity save" });
      attempted = structuredClone(useStore.getState().logs);
      expect(attempted).toHaveLength(1);
      expect(attempted[0]).toMatchObject({ type: "Practice questions", minutes: 5 });
      expect(readVaultWriteFailure()).not.toBeNull();
      fill();
      expect((screen.getByRole("button", { name: "Log" }) as HTMLButtonElement).disabled).toBe(true);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Retry activity save" }));
        await localVault.flushLocalVaultWrites();
      });
      await screen.findByRole("button", { name: "Retry activity save" });
      expect(useStore.getState().logs).toEqual(attempted);
    } finally {
      denyIdb.mockRestore();
      denyFallback.mockRestore();
    }
    expect(await readPrimary()).toBe(before);
    const checkpoint = localVault.getVaultWriteCheckpoint();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry activity save" }));
      await localVault.flushLocalVaultWrites();
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry activity save" })).toBeNull());
    expect(localVault.getVaultWriteCheckpoint()).toBeGreaterThan(checkpoint);
    localVault.assertVaultWritesSince(checkpoint);
    expect(JSON.parse(await readPrimary()).state.logs).toEqual(attempted);
    expect(useStore.getState().logs).toEqual(attempted);
    expect(readVaultWriteFailure()).toBeNull();
    expect((screen.getByRole("button", { name: "Log" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Log" }));
      await localVault.flushLocalVaultWrites();
    });
    const repeated = useStore.getState().logs;
    expect(repeated).toHaveLength(2);
    expect(repeated[0].id).not.toBe(attempted[0].id);
    expect(repeated[1]).toEqual(attempted[0]);
    expect(JSON.parse(await readPrimary()).state.logs).toEqual(JSON.parse(JSON.stringify(repeated)));
    await act(async () => { await useStore.persist.rehydrate(); });
    expect(useStore.getState().logs.map((log) => log.id)).toEqual(repeated.map((log) => log.id));
  });

  it.each(["cloned", "removed", "duplicate"] as const)("allows an explicit non-writing exit when a refused activity is %s", async (change) => {
    const initial = getQuestionAttachmentScope();
    const before = await readPrimary();
    render(<ProductivityPage />);
    const denyIdb = vi.spyOn(fakeIndexedDb, "open").mockImplementation(() => { throw new DOMException("Unavailable", "SecurityError"); });
    const denyFallback = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    try {
      fireEvent.change(screen.getByLabelText("What did you do?"), { target: { value: "Original activity" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Log" }));
        await localVault.flushLocalVaultWrites();
      });
      await screen.findByRole("button", { name: "Retry activity save" });
      const row = useStore.getState().logs[0];
      const changed = change === "removed" ? [] : change === "cloned" ? [{ ...row, academic: !row.academic }] : [row, { ...row }];
      await act(async () => {
        useStore.setState({ logs: changed });
        await localVault.flushLocalVaultWrites();
      });
      expect(screen.queryByRole("button", { name: "Retry activity save" })).toBeNull();
      fireEvent.change(screen.getByLabelText("What did you do?"), { target: { value: "Distinct later activity" } });
      expect((screen.getByRole("button", { name: "Log" }) as HTMLButtonElement).disabled).toBe(true);
      const checkpoint = localVault.getVaultWriteCheckpoint();
      const current = useStore.getState();
      fireEvent.click(screen.getByRole("button", { name: "Continue without confirming save" }));
      expect(localVault.getVaultWriteCheckpoint()).toBe(checkpoint);
      expect(useStore.getState()).toBe(current);
      expect(screen.getByText(/An earlier activity save is still unconfirmed/)).toBeTruthy();
      expect((screen.getByRole("button", { name: "Log" }) as HTMLButtonElement).disabled).toBe(false);
      denyIdb.mockRestore();
      denyFallback.mockRestore();
      expect(await readPrimary()).toBe(before);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Log" }));
        await localVault.flushLocalVaultWrites();
      });
      expect(localVault.getVaultWriteCheckpoint()).toBeGreaterThan(checkpoint);
      localVault.assertVaultWritesSince(checkpoint);
      expect(readVaultWriteFailure()).toBeNull();
      const after = useStore.getState().logs;
      expect(after[0]).toMatchObject({ type: "Distinct later activity" });
      expect(after[0].id).not.toBe(row.id);
      expect(after.slice(1)).toEqual(changed);
      expect(JSON.parse(await readPrimary()).state.logs).toEqual(JSON.parse(JSON.stringify(after)));
      expect(screen.getByText(/An earlier activity save is still unconfirmed/)).toBeTruthy();
      act(() => setQuestionAttachmentAccount(initial.accountId === "synthetic-other" ? "synthetic-different" : "synthetic-other"));
      expect(screen.queryByText(/An earlier activity save is still unconfirmed/)).toBeNull();
      act(() => setQuestionAttachmentAccount(initial.accountId));
      expect(screen.queryByText(/An earlier activity save is still unconfirmed/)).toBeNull();
    } finally {
      setQuestionAttachmentAccount(initial.accountId);
      denyIdb.mockRestore();
      denyFallback.mockRestore();
    }
  });

  it("never offers a refused activity retry to a different account generation", async () => {
    const initial = getQuestionAttachmentScope();
    const before = await readPrimary();
    const denyIdb = vi.spyOn(fakeIndexedDb, "open").mockImplementation(() => { throw new DOMException("Unavailable", "SecurityError"); });
    const denyFallback = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    try {
      render(<ProductivityPage />);
      fireEvent.change(screen.getByLabelText("What did you do?"), { target: { value: "Private activity" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Log" }));
        await localVault.flushLocalVaultWrites();
      });
      const retry = await screen.findByRole("button", { name: "Retry activity save" });
      const checkpoint = localVault.getVaultWriteCheckpoint();
      act(() => setQuestionAttachmentAccount(initial.accountId === "synthetic-other" ? "synthetic-different" : "synthetic-other"));
      expect(screen.queryByRole("button", { name: "Retry activity save" })).toBeNull();
      act(() => setQuestionAttachmentAccount(initial.accountId));
      expect(screen.queryByRole("button", { name: "Retry activity save" })).toBeNull();
      fireEvent.click(retry);
      expect(localVault.getVaultWriteCheckpoint()).toBe(checkpoint);
    } finally {
      setQuestionAttachmentAccount(initial.accountId);
      denyIdb.mockRestore();
      denyFallback.mockRestore();
    }
    expect(await readPrimary()).toBe(before);
  });

  it("keeps earlier activity visible after selecting a new target and shows only the picked day's history", () => {
    const state = makeSeed();
    state.activeDayKey = "2026-07-13";
    const requirement = makeDailyRequirement({ id: "new-target", label: "Study", source: { kind: "study-minutes" }, target: 60, unit: "minutes", trackingStartsAt: state.activeDayKey }, state.activeDayKey);
    state.profile.dailySuccess = { version: 1, configuredAt: state.activeDayKey, requirements: [requirement] };
    state.logs = ["2026-07-10", "2026-07-11", "2026-07-12"].map((dayKey) => ({ id: dayKey, dayKey, ts: `${dayKey}T12:00:00`, type: `Study ${dayKey}`, minutes: 10, cards: 0 }));
    const original = structuredClone(state.logs);
    useStore.setState(state);
    render(<ProductivityPage />);

    const month = screen.getByText("Monthly activity calendar").closest(".glass-card") as HTMLElement;
    expect(month.querySelectorAll("button.cal-day")).toHaveLength(31);
    expect(within(month).getByText("3/4 active")).toBeTruthy();
    const earlierDay = within(month).getByRole("button", { name: "10" });
    expect(earlierDay.title).toBe("Jul 10, 2026: 10m, 0 cards");
    fireEvent.click(earlierDay);

    const history = screen.getByRole("region", { name: "Activity Log" });
    expect(within(history).getByText(/Study 2026-07-10/)).toBeTruthy();
    expect(within(history).queryByText(/Study 2026-07-11/)).toBeNull();
    expect(screen.getByText("10 study minutes")).toBeTruthy();
    expect(screen.getByText("History is read-only.")).toBeTruthy();
    expect(useStore.getState().logs).toEqual(original);
  });

  it("places a five-entry Activity Log preview after the primary panels", () => {
    const state = makeSeed();
    state.logs = Array.from({ length: 8 }, (_, index) => ({
      id: `activity-${index}`, dayKey: state.activeDayKey, ts: `2026-10-20T12:0${7 - index}:00.000Z`,
      type: `Review block ${index + 1}`, minutes: 10, cards: 0,
    }));
    useStore.setState(state);
    const original = structuredClone(state.logs);
    const { container } = render(<ProductivityPage />);
    const log = screen.getByRole("region", { name: "Activity Log" });
    expect(container.querySelector('.productivity-primary-grid [data-module-tour="productivity-focus"]')).toBeTruthy();
    expect(container.querySelector('.productivity-primary-grid')!.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(log.querySelectorAll(".activity-row")).toHaveLength(5);
    expect(within(log).getByText("Showing 5 of 8 events.")).toBeTruthy();
    expect(within(log).queryByText(/Review block 6/)).toBeNull();
    const toggle = within(log).getByRole("button", { name: "Show all 8 events" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBe(log.querySelector(".activity-feed"));
    fireEvent.click(toggle);
    expect(log.querySelectorAll(".activity-row")).toHaveLength(8);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(log).getByRole("button", { name: "Show less" }));
    expect(log.querySelectorAll(".activity-row")).toHaveLength(5);
    expect(useStore.getState().logs).toEqual(original);
  });

  it("labels the 200-event expanded cap honestly and preserves all 343 entries", () => {
    const state = makeSeed();
    state.logs = Array.from({ length: 343 }, (_, index) => ({
      id: `long-history-${index}`, dayKey: state.activeDayKey, ts: "2026-10-20T12:00:00.000Z",
      type: `Recorded activity ${index + 1}`, minutes: 1, cards: 0,
    }));
    useStore.setState(state);
    const original = structuredClone(state.logs);
    render(<ProductivityPage />);
    const log = screen.getByRole("region", { name: "Activity Log" });
    expect(within(log).queryByRole("button", { name: "Show all 343 events" })).toBeNull();
    fireEvent.click(within(log).getByRole("button", { name: "Show latest 200 events" }));
    expect(log.querySelectorAll(".activity-row")).toHaveLength(200);
    expect(within(log).getByText("Showing 200 of 343 events. Open full activity for older entries.")).toBeTruthy();
    expect(within(log).getByRole("link", { name: "View full activity" }).getAttribute("href")).toBe("#activity");
    expect(useStore.getState().logs).toEqual(original);
  });

  it("allows notes to expand even when the history fits in the five-entry preview", () => {
    const state = makeSeed();
    state.logs = [{
      id: "note-log", dayKey: state.activeDayKey, ts: "2026-10-20T12:00:00.000Z", type: "Lecture review",
      minutes: 20, cards: 0, note: "First line of a detailed note.\nA second line that must remain available.",
    }];
    useStore.setState(state);
    render(<ProductivityPage />);
    const log = screen.getByRole("region", { name: "Activity Log" });
    expect(log.classList.contains("is-preview")).toBe(true);
    fireEvent.click(within(log).getByRole("button", { name: "Expand notes" }));
    expect(log.classList.contains("is-expanded")).toBe(true);
    expect(log.querySelector(".activity-note")?.textContent).toBe(state.logs[0].note);
    fireEvent.click(within(log).getByRole("button", { name: "Show less" }));
    expect(log.classList.contains("is-preview")).toBe(true);
  });

  it("does not offer redundant expansion for exactly five note-free events", () => {
    const state = makeSeed();
    state.logs = Array.from({ length: 5 }, (_, index) => ({
      id: `small-history-${index}`, dayKey: state.activeDayKey, ts: "2026-10-20T12:00:00.000Z",
      type: "Study", minutes: 1, cards: 0,
    }));
    useStore.setState(state);
    render(<ProductivityPage />);
    const log = screen.getByRole("region", { name: "Activity Log" });
    expect(log.querySelectorAll(".activity-row")).toHaveLength(5);
    expect(within(log).queryByRole("button")).toBeNull();
  });
});
