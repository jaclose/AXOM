// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appUpdates, type UpdateState } from "../../lib/appUpdates";
import { AppUpdatePanel } from "./AppUpdatePanel";

vi.mock("../../lib/appUpdates", () => ({
  appUpdates: {
    getSnapshot: vi.fn(), subscribe: vi.fn(() => () => {}),
    hasDownloaded: vi.fn(() => false), apply: vi.fn(async () => {}),
    check: vi.fn(), download: vi.fn(), defer: vi.fn(),
  },
}));
vi.mock("../../lib/store", () => ({ useStore: { getState: vi.fn(() => ({ sessions: [] })) } }));
vi.mock("../../lib/sessions", () => ({ findLiveSession: vi.fn(() => null) }));
vi.mock("../../lib/updatePreferences", () => ({
  UPDATE_PREFS_EVENT: "axom:test-update-prefs",
  readUpdatePreferences: vi.fn(() => ({ autoDownload: false })),
  writeUpdatePreferences: vi.fn(),
}));
vi.mock("../../lib/lazyWithFallback", () => ({ lazyWithFallback: () => () => null }));

const failedSave: UpdateState = {
  phase: "error", desktop: false, version: "0.0.4", downloadedBytes: 0,
  deferred: false, restartPending: false,
  error: "Could not verify the saved workspace. Export a backup in Settings before retrying.",
  canRefreshWithoutVerifiedSave: true,
};

beforeEach(() => {
  vi.mocked(appUpdates.getSnapshot).mockReturnValue(failedSave);
  vi.mocked(appUpdates.hasDownloaded).mockReturnValue(false);
  vi.mocked(appUpdates.apply).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("app update save-failure confirmation", () => {
  it("shows a clear data-loss warning and allows the user to cancel without refreshing", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AppUpdatePanel />);
    expect(screen.getByRole("alert").textContent).toContain("unverified changes could be permanently lost");
    expect(screen.getByRole("button", { name: "Retry save and refresh" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh anyway" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain("Are you sure");
    expect(appUpdates.apply).not.toHaveBeenCalled();
  });

  it("refreshes on explicit confirmation without claiming the workspace was saved", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AppUpdatePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh anyway" }));
    expect(appUpdates.apply).toHaveBeenCalledWith({ refreshWithoutVerifiedSave: true });
  });

  it("does not show an unsafe override before saving fails or on desktop", () => {
    vi.mocked(appUpdates.getSnapshot).mockReturnValue({
      ...failedSave, phase: "available", canRefreshWithoutVerifiedSave: false,
    });
    const first = render(<AppUpdatePanel />);
    expect(screen.queryByRole("button", { name: "Refresh anyway" })).toBeNull();
    first.unmount();
    vi.mocked(appUpdates.getSnapshot).mockReturnValue({ ...failedSave, desktop: true });
    render(<AppUpdatePanel />);
    expect(screen.queryByRole("button", { name: "Refresh anyway" })).toBeNull();
  });
});
