// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount, resumeLinkedWorkspaceAfterHydration } from "../lib/account/accountStore";
import { DEFAULT_JOURNAL_NOTEBOOK } from "../lib/journalNotebook";
import { flushLocalVaultWrites, localVaultStorage } from "../lib/localVault";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { read, write } from "../lib/sync/syncMetadata";
import { useUi } from "../lib/uiStore";
import { hasWorkspaceHydrationReceipt, recordWorkspaceHydration } from "../lib/workspaceHydrationReceipt";
import { JournalPage } from "./JournalPage";

const owner = { id: "journal-boot-owner", email: "boot@example.invalid", displayName: "Owner", emailConfirmed: true };
const other = { ...owner, id: "journal-other-owner" };

beforeEach(async () => {
  // Reproduce the UTC midnight to 04:00 boundary that made legacy dayKey() fixtures disagree with activeDayKey.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T00:05:00Z"));
  await useStore.persist.rehydrate();
  const seed = makeSeed();
  useStore.setState({
    ...seed, questions: [], documents: [], dayPlans: [], tasks: [], logs: [],
    profile: { ...seed.profile, journalNotebook: { ...DEFAULT_JOURNAL_NOTEBOOK, setupCompleted: true } },
    journal: [{ id: "persisted-boot-page", date: `${seed.activeDayKey}T12:00:00`, today: "A saved day", tomorrow: "", blockers: "",
      energy: "Medium", rating: "Useful", freeWriting: "Private writing loaded from the persisted vault.", notebookStatus: "draft" }],
  });
  await flushLocalVaultWrites();
  useAccount.setState({ phase: "signed-in", user: owner, link: "linked", protection: "local-only" });
  write({ ...read(), accountUserId: owner.id });
  recordWorkspaceHydration(undefined, []);
  useUi.setState({ journalDay: null, settingsRequest: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  useAccount.setState({ phase: "signed-out", user: null, link: "unlinked" });
  recordWorkspaceHydration(undefined, []);
});

async function pendingVaultHydration() {
  const persisted = await localVaultStorage.getItem("noctyrium-state");
  let resolve!: (value: string | null) => void;
  let reject!: (error: Error) => void;
  vi.spyOn(localVaultStorage, "getItem").mockImplementationOnce(() => new Promise<string | null>((yes, no) => {
    resolve = yes; reject = no;
  }));
  const hydration = useStore.persist.rehydrate();
  return { hydration, release: () => resolve(persisted), fail: () => reject(new Error("Synthetic vault read failure")) };
}

describe("Journal linked device boot hydration", () => {
  it("seeds the persisted page for the active day used by Open today’s page", () => {
    const state = useStore.getState();
    expect(state.journal[0].date.slice(0, 10)).toBe(state.activeDayKey);
  });

  it("opens the existing owner's persisted page only after actual vault hydration succeeds", async () => {
    const vault = await pendingVaultHydration();
    const activation = resumeLinkedWorkspaceAfterHydration();
    render(<JournalPage />);
    expect(screen.getByRole("heading", { name: "Journal paused" })).toBeTruthy();
    expect(hasWorkspaceHydrationReceipt(owner.id, useStore.getState().journal)).toBe(false);
    await act(async () => { vault.release(); await vault.hydration; expect(await activation).toBe(true); });
    expect(screen.queryByRole("heading", { name: "Journal paused" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open today’s page" }));
    fireEvent.click(screen.getByRole("button", { name: "Write full page" }));
    expect(screen.getByLabelText("Free writing")).toHaveProperty("value", "Private writing loaded from the persisted vault.");
    expect(useStore.getState().journal[0].id).toBe("persisted-boot-page");
  });

  it("keeps a different signed-in account paused after the old vault finishes loading", async () => {
    useAccount.setState({ user: other, link: "linked-elsewhere" });
    const vault = await pendingVaultHydration();
    const activation = resumeLinkedWorkspaceAfterHydration();
    render(<JournalPage />);
    await act(async () => { vault.release(); await vault.hydration; expect(await activation).toBe(false); });
    expect(screen.getByRole("heading", { name: "Journal paused" })).toBeTruthy();
    expect(screen.queryByLabelText("Free writing")).toBeNull();
    expect(hasWorkspaceHydrationReceipt(other.id, useStore.getState().journal)).toBe(false);
  });

  it("rejects an A to B to A transition while A's original boot hydration is pending", async () => {
    const vault = await pendingVaultHydration();
    const activation = resumeLinkedWorkspaceAfterHydration();
    render(<JournalPage />);
    act(() => { useAccount.setState({ user: other }); useAccount.setState({ user: owner }); });
    await act(async () => { vault.release(); await vault.hydration; expect(await activation).toBe(false); });
    expect(screen.getByRole("heading", { name: "Journal paused" })).toBeTruthy();
    expect(hasWorkspaceHydrationReceipt(owner.id, useStore.getState().journal)).toBe(false);
  });

  it("never treats a failed persisted read as an ownership receipt", async () => {
    const vault = await pendingVaultHydration();
    const activation = resumeLinkedWorkspaceAfterHydration();
    render(<JournalPage />);
    await act(async () => { vault.fail(); await vault.hydration; expect(await activation).toBe(false); });
    expect(screen.getByRole("heading", { name: "Journal paused" })).toBeTruthy();
    expect(hasWorkspaceHydrationReceipt(owner.id, useStore.getState().journal)).toBe(false);
  });

  it("keeps the same owner's edited notebook open after leaving and reopening Journal", async () => {
    expect(await resumeLinkedWorkspaceAfterHydration()).toBe(true);
    const first = render(<JournalPage />);
    act(() => { useStore.getState().updateJournal("persisted-boot-page", { freeWriting: "A newer owned edit." }); });
    await flushLocalVaultWrites();
    first.unmount();
    render(<JournalPage />);
    expect(screen.queryByRole("heading", { name: "Journal paused" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open today’s page" }));
    fireEvent.click(screen.getByRole("button", { name: "Write full page" }));
    expect(screen.getByLabelText("Free writing")).toHaveProperty("value", "A newer owned edit.");
  });

  it("does not carry an old receipt through a later-account edit or arbitrary replacement", async () => {
    expect(await resumeLinkedWorkspaceAfterHydration()).toBe(true);
    useAccount.setState({ user: other });
    useStore.getState().updateJournal("persisted-boot-page", { freeWriting: "An intervening late edit." });
    useAccount.setState({ user: owner });
    expect(hasWorkspaceHydrationReceipt(owner.id, useStore.getState().journal)).toBe(false);
    useStore.getState().replaceAll({ ...useStore.getState() });
    render(<JournalPage />);
    expect(screen.getByRole("heading", { name: "Journal paused" })).toBeTruthy();
  });
});
