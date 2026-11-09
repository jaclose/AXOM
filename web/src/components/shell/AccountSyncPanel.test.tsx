// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "../../lib/account/accountStore";
import type { RevisionSummary } from "../../lib/sync/syncTypes";
import { markVaultWrite, markVaultWriteFailure } from "../../lib/vaultActivity";
import { AccountSyncPanel } from "./AccountSyncPanel";
import { beginSyncProgress, useSyncProgress } from "../../lib/sync/syncProgress";

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
  useSyncProgress.setState({ current: null, attention: null });
});

describe("Account protection experience", () => {
  it("shows real upload progress only to its account and keeps the last protected receipt", () => {
    useAccount.setState({ phase: "signed-in", user, link: "linked", protection: "saved-locally", init: vi.fn(), refresh: vi.fn(), lastProtectedAt: "2026-09-30T12:00:00Z" });
    const progress = beginSyncProgress(user.id);
    progress.report("content", 21, 60);
    render(<AccountSyncPanel />);
    expect(screen.getByText("Saving questions and source text · 21 of 60")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Protecting…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/Last protected/).length).toBeGreaterThan(0);
    act(() => useAccount.setState({ user: { ...user, id: "another-account" } }));
    expect(screen.queryByText(/Saving questions and source text/)).toBeNull();
    act(() => progress.finish());
  });

  it("identifies missing images locally and offers recovery without exposing another account's details", () => {
    useAccount.setState({ phase: "signed-in", user, link: "linked", protection: "blocked", init: vi.fn(), refresh: vi.fn() });
    const progress = beginSyncProgress(user.id);
    progress.attention([{ questionId: "q1", questionLabel: "Review this source figure", fileName: "original-figure.png" }]);
    progress.finish();
    const recovery = vi.fn();
    render(<AccountSyncPanel onOpenBackup={recovery} />);
    expect(screen.getByText("original-figure.png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Emergency recovery" }));
    expect(recovery).toHaveBeenCalledOnce();
    act(() => useAccount.setState({ user: { ...user, id: "different-account" } }));
    expect(screen.queryByText("original-figure.png")).toBeNull();
  });
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

  it("offers private-by-default Community choices during account creation", async () => {
    const signUp = vi.fn(async () => true);
    useAccount.setState({ phase: "signed-out", user: null, busy: false, signUp });
    render(<AccountSyncPanel />);
    expect(screen.queryByRole("region", { name: "Community and leaderboards" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((screen.getByRole("checkbox", { name: "Appear in learner search" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: "Off" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Name on your account"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "learner@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith("learner@example.com", "password123", "Alex", { discoverable: false, shareMode: "off" }));
  });

  it("lets new learners choose sharing without silently opting them into discovery", async () => {
    const signUp = vi.fn(async () => true);
    useAccount.setState({ phase: "signed-out", user: null, busy: false, signUp });
    render(<AccountSyncPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("radio", { name: "Community" }));
    expect((screen.getByRole("checkbox", { name: "Appear in learner search" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/With learner search off/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name on your account"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "learner@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith("learner@example.com", "password123", "Alex", { discoverable: false, shareMode: "community" }));
  });

  it("offers the same choices when an email code may create a new account", async () => {
    const sendCode = vi.fn(async () => true);
    useAccount.setState({ phase: "signed-out", user: null, busy: false, sendCode });
    render(<AccountSyncPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Email code" }));
    expect(screen.getByText(/Existing accounts keep their saved choices/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Appear in learner search" }));
    fireEvent.click(screen.getByRole("radio", { name: "Friends" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "learner@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(sendCode).toHaveBeenCalledWith("learner@example.com", { discoverable: true, shareMode: "friends" }));
  });

  it("does not apply creation choices when the learner switches back to sign-in", async () => {
    const signIn = vi.fn(async () => true);
    const signUp = vi.fn(async () => true);
    useAccount.setState({ phase: "signed-out", user: null, busy: false, signIn, signUp });
    render(<AccountSyncPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Appear in learner search" }));
    fireEvent.click(screen.getByRole("radio", { name: "Community" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in", pressed: false }));
    expect(screen.queryByRole("region", { name: "Community and leaderboards" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "learner@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("learner@example.com", "password123"));
    expect(signUp).not.toHaveBeenCalled();
  });

  it("shows only the confirmation step once signup choices have been submitted", () => {
    useAccount.setState({ phase: "signed-out", user: null, busy: false });
    const { rerender } = render(<AccountSyncPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    act(() => { useAccount.setState({ pendingCodeEmail: "learner@example.com", pendingCodeKind: "signup" }); });
    rerender(<AccountSyncPanel />);
    expect(screen.getByLabelText("Confirmation code sent to learner@example.com")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Appear in learner search" })).toBeNull();
    expect(screen.queryByLabelText("Name on your account")).toBeNull();
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
      expect(localStatus.textContent).toContain(`Not saved since ${failedAt.toLocaleTimeString()}`);
      expect(document.querySelector(".account-location-indicator.local-failure")).toBeTruthy();
      expect(document.querySelector(".account-location-indicator.local-saved")).toBeNull();
    } finally {
      markVaultWrite("indexeddb");
    }
  });
});
