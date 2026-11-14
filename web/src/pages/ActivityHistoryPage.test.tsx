// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityHistoryPage } from "./ActivityHistoryPage";
import type { StudyLog } from "../lib/types";

const fixture = vi.hoisted(() => ({
  logs: [
    { id: "anki-a", type: "Anki", ts: "2026-11-13T13:00:00Z", dayKey: "2026-11-13", minutes: 25, cards: 80 },
    { id: "read-b", type: "Reading", ts: "2026-11-12T13:00:00Z", dayKey: "2026-11-12", minutes: 15, cards: 0 },
  ] as StudyLog[],
  exportWorkbook: vi.fn(),
  pushToast: vi.fn(),
  accountId: "account-A" as string | null,
  link: "linked" as "linked" | "unlinked" | "linked-elsewhere",
  accountSubscribers: new Set<(state: { user: { id: string } | null; link: "linked" | "unlinked" | "linked-elsewhere" }) => void>(),
}));

vi.mock("../lib/account/accountStore", () => ({
  useAccount: {
    getState: () => ({ user: fixture.accountId ? { id: fixture.accountId } : null, link: fixture.link }),
    subscribe: (listener: (state: { user: { id: string } | null; link: "linked" | "unlinked" | "linked-elsewhere" }) => void) => {
      fixture.accountSubscribers.add(listener);
      return () => { fixture.accountSubscribers.delete(listener); };
    },
  },
}));

vi.mock("../lib/store", () => ({
  useStore: Object.assign(
    (select: (state: { logs: typeof fixture.logs }) => unknown) => select({ logs: fixture.logs }),
    { getState: () => ({ logs: fixture.logs }) },
  ),
}));
vi.mock("../lib/activityExport", () => ({ exportActivityWorkbook: fixture.exportWorkbook }));
vi.mock("../lib/toast", () => ({ pushToast: fixture.pushToast }));

function switchAccount(accountId: string | null, link: typeof fixture.link = accountId ? "linked" : "unlinked") {
  fixture.accountId = accountId;
  fixture.link = link;
  for (const listener of fixture.accountSubscribers) listener({ user: accountId ? { id: accountId } : null, link });
}

