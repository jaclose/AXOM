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
}));

vi.mock("../lib/store", () => ({
  useStore: (select: (state: { logs: typeof fixture.logs }) => unknown) => select({ logs: fixture.logs }),
}));
vi.mock("../lib/activityExport", () => ({ exportActivityWorkbook: fixture.exportWorkbook }));
vi.mock("../lib/toast", () => ({ pushToast: fixture.pushToast }));

beforeEach(() => {
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

    fireEvent.change(screen.getByLabelText("Activity type"), { target: { value: "Anki" } });
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
});
