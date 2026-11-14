// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityHistoryPage } from "./ActivityHistoryPage";

const fixture = vi.hoisted(() => ({
  logs: [
    { id: "anki-a", type: "Anki", ts: "2026-11-13T13:00:00Z", dayKey: "2026-11-13", minutes: 25, cards: 80 },
    { id: "read-b", type: "Reading", ts: "2026-11-12T13:00:00Z", dayKey: "2026-11-12", minutes: 15, cards: 0 },
  ],
  exportWorkbook: vi.fn(),
  pushToast: vi.fn(),
  accountId: "account-A" as string | null,
  accountSubscribers: new Set<(state: { user: { id: string } | null }) => void>(),
}));

vi.mock("../lib/account/accountStore", () => ({
  useAccount: {
    getState: () => ({ user: fixture.accountId ? { id: fixture.accountId } : null }),
    subscribe: (listener: (state: { user: { id: string } | null }) => void) => {
      fixture.accountSubscribers.add(listener);
      return () => { fixture.accountSubscribers.delete(listener); };
    },
  },
}));

vi.mock("../lib/store", () => ({
  useStore: (select: (state: { logs: typeof fixture.logs }) => unknown) => select({ logs: fixture.logs }),
}));
vi.mock("../lib/activityExport", () => ({ exportActivityWorkbook: fixture.exportWorkbook }));
vi.mock("../lib/toast", () => ({ pushToast: fixture.pushToast }));

function switchAccount(accountId: string | null) {
  fixture.accountId = accountId;
  for (const listener of fixture.accountSubscribers) listener({ user: accountId ? { id: accountId } : null });
}

beforeEach(() => {
  fixture.accountId = "account-A";
  fixture.accountSubscribers.clear();
  fixture.exportWorkbook.mockReset();
  fixture.pushToast.mockReset();
});
afterEach(cleanup);

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

  it("refuses stale mounted export after account switch, while preserving local-only exports", async () => {
    render(<ActivityHistoryPage />);
    switchAccount("account-B");
    switchAccount("account-A");
    fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
    await waitFor(() => expect(fixture.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Activity export canceled" }),
    ));
    expect(fixture.exportWorkbook).not.toHaveBeenCalled();
    cleanup();
    fixture.pushToast.mockClear();
    switchAccount(null);
    render(<ActivityHistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
    await waitFor(() => expect(fixture.exportWorkbook).toHaveBeenCalledTimes(1));
    expect(fixture.pushToast).not.toHaveBeenCalled();
  });

});