beforeEach(() => {
  fixture.accountId = "account-A";
  fixture.link = "linked";
  fixture.accountSubscribers.clear();
  fixture.exportWorkbook.mockReset();
  fixture.pushToast.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Activity History workbook download feedback", () => {
  it("keeps the export disabled during a pending write, without a false success notice", async () => {
    let finish!: () => void;
    fixture.exportWorkbook.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    render(<ActivityHistoryPage />);

    const button = screen.getByRole("button", { name: /Export .xlsx/i });
    fireEvent.click(button);

    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(fixture.exportWorkbook).toHaveBeenCalledTimes(1);
    expect(fixture.pushToast).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    expect(fixture.pushToast).not.toHaveBeenCalled();
  });

  it("reports a failed file write and permits retry without losing the selected filter", async () => {
    fixture.exportWorkbook.mockRejectedValueOnce(new Error("File download unavailable"))
      .mockResolvedValueOnce(undefined);
    render(<ActivityHistoryPage />);

    const ankiOption = screen.getByRole("option", { name: "Anki" }) as HTMLOptionElement;
    fireEvent.change(screen.getByLabelText("Activity type"), { target: { value: ankiOption.value } });
    const button = screen.getByRole("button", { name: /Export .xlsx/i });
    fireEvent.click(button);

    await waitFor(() => expect(fixture.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Activity export failed", tone: "warn" }),
    ));
    expect(button).toHaveProperty("disabled", false);
    expect(fixture.exportWorkbook).toHaveBeenCalledTimes(1);
    expect(fixture.exportWorkbook.mock.calls[0][0]).toEqual([fixture.logs[0]]);

    fireEvent.click(button);
    await waitFor(() => expect(fixture.exportWorkbook).toHaveBeenCalledTimes(2));
    expect(fixture.exportWorkbook.mock.calls[1][0]).toEqual([fixture.logs[0]]);
    expect(fixture.pushToast).toHaveBeenCalledTimes(1);
  });


  it("revokes account A's rendered notes, stats, filters and export on A→B→A", () => {
    const originalLogs = fixture.logs;
    fixture.logs = [
      { ...originalLogs[0], note: "account-A-private-note" },
      ...originalLogs.slice(1),
    ] as typeof fixture.logs;
    try {
      render(<ActivityHistoryPage />);
      expect(screen.getByText(/account-A-private-note/)).toBeTruthy();
      expect(screen.getByLabelText("Activity type")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Export .xlsx/i })).toBeTruthy();

      act(() => { switchAccount("account-B"); });
      expect(screen.queryByText(/account-A-private-note/)).toBeNull();
      expect(screen.queryByLabelText("Activity type")).toBeNull();
      expect(screen.queryByRole("button", { name: /Export .xlsx/i })).toBeNull();
      expect(screen.getByText("Activity History session changed")).toBeTruthy();

      act(() => { switchAccount("account-A"); });
      expect(screen.queryByText(/account-A-private-note/)).toBeNull();
      expect(screen.queryByRole("button", { name: /Export .xlsx/i })).toBeNull();
      expect(fixture.logs).toHaveLength(2);
    } finally {
      fixture.logs = originalLogs;
    }
  });

  it("revokes device-local notes on a link-only transition without losing logs", () => {
    const originalLogs = fixture.logs;
    fixture.logs = [{ ...originalLogs[0], note: "local-only-private-note" }] as typeof fixture.logs;
    try {
      render(<ActivityHistoryPage />);
      expect(screen.getByText(/local-only-private-note/)).toBeTruthy();
      act(() => { switchAccount("account-A", "unlinked"); });
      expect(screen.queryByText(/local-only-private-note/)).toBeNull();
      expect(screen.queryByLabelText("Activity type")).toBeNull();
      act(() => { switchAccount("account-A", "linked"); });
      expect(screen.queryByText(/local-only-private-note/)).toBeNull();
      expect(screen.queryByRole("button", { name: /Export .xlsx/i })).toBeNull();
      expect(fixture.logs).toHaveLength(1);
    } finally {
      fixture.logs = originalLogs;
    }
  });

  it("renders valid instants newest first, with deterministic ties and malformed timestamps last", () => {
    const original = fixture.logs;
    fixture.logs = [
      { id: "broken", type: "broken", ts: "not-a-date", dayKey: "2026-11-13", minutes: 5, cards: 0 },
      { id: "earlier", type: "earlier", ts: "2026-11-13T15:00:00Z", dayKey: "2026-11-13", minutes: 5, cards: 0 },
      { id: "later", type: "later", ts: "2026-11-13T12:00:00-04:00", dayKey: "2026-11-13", minutes: 5, cards: 0 },
      { id: "tie-b", type: "tie-b", ts: "2026-11-13T16:30:00Z", dayKey: "2026-11-13", minutes: 5, cards: 0 },
      { id: "tie-a", type: "tie-a", ts: "2026-11-13T16:30:00Z", dayKey: "2026-11-13", minutes: 5, cards: 0 },
    ];
    try {
      render(<ActivityHistoryPage />);
      const ids = ["tie-a", "tie-b", "later", "earlier", "broken"];
      const rendered = [...document.querySelectorAll(".activity-history-row")]
        .map((row) => ids.find((id) => row.textContent?.includes(id)));
      expect(rendered).toEqual(ids);
    } finally {
      fixture.logs = original;
    }
  });

  it("filters and exports a literal All activity independently from the all-types option", () => {
    const originalLogs = fixture.logs;
    fixture.logs = [
      { id: "all-event", type: "All", ts: "2026-11-13T14:00:00Z", dayKey: "2026-11-13", minutes: 17, cards: 4 },
      { id: "reading-event", type: "Reading", ts: "2026-11-13T13:00:00Z", dayKey: "2026-11-13", minutes: 29, cards: 0 },
    ];
    try {
      render(<ActivityHistoryPage />);
      expect(document.querySelectorAll(".activity-history-row")).toHaveLength(2);
      const typeSelect = screen.getByLabelText("Activity type");
      const literalAll = screen.getByRole("option", { name: /^All$/ }) as HTMLOptionElement;
      fireEvent.change(typeSelect, { target: { value: literalAll.value } });

      const rows = [...document.querySelectorAll(".activity-history-row")];
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain("All");
      fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
      expect(fixture.exportWorkbook).toHaveBeenCalledWith([fixture.logs[0]], undefined, expect.any(Function));

      const showAll = screen.getByRole("option", { name: "All activity types" }) as HTMLOptionElement;
      fireEvent.change(typeSelect, { target: { value: showAll.value } });
      expect(document.querySelectorAll(".activity-history-row")).toHaveLength(2);
    } finally {
      fixture.logs = originalLogs;
    }
  });

  it("cancels a pending A export after A→B→A, before the writer saves any file", async () => {
    let release!: () => void;
    const saved = vi.fn();
    fixture.exportWorkbook.mockImplementationOnce(async (_logs: unknown, _writer: unknown, assertCurrent: () => void) => {
      await new Promise<void>((resolve) => { release = resolve; });
      assertCurrent();
      saved();
    });
    render(<ActivityHistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
    expect(fixture.exportWorkbook).toHaveBeenCalledTimes(1);
    switchAccount("account-B");
    switchAccount("account-A");
    release();
    await waitFor(() => expect(fixture.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Activity export canceled", tone: "warn" }),
    ));
    expect(saved).not.toHaveBeenCalled();
  });

  it("cancels an in-flight XLSX write after same-account study history is replaced", async () => {
    let release!: () => void;
    const saved = vi.fn();
    fixture.exportWorkbook.mockImplementationOnce(async (_logs: unknown, _writer: unknown, assertCurrent: () => void) => {
      await new Promise<void>((resolve) => { release = resolve; });
      assertCurrent();
      saved();
    });
    const originalLogs = fixture.logs;
    try {
      render(<ActivityHistoryPage />);
      fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
      expect(fixture.exportWorkbook).toHaveBeenCalledTimes(1);

      // Restoring a workspace under the same authenticated account replaces its logs.
      fixture.logs = [{ ...originalLogs[0], id: "new-workspace", minutes: 5 }];
      expect(fixture.accountId).toBe("account-A");
      release();

      await waitFor(() => expect(fixture.pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Activity export canceled", tone: "warn" }),
      ));
      expect(saved).not.toHaveBeenCalled();
      expect(fixture.logs[0].id).toBe("new-workspace");
    } finally {
      fixture.logs = originalLogs;
    }
  });

  it("rejects a stale visible History view when local logs change before an export click", async () => {
    const originalLogs = fixture.logs;
    try {
      render(<ActivityHistoryPage />);
      fixture.logs = originalLogs.slice();
      fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
      await waitFor(() => expect(fixture.pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Activity export canceled" }),
      ));
      expect(fixture.exportWorkbook).not.toHaveBeenCalled();
    } finally {
      fixture.logs = originalLogs;
    }
  });

  it("refuses stale mounted export after account switch, while preserving local-only exports", async () => {
    render(<ActivityHistoryPage />);
    act(() => {
      switchAccount("account-B");
      switchAccount("account-A");
    });
    expect(screen.getByText("Activity History session changed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Export .xlsx/i })).toBeNull();
    expect(fixture.exportWorkbook).not.toHaveBeenCalled();
    cleanup();
    fixture.pushToast.mockClear();
    switchAccount(null);
    render(<ActivityHistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
    await waitFor(() => expect(fixture.exportWorkbook).toHaveBeenCalledTimes(1));
    expect(fixture.pushToast).not.toHaveBeenCalled();
  });

  it("enforces the account check at the real XLSX writer boundary", async () => {
    const actual = await vi.importActual<typeof import("../lib/activityExport")>("../lib/activityExport");
    const saveWorkbook = vi.fn();
    let checks = 0;
    const invalidatedAtWrite = () => {
      checks++;
      if (checks === 2) throw new Error("Account changed before workbook download");
    };
    await expect(actual.exportActivityWorkbook(fixture.logs, saveWorkbook, invalidatedAtWrite))
      .rejects.toThrow("Account changed before workbook download");
    expect(checks).toBe(2);
    expect(saveWorkbook).not.toHaveBeenCalled();

    const assertCurrent = vi.fn();
    await expect(actual.exportActivityWorkbook(fixture.logs, saveWorkbook, assertCurrent))
      .resolves.toBeUndefined();
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(saveWorkbook).toHaveBeenCalledTimes(1);
  });

  it("asks before exporting retained device work after an unlinked B sign-in, without deleting A logs", async () => {
    // Signing out leaves the device study logs intact. A fresh B view must not silently export them.
    switchAccount(null, "unlinked");
    switchAccount("account-B", "unlinked");
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<ActivityHistoryPage />);

    const button = screen.getByRole("button", { name: /Export .xlsx/i });
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/different account/i);
    expect(fixture.exportWorkbook).not.toHaveBeenCalled();
    expect(fixture.logs).toHaveLength(2);

    fireEvent.click(button);
    await waitFor(() => expect(fixture.exportWorkbook).toHaveBeenCalledTimes(1));
    expect(fixture.exportWorkbook.mock.calls[0][0]).toEqual(fixture.logs);
    expect(fixture.pushToast).not.toHaveBeenCalled();
  });

  it("requires the same disclosure for a workspace linked elsewhere", () => {
    switchAccount("account-B", "linked-elsewhere");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ActivityHistoryPage />);

    fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fixture.exportWorkbook).not.toHaveBeenCalled();
  });

  it("retains immediate export for linked and signed-out local-only sessions", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ActivityHistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
    await waitFor(() => expect(fixture.exportWorkbook).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();

    cleanup();
    switchAccount(null, "unlinked");
    render(<ActivityHistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
    await waitFor(() => expect(fixture.exportWorkbook).toHaveBeenCalledTimes(2));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("cancels a pending export if the device link changes without an account-ID or log change", async () => {
    let release!: () => void;
    const saved = vi.fn();
    fixture.exportWorkbook.mockImplementationOnce(async (_logs: unknown, _writer: unknown, assertCurrent: () => void) => {
      await new Promise<void>((resolve) => { release = resolve; });
      assertCurrent();
      saved();
    });
    const originalLogs = fixture.logs;
    render(<ActivityHistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
    expect(fixture.exportWorkbook).toHaveBeenCalledTimes(1);

    switchAccount("account-A", "unlinked");
    expect(fixture.accountId).toBe("account-A");
    expect(fixture.logs).toBe(originalLogs);
    release();

    await waitFor(() => expect(fixture.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Activity export canceled", tone: "warn" }),
    ));
    expect(saved).not.toHaveBeenCalled();
    expect(fixture.logs).toBe(originalLogs);
  });

  it("keeps an export revoked across linked to unlinked to linked transitions", async () => {
    let release!: () => void;
    const saved = vi.fn();
    fixture.exportWorkbook.mockImplementationOnce(async (_logs: unknown, _writer: unknown, assertCurrent: () => void) => {
      await new Promise<void>((resolve) => { release = resolve; });
      assertCurrent();
      saved();
    });
    render(<ActivityHistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
    switchAccount("account-A", "unlinked");
    switchAccount("account-A", "linked");
    release();

    await waitFor(() => expect(fixture.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Activity export canceled", tone: "warn" }),
    ));
    expect(saved).not.toHaveBeenCalled();
  });

  it("rejects a stale mounted History view after a same-account link transition before click", async () => {
    render(<ActivityHistoryPage />);
    const consent = vi.spyOn(window, "confirm").mockReturnValue(true);
    act(() => { switchAccount("account-A", "unlinked"); });
    expect(screen.getByText("Activity History session changed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Export .xlsx/i })).toBeNull();
    expect(fixture.exportWorkbook).not.toHaveBeenCalled();
    expect(consent).not.toHaveBeenCalled();
  });


});
