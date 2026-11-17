// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityHistoryPage } from "./ActivityHistoryPage";
import { ActivityExportCellLimitError, ActivityExportTextEncodingError } from "../lib/activityExport";
import type { StudyLog } from "../lib/types";

const fixture = vi.hoisted(() => ({
  logs: [
    { id: "anki-a", type: "Anki", ts: "2026-11-13T13:00:00Z", dayKey: "2026-11-13", minutes: 25, cards: 80 },
    { id: "read-b", type: "Reading", ts: "2026-11-12T13:00:00Z", dayKey: "2026-11-12", minutes: 15, cards: 0 },
  ] as StudyLog[],
  exportWorkbook: vi.fn(),
  pushToast: vi.fn(),
  accountId: "account-A" as string | null,
  identityEpoch: 0,
  link: "linked" as "linked" | "unlinked" | "linked-elsewhere",
  accountSubscribers: new Set<(state: { user: { id: string } | null; link: "linked" | "unlinked" | "linked-elsewhere"; identityEpoch: number }) => void>(),
  beforeSubscribe: null as (() => void) | null,
}));

vi.mock("../lib/account/accountStore", () => ({
  useAccount: {
    getState: () => ({ user: fixture.accountId ? { id: fixture.accountId } : null, link: fixture.link, identityEpoch: fixture.identityEpoch }),
    subscribe: (listener: (state: { user: { id: string } | null; link: "linked" | "unlinked" | "linked-elsewhere"; identityEpoch: number }) => void) => {
      // A sign-in can finish during React commit before the listener is installed.
      const beforeSubscribe = fixture.beforeSubscribe;
      fixture.beforeSubscribe = null;
      beforeSubscribe?.();
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
vi.mock("../lib/activityExport", async (importOriginal) => ({
  // Exercise the real shared chronology and typed export errors while intercepting
  // the download side effect. A test-only comparator could conceal UI/XLSX drift.
  ...(await importOriginal<typeof import("../lib/activityExport")>()),
  exportActivityWorkbook: fixture.exportWorkbook,
}));
vi.mock("../lib/toast", () => ({ pushToast: fixture.pushToast }));

function switchAccount(accountId: string | null, link: typeof fixture.link = accountId ? "linked" : "unlinked") {
  if (fixture.accountId !== accountId || fixture.link !== link) fixture.identityEpoch += 1;
  fixture.accountId = accountId;
  fixture.link = link;
  for (const listener of fixture.accountSubscribers) listener({ user: accountId ? { id: accountId } : null, link, identityEpoch: fixture.identityEpoch });
}

beforeEach(() => {
  fixture.identityEpoch = 0;
  fixture.accountId = "account-A";
  fixture.link = "linked";
  fixture.accountSubscribers.clear();
  fixture.beforeSubscribe = null;
  fixture.exportWorkbook.mockReset();
  fixture.pushToast.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Activity History visible aggregate integrity", () => {
  it("does not show false finite totals when exact saved integer contributions are rounded", () => {
    const original = fixture.logs;
    const values = [1e16, 5, -1e16];
    fixture.logs = values.map((value, index) => ({
      ...original[0], id: `preserved-rounded-${index}`,
      ts: `2026-11-13T13:0${index}:00Z`,
      minutes: value, cards: value, note: `preserved-${index}`,
    }));
    const saved = fixture.logs.map((log) => ({ ...log }));
    try {
      render(<ActivityHistoryPage />);
      expect(screen.getAllByText("Unavailable")).toHaveLength(2);
      expect(screen.getByText("Events").parentElement?.textContent).toContain("3");
      expect(screen.getByText(/preserved-1/)).toBeTruthy();
      expect(screen.queryByText("4", { exact: true })).toBeNull();
      expect(fixture.logs).toEqual(saved);
    } finally {
      fixture.logs = original;
    }
  });

  it("preserves truthful exact integer totals and readable filtered values", () => {
    const original = fixture.logs;
    fixture.logs = [
      { ...original[0], id: "exact-a", minutes: 1e16, cards: 1 },
      { ...original[1], id: "exact-b", minutes: 4, cards: 2 },
      { ...original[0], id: "exact-c", minutes: -1e16, cards: 3 },
    ];
    try {
      render(<ActivityHistoryPage />);
      expect(screen.queryByText("Unavailable")).toBeNull();
      expect(screen.getByText("Minutes").parentElement?.textContent).toContain("4");
      expect(screen.getByText("Cards").parentElement?.textContent).toContain("6");
      fireEvent.change(screen.getByLabelText("Activity type"), { target: { value: "type:Reading" } });
      expect(screen.getByText("Minutes").parentElement?.textContent).toContain("4");
      expect(screen.getByText("Cards").parentElement?.textContent).toContain("2");
    } finally {
      fixture.logs = original;
    }
  });

  it("labels nonfinite source totals unavailable without changing source logs", () => {
    const original = fixture.logs;
    fixture.logs = [{ ...original[0], minutes: Number.NaN, cards: Number.POSITIVE_INFINITY }];
    try {
      render(<ActivityHistoryPage />);
      expect(screen.getAllByText("Unavailable")).toHaveLength(2);
      expect(Number.isNaN(fixture.logs[0].minutes)).toBe(true);
      expect(fixture.logs[0].cards).toBe(Number.POSITIVE_INFINITY);
      expect(screen.getByText("Events").parentElement?.textContent).toContain("1");
    } finally {
      fixture.logs = original;
    }
  });
});

describe("Activity History workbook download feedback", () => {
  it("warns about Excel cell limits without revealing the overlong note or recommending identical retry", async () => {
    const privateNote = "private-data:" + "x".repeat(32768);
    const original = fixture.logs;
    fixture.logs = [{ ...original[0], note: privateNote }];
    fixture.exportWorkbook.mockRejectedValueOnce(new ActivityExportCellLimitError());
    try {
      render(<ActivityHistoryPage />);
      fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
      await waitFor(() => expect(fixture.pushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Activity export stopped",
          tone: "warn",
          body: expect.stringContaining("Excel cell limits"),
        }),
      ));
      const warning = fixture.pushToast.mock.calls[0][0];
      expect(warning.body).not.toContain(privateNote);
      expect(warning.body).not.toMatch(/try exporting again/i);
      expect(fixture.logs[0].note).toBe(privateNote);
    } finally {
      fixture.logs = original;
    }
  });

  it("identifies invalid Unicode export refusal without leaking notes or suggesting an unchanged retry", async () => {
    const privateNote = "sensitive-" + String.fromCharCode(0xd800);
    const original = fixture.logs;
    fixture.logs = [{ ...original[0], note: privateNote }];
    fixture.exportWorkbook.mockRejectedValueOnce(new ActivityExportTextEncodingError());
    try {
      render(<ActivityHistoryPage />);
      fireEvent.click(screen.getByRole("button", { name: /Export .xlsx/i }));
      await waitFor(() => expect(fixture.pushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Activity export stopped",
          tone: "warn",
          body: expect.stringContaining("invalid Unicode"),
        }),
      ));
      const warning = fixture.pushToast.mock.calls[0][0];
      expect(warning.body).not.toContain(privateNote);
      expect(warning.body).not.toMatch(/try exporting again/i);
      expect(fixture.logs[0].note).toBe(privateNote);
    } finally {
      fixture.logs = original;
    }
  });

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


  it("redacts A history after a presubscription A→B→A transition using the session epoch", () => {
    const originalLogs = fixture.logs;
    fixture.logs = [{ ...originalLogs[0], note: "private-account-ABA-epoch" }];
    fixture.beforeSubscribe = () => {
      switchAccount("account-B");
      switchAccount("account-A");
    };
    try {
      render(<ActivityHistoryPage />);
      expect(fixture.identityEpoch).toBe(2);
      expect(fixture.accountId).toBe("account-A");
      expect(screen.getByText("Activity History session changed")).toBeTruthy();
      expect(screen.queryByText(/private-account-ABA-epoch/)).toBeNull();
      expect(screen.queryByRole("button", { name: /Export .xlsx/i })).toBeNull();
      expect(fixture.exportWorkbook).not.toHaveBeenCalled();
      expect(fixture.logs).toHaveLength(1);
    } finally {
      fixture.logs = originalLogs;
      fixture.beforeSubscribe = null;
    }
  });

  it("redacts A history after a presubscription linked→unlinked→linked ABA", () => {
    const originalLogs = fixture.logs;
    fixture.logs = [{ ...originalLogs[0], note: "private-link-ABA-epoch" }];
    fixture.beforeSubscribe = () => {
      switchAccount("account-A", "unlinked");
      switchAccount("account-A", "linked");
    };
    try {
      render(<ActivityHistoryPage />);
      expect(fixture.identityEpoch).toBe(2);
      expect(fixture.accountId).toBe("account-A");
      expect(fixture.link).toBe("linked");
      expect(screen.getByText("Activity History session changed")).toBeTruthy();
      expect(screen.queryByText(/private-link-ABA-epoch/)).toBeNull();
      expect(screen.queryByRole("button", { name: /Export .xlsx/i })).toBeNull();
      expect(fixture.exportWorkbook).not.toHaveBeenCalled();
      expect(fixture.logs).toHaveLength(1);
    } finally {
      fixture.logs = originalLogs;
      fixture.beforeSubscribe = null;
    }
  });

  it("does not revoke unchanged account and device-link updates", () => {
    render(<ActivityHistoryPage />);
    act(() => { switchAccount("account-A", "linked"); });
    expect(fixture.identityEpoch).toBe(0);
    expect(screen.queryByText("Activity History session changed")).toBeNull();
    expect(screen.getByRole("button", { name: /Export .xlsx/i })).toBeTruthy();
  });

  it("redacts an account change between initial render and account subscription", () => {
    const originalLogs = fixture.logs;
    fixture.logs = [{ ...originalLogs[0], note: "A-only-note-before-subscription" }];
    // Deliver B before useAccount.subscribe registers its listener: passive-effect
    // listeners alone cannot observe this missed transition.
    fixture.beforeSubscribe = () => { switchAccount("account-B"); };
    try {
      render(<ActivityHistoryPage />);
      expect(fixture.accountId).toBe("account-B");
      expect(screen.queryByText(/A-only-note-before-subscription/)).toBeNull();
      expect(screen.getByText("Activity History session changed")).toBeTruthy();
      expect(screen.queryByLabelText("Activity type")).toBeNull();
      expect(screen.queryByRole("button", { name: /Export .xlsx/i })).toBeNull();
      expect(fixture.logs).toHaveLength(1);
    } finally {
      fixture.logs = originalLogs;
      fixture.beforeSubscribe = null;
    }
  });

  it("announces a session change and moves focus from removed filters into the notice", () => {
    render(<ActivityHistoryPage />);
    const typeSelect = screen.getByLabelText("Activity type") as HTMLSelectElement;
    typeSelect.focus();
    expect(document.activeElement).toBe(typeSelect);

    act(() => { switchAccount("account-B"); });

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Activity History session changed");
    expect(notice.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(notice);
    expect(screen.queryByLabelText("Activity type")).toBeNull();
    expect(screen.queryByRole("button", { name: /Export .xlsx/i })).toBeNull();
  });

  it("does not steal focus outside Activity History when the account changes", () => {
    render(<ActivityHistoryPage />);
    const elsewhere = document.createElement("button");
    elsewhere.type = "button";
    document.body.appendChild(elsewhere);
    try {
      elsewhere.focus();
      expect(document.activeElement).toBe(elsewhere);

      act(() => { switchAccount("account-B"); });

      expect(screen.getByRole("status")).toBeTruthy();
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
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
      { id: "tie-offset", type: "tie-offset", ts: "2026-11-13T11:30:00-05:00", dayKey: "2026-11-13", minutes: 5, cards: 0 },
      { id: "tie-b", type: "tie-b", ts: "2026-11-13T16:30:00Z", dayKey: "2026-11-13", minutes: 5, cards: 0 },
      { id: "tie-a", type: "tie-a", ts: "2026-11-13T16:30:00Z", dayKey: "2026-11-13", minutes: 5, cards: 0 },
    ];
    try {
      render(<ActivityHistoryPage />);
      const ids = ["tie-a", "tie-b", "tie-offset", "later", "earlier", "broken"];
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

  it("keeps retained device notes private until an unlinked B explicitly reveals them", () => {
    const originalLogs = fixture.logs;
    fixture.logs = [{ ...originalLogs[0], note: "previous-account-device-note" }];
    switchAccount("account-B", "unlinked");
    try {
      render(<ActivityHistoryPage />);
      expect(screen.getByText("Device history needs confirmation")).toBeTruthy();
      expect(screen.queryByText(/previous-account-device-note/)).toBeNull();
      expect(screen.queryByLabelText("Activity type")).toBeNull();
      expect(screen.queryByText("25")).toBeNull();
      expect(screen.queryByRole("button", { name: /Export .xlsx/i })).toBeNull();
      expect(fixture.logs).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: "Show device history" }));
      expect(screen.getByText(/previous-account-device-note/)).toBeTruthy();
      expect(screen.getByRole("button", { name: /Export .xlsx/i })).toBeTruthy();
      expect(fixture.logs).toHaveLength(1);
    } finally {
      fixture.logs = originalLogs;
    }
  });

  it("focuses and announces the newly revealed History region after disclosure", () => {
    switchAccount("account-B", "unlinked");
    render(<ActivityHistoryPage />);
    const disclosure = screen.getByRole("button", { name: "Show device history" });
    disclosure.focus();
    expect(document.activeElement).toBe(disclosure);

    fireEvent.click(disclosure);

    const region = screen.getByRole("region", { name: "Activity History" });
    expect(document.activeElement).toBe(region);
    expect(region.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("button", { name: /Export .xlsx/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show device history" })).toBeNull();
  });

  it("preserves unrelated keyboard focus when a disclosure action is invoked without focused consent", () => {
    switchAccount("account-B", "unlinked");
    render(<ActivityHistoryPage />);
    const elsewhere = document.createElement("button");
    elsewhere.type = "button";
    document.body.appendChild(elsewhere);
    try {
      elsewhere.focus();
      expect(document.activeElement).toBe(elsewhere);
      fireEvent.click(screen.getByRole("button", { name: "Show device history" }));
      expect(screen.getByRole("region", { name: "Activity History" })).toBeTruthy();
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });

  it("moves focus from an invalidated device-history consent button to the session notice", () => {
    switchAccount("account-B", "unlinked");
    render(<ActivityHistoryPage />);
    const button = screen.getByRole("button", { name: "Show device history" });
    button.focus();
    expect(document.activeElement).toBe(button);

    act(() => { switchAccount("account-A", "linked"); });

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Activity History session changed");
    expect(document.activeElement).toBe(notice);
  });

  it("re-guards a fresh unlinked mount and revokes revealed notes when the account changes", () => {
    const originalLogs = fixture.logs;
    fixture.logs = [{ ...originalLogs[0], note: "private-device-note-after-switch" }];
    switchAccount("account-B", "unlinked");
    try {
      render(<ActivityHistoryPage />);
      fireEvent.click(screen.getByRole("button", { name: "Show device history" }));
      expect(screen.getByText(/private-device-note-after-switch/)).toBeTruthy();

      act(() => { switchAccount("account-A", "linked"); });
      expect(screen.queryByText(/private-device-note-after-switch/)).toBeNull();
      expect(screen.getByText("Activity History session changed")).toBeTruthy();

      cleanup();
      switchAccount("account-B", "unlinked");
      render(<ActivityHistoryPage />);
      expect(screen.getByText("Device history needs confirmation")).toBeTruthy();
      expect(screen.queryByText(/private-device-note-after-switch/)).toBeNull();
      expect(fixture.logs).toHaveLength(1);
    } finally {
      fixture.logs = originalLogs;
    }
  });

  it("asks before exporting retained device work after an unlinked B sign-in, without deleting A logs", async () => {
    // Signing out leaves the device study logs intact. A fresh B view must not silently export them.
    switchAccount(null, "unlinked");
    switchAccount("account-B", "unlinked");
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<ActivityHistoryPage />);
    expect(screen.queryByRole("button", { name: /Export .xlsx/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show device history" }));

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
    expect(screen.queryByRole("button", { name: /Export .xlsx/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show device history" }));
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
