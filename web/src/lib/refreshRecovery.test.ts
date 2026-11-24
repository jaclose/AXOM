// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "./seed";
import { useStore } from "./store";
import {
  backupCoversOpenWorkspace,
  isUnloadAllowedForRefresh,
  lastPortableBackupAt,
  recordPortableBackup,
  refreshAfterPortableBackup,
  resetRefreshRecoveryForTests,
  subscribePortableBackup,
  takeRefreshAfterBackupNotice,
} from "./refreshRecovery";

beforeEach(() => {
  resetRefreshRecoveryForTests();
  sessionStorage.clear();
  useStore.setState({ ...makeSeed(), tasks: [] });
});

afterEach(() => resetRefreshRecoveryForTests());

describe("refresh after a portable backup", () => {
  it("refuses to refresh before any backup and after the workspace changes", async () => {
    const reload = vi.fn();
    await expect(refreshAfterPortableBackup(async () => undefined, reload)).rejects.toThrow(/Download a new backup/);

    recordPortableBackup(useStore.getState(), new Date("2026-11-04T12:25:21Z"));
    expect(backupCoversOpenWorkspace()).toBe(true);
    useStore.setState({ tasks: [{ id: "t1", title: "Typed after the backup", done: false } as never] });
    expect(backupCoversOpenWorkspace()).toBe(false);
    await expect(refreshAfterPortableBackup(async () => undefined, reload)).rejects.toThrow(/changed after the backup/);
    expect(reload).not.toHaveBeenCalled();
    expect(isUnloadAllowedForRefresh()).toBe(false);
  });

  it.each([
    ["is activated", false],
    ["cannot be activated", true],
  ])("does not refresh when the workspace changes while the update %s", async (_label, activationFails) => {
    recordPortableBackup(useStore.getState());
    let settle!: () => void;
    const activation = new Promise<void>((resolve, reject) => {
      settle = () => (activationFails ? reject(new Error("worker redundant")) : resolve());
    });
    const reload = vi.fn();
    const refresh = refreshAfterPortableBackup(() => activation, reload);
    // Activating takes seconds; the learner (or a running timer) can change
    // the workspace meanwhile, and that change is not in the backup.
    useStore.setState({ tasks: [{ id: "t2", title: "Typed while refreshing", done: false } as never] });
    settle();
    await expect(refresh).rejects.toThrow(/changed after the backup/);
    expect(reload).not.toHaveBeenCalled();
    expect(isUnloadAllowedForRefresh()).toBe(false);
    expect(takeRefreshAfterBackupNotice()).toBeNull();
  });

  it("refreshes after a slow activation when nothing changed meanwhile", async () => {
    recordPortableBackup(useStore.getState());
    let settle!: () => void;
    const activation = new Promise<void>((resolve) => { settle = resolve; });
    const reload = vi.fn();
    const refresh = refreshAfterPortableBackup(() => activation, reload);
    expect(reload).not.toHaveBeenCalled();
    expect(isUnloadAllowedForRefresh()).toBe(false);
    expect(takeRefreshAfterBackupNotice()).toBeNull();
    settle();
    await refresh;
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isUnloadAllowedForRefresh()).toBe(true);
    expect(takeRefreshAfterBackupNotice()).toBe(lastPortableBackupAt());
  });

  it("refreshes when the backup holds exactly what is open, even if activating the update fails", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribePortableBackup(listener);
    recordPortableBackup(useStore.getState());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(lastPortableBackupAt()).not.toBeNull();
    const reload = vi.fn();
    await refreshAfterPortableBackup(async () => { throw new Error("worker redundant"); }, reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isUnloadAllowedForRefresh()).toBe(true);
    expect(takeRefreshAfterBackupNotice()).toBe(lastPortableBackupAt());
    expect(takeRefreshAfterBackupNotice()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
