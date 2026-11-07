// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "../../lib/account/accountStore";
import type { RevisionSummary } from "../../lib/sync/syncTypes";
import { markVaultWrite, markVaultWriteFailure } from "../../lib/vaultActivity";
import { AccountSyncPanel } from "./AccountSyncPanel";

const initialAccountState = useAccount.getState();
const user = { id: "learner-1", email: "learner@example.com", displayName: "Alex", emailConfirmed: true };
const revision: RevisionSummary = {
  id: "revision-8", revision: 8, schemaVersion: 35, contentHash: "hash", reason: "manual",
  createdAt: "2026-11-01T12:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAccount.setState(initialAccountState, true);
});

describe("Account protection experience", () => {
  it("keeps local recovery visible when accounts are unavailable", () => {
    const onOpenBackup = vi.fn();
    render(<AccountSyncPanel onOpenBackup={onOpenBackup} />);
    expect(screen.getByText("Waiting for first save")).toBeTruthy();
    expect(document.querySelector(".account-location-indicator.local-saved")).toBeNull();
    expect(screen.getByText("Unavailable in this build")).toBeTruthy();
    expect(screen.getByText("Keep a portable copy.")).toBeTruthy();
    expect(screen.getByText(/no cloud credentials configured/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Emergency recovery" }));
    expect(onOpenBackup).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("lets signed-out learners switch between password, account creation, and email code", () => {
    useAccount.setState({ phase: "signed-out", user: null, protection: "local-only" });
    render(<AccountSyncPanel />);
    expect(screen.getByRole("button", { name: "Sign in", pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("button", { name: "Create", pressed: true })).toBeTruthy();
    expect(screen.getByText("Name on your account")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Email code" }));
    expect(screen.queryByText("Password")).toBeNull();
    expect(screen.getByRole("button", { name: "Send code" })).toBeTruthy();
    expect(screen.getByText(/local workspace stays here until you choose/)).toBeTruthy();
  });

  it("shows a failed account copy and lets the learner retry without hiding automatic retry timing", () => {
    const syncNow = vi.fn(async () => {});
    useAccount.setState({
      phase: "signed-in", user, link: "linked", protection: "retrying", busy: false,
      lastProtectedAt: "2026-10-30T12:00:00.000Z",
      syncFailure: { kind: "network", status: 0, at: "2026-11-01T12:00:00.000Z" },
      nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
      syncNow, refresh: vi.fn(async () => {}),
    });
    render(<AccountSyncPanel />);
    expect(screen.getByText("Waiting for first save")).toBeTruthy();
    expect(screen.getAllByText("Retrying")).toHaveLength(2);
    expect(screen.getByText(/AXOM tries again by itself around/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("keeps protected versions behind a disclosure and confirms a restore", () => {
    const restoreRevision = vi.fn(async () => {});
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    useAccount.setState({
      phase: "signed-in", user, link: "linked", protection: "protected", busy: false,
      history: [revision], devices: [], restoreRevision, refresh: vi.fn(async () => {}),
    });
    render(<AccountSyncPanel />);
    const summary = screen.getByText("Protected versions").closest("summary");
    expect(summary).not.toBeNull();
    expect(summary?.parentElement?.hasAttribute("open")).toBe(false);
    fireEvent.click(summary!);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(restoreRevision).toHaveBeenCalledWith(revision);
  });

  it("keeps both workspaces available as distinct choices when an account version is found", () => {
    const adoptAccountVersion = vi.fn(async () => {});
    const mergeWithAccount = vi.fn(async () => {});
    const keepDeviceWork = vi.fn(async () => {});
    useAccount.setState({
      phase: "signed-in", user, link: "unlinked", protection: "local-only", busy: false,
      restoreOffer: revision, history: [revision], devices: [],
      adoptAccountVersion, mergeWithAccount, keepDeviceWork, refresh: vi.fn(async () => {}),
    });
    render(<AccountSyncPanel />);
    expect(screen.getByText(/Both remain recoverable while you choose/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Merge both/ }));
    expect(mergeWithAccount).toHaveBeenCalledTimes(1);
    expect(adoptAccountVersion).not.toHaveBeenCalled();
    expect(keepDeviceWork).not.toHaveBeenCalled();
  });

  it("shows the last confirmed local save without implying a new save has completed", () => {
    const savedAt = new Date("2026-11-01T12:00:00.000Z");
    markVaultWrite("indexeddb", savedAt);
    render(<AccountSyncPanel />);
    expect(screen.getByText("Last confirmed save")).toBeTruthy();
    expect(screen.getByText(savedAt.toLocaleTimeString())).toBeTruthy();
    expect(document.querySelector(".account-location-indicator.local-saved")).toBeTruthy();
  });

  it("replaces the green local indicator with an alert when vault writes fail", () => {
    const failedAt = new Date("2026-11-01T12:05:00.000Z");
    markVaultWriteFailure(failedAt);
    try {
      render(<AccountSyncPanel />);
      const localStatus = screen.getByRole("alert", { name: "Local save status" });
      expect(localStatus.textContent).toContain("Save needs attention");
      expect(screen.getByRole("button", { name: "Retry local save" })).toBeTruthy();
      expect(localStatus.textContent).toContain(`Not saved since ${failedAt.toLocaleTimeString()}`);
      expect(document.querySelector(".account-location-indicator.local-failure")).toBeTruthy();
      expect(document.querySelector(".account-location-indicator.local-saved")).toBeNull();
    } finally {
      markVaultWrite("indexeddb");
    }
  });
});
