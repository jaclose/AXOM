// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  state: {
    phase: "error",
    desktop: false,
    version: "0.0.3-prebeta",
    downloadedBytes: 0,
    deferred: false,
    restartPending: false,
    canRefreshWithoutVerifiedSave: true,
    canContinueWithoutRecoverySnapshot: false,
    error: "Could not verify the saved workspace.",
  },
  apply: vi.fn(async (_options?: { skipFailedCheckpoint?: boolean }) => undefined),
}));

vi.mock("../../lib/appUpdates", () => ({
  appUpdates: {
    subscribe: () => () => {},
    getSnapshot: () => mocks.state,
    hasDownloaded: () => false,
    apply: mocks.apply,
  },
}));
vi.mock("../../lib/store", () => ({ useStore: { getState: () => ({ sessions: [] }) } }));
vi.mock("../../lib/lazyWithFallback", () => ({ lazyWithFallback: () => () => null }));
vi.mock("../../lib/updatePreferences", () => ({
  UPDATE_PREFS_EVENT: "axom:update-preferences",
  readUpdatePreferences: () => ({ autoDownload: false }),
  writeUpdatePreferences: vi.fn(),
}));

import { AppUpdatePanel } from "./AppUpdatePanel";

beforeEach(() => {
  mocks.state.phase = "error";
  mocks.state.desktop = false;
  mocks.state.canRefreshWithoutVerifiedSave = true;
  mocks.state.canContinueWithoutRecoverySnapshot = false;
  mocks.apply.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("AppUpdatePanel risky refresh confirmation", () => {
  it("explains potential data loss and offers a separate action when verification fails", () => {
    render(<AppUpdatePanel />);
    expect(screen.getByRole("button", { name: "Retry save and refresh" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh anyway" })).toBeTruthy();
    expect(document.getElementById("update-unverified-save-warning")?.textContent).toMatch(/may lose recent changes/i);
  });

  it("does not bypass saving when the user cancels", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AppUpdatePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh anyway" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Are you sure"));
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("bypasses the failed checkpoint only after explicit confirmation", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AppUpdatePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh anyway" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Are you sure"));
    expect(mocks.apply).toHaveBeenCalledWith({ skipFailedCheckpoint: true });
  });

  it("offers a confirmed refresh and safe backup retry when only the extra copy fails", () => {
    mocks.state.canContinueWithoutRecoverySnapshot = true;
    mocks.state.canRefreshWithoutVerifiedSave = false;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AppUpdatePanel />);
    expect(screen.getByRole("button", { name: "Confirm and refresh" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry full backup" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh anyway" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and refresh" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("verified your latest workspace"));
    expect(mocks.apply).toHaveBeenCalledWith({ skipRecoverySnapshot: true });
  });

  it("does not offer an unsafe refresh outside the failed-save state", () => {
    mocks.state.canRefreshWithoutVerifiedSave = false;
    render(<AppUpdatePanel />);
    expect(screen.queryByRole("button", { name: "Refresh anyway" })).toBeNull();
  });
});
